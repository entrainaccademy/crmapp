const mongoose = require('mongoose');
const { Lead, LEAD_STATUS, LEAD_PRIORITY } = require('../models/lead.model');
const { User, ROLES } = require('../models/user.model');

// Helper to determine if user can manage/assign any lead
const canManageAllLeads = (role) => {
  return role === ROLES.ADMIN || role === ROLES.MANAGER;
};

// Helper to determine if user has permission to assign or reassign leads
const canAssignLeads = (role) => {
  return role === ROLES.ADMIN || role === ROLES.MANAGER || role === ROLES.DATA_ANALYST;
};

// Helper to determine if user is a sales role (Sales Member or Sales Executive)
const isSalesUser = (role) => {
  return role === ROLES.SALES_EXECUTIVE || role === ROLES.SALES_MEMBER;
};

// @route   GET /api/leads
// @desc    Get all leads with search, filters, pagination, and RBAC scoping
// @access  Private (All authenticated roles, scoped for Sales Executive/Member)
const getLeads = async (req, res, next) => {
  try {
    const { search, status, priority, assignedTo, assignmentStatus, page = 1, limit = 50, sort = '-createdAt' } = req.query;

    const query = {};

    // RBAC scoping
    if (isSalesUser(req.user.role)) {
      // Sales Members can ONLY view leads assigned to them
      query.assignedTo = req.user._id;
    } else if (assignedTo) {
      // Admins, Managers, and Analysts can filter by assignedTo
      if (assignedTo === 'unassigned') {
        query.assignedTo = null;
      } else if (assignedTo === 'assigned') {
        query.assignedTo = { $ne: null };
      } else if (mongoose.Types.ObjectId.isValid(assignedTo)) {
        query.assignedTo = assignedTo;
      }
    }

    // Assignment Status filter (Unassigned, Assigned, Reassigned)
    if (assignmentStatus && ['Unassigned', 'Assigned', 'Reassigned'].includes(assignmentStatus)) {
      query.assignmentStatus = assignmentStatus;
    }

    // Status filter
    if (status && status !== 'All') {
      if (Object.values(LEAD_STATUS).includes(status)) {
        query.status = status;
      }
    }

    // Priority filter
    if (priority && priority !== 'All') {
      if (Object.values(LEAD_PRIORITY).includes(priority)) {
        query.priority = priority;
      }
    }

    // Search filter across name, company, phone, email
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { name: searchRegex },
        { company: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageLimit = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * pageLimit;

    const [leads, total] = await Promise.all([
      Lead.find(query)
        .sort(sort)
        .skip(skip)
        .limit(pageLimit)
        .populate('assignedTo', 'name email role phone isActive')
        .populate('assignedBy', 'name email role')
        .populate('createdBy', 'name email role')
        .populate('assignmentHistory.assignedTo', 'name email role')
        .populate('assignmentHistory.assignedBy', 'name email role')
        .populate('assignmentHistory.previousAssignee', 'name email role')
        .lean(),
      Lead.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      count: leads.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / pageLimit) || 1,
      leads,
    });
  } catch (error) {
    next(error);
  }
};

// @route   GET /api/leads/:id
// @desc    Get single lead details
// @access  Private (Scoped for Sales Executive)
const getLeadById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lead ID format.',
      });
    }

    const lead = await Lead.findById(id)
      .populate('assignedTo', 'name email role phone isActive')
      .populate('assignedBy', 'name email role')
      .populate('createdBy', 'name email role')
      .populate('assignmentHistory.assignedTo', 'name email role')
      .populate('assignmentHistory.assignedBy', 'name email role')
      .populate('assignmentHistory.previousAssignee', 'name email role');

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.',
      });
    }

    // Sales Member / Executive can only access leads assigned to them
    if (
      isSalesUser(req.user.role) &&
      (!lead.assignedTo || !lead.assignedTo._id.equals(req.user._id))
    ) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You only have permission to view leads assigned to you.',
      });
    }

    return res.status(200).json({
      success: true,
      lead,
    });
  } catch (error) {
    next(error);
  }
};

// @route   POST /api/leads
// @desc    Create a new lead
// @access  Private (Admin, Manager, Sales Executive; Data Analyst forbidden)
const createLead = async (req, res, next) => {
  try {
    // Data Analysts have read-only access
    if (req.user.role === ROLES.DATA_ANALYST) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Data Analysts have read-only access and cannot create leads.',
      });
    }

    const {
      name,
      phone,
      company,
      email,
      status,
      priority,
      source,
      value,
      followUpDate,
      notes,
      assignedTo,
    } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Contact name is required.',
      });
    }

    if (!phone || !phone.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required.',
      });
    }

    // Determine lead assignment based on role
    let finalAssignedTo = null;

    if (isSalesUser(req.user.role)) {
      // Sales Members can only create leads assigned to themselves
      finalAssignedTo = req.user._id;
    } else if (canManageAllLeads(req.user.role)) {
      // Admins and Managers can assign to any specified team member
      if (assignedTo && mongoose.Types.ObjectId.isValid(assignedTo)) {
        const targetUser = await User.findById(assignedTo);
        if (targetUser && targetUser.isActive) {
          finalAssignedTo = targetUser._id;
        }
      }
    }

    // Parse follow-up date safely
    let parsedFollowUp = null;
    if (followUpDate) {
      const d = new Date(followUpDate);
      if (!isNaN(d.getTime())) {
        parsedFollowUp = d;
      }
    }

    const lead = await Lead.create({
      name: name.trim(),
      phone: phone.trim(),
      company: company ? company.trim() : '',
      email: email ? email.toLowerCase().trim() : '',
      status: status && Object.values(LEAD_STATUS).includes(status) ? status : LEAD_STATUS.NEW,
      priority: priority && Object.values(LEAD_PRIORITY).includes(priority) ? priority : LEAD_PRIORITY.MEDIUM,
      source: source || 'Website',
      value: Number(value) >= 0 ? Number(value) : 0,
      followUpDate: parsedFollowUp,
      notes: notes ? notes.trim() : '',
      assignedTo: finalAssignedTo,
      createdBy: req.user._id,
    });

    const populatedLead = await Lead.findById(lead._id)
      .populate('assignedTo', 'name email role')
      .populate('createdBy', 'name email role');

    return res.status(201).json({
      success: true,
      message: 'Lead created successfully.',
      lead: populatedLead,
    });
  } catch (error) {
    next(error);
  }
};

// @route   PUT /api/leads/:id
// @desc    Update an existing lead
// @access  Private (Admin, Manager full; Sales Executive own lead; Data Analyst forbidden)
const updateLead = async (req, res, next) => {
  try {
    // Data Analysts have read-only access
    if (req.user.role === ROLES.DATA_ANALYST) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Data Analysts have read-only access and cannot edit leads.',
      });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lead ID format.',
      });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.',
      });
    }

    // RBAC validation for Sales Member
    if (isSalesUser(req.user.role)) {
      if (!lead.assignedTo || !lead.assignedTo.equals(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only update leads assigned to you.',
        });
      }
      // Sales Members cannot reassign leads to someone else
      delete req.body.assignedTo;
    }

    const {
      name,
      phone,
      company,
      email,
      status,
      priority,
      source,
      value,
      followUpDate,
      notes,
      assignedTo,
    } = req.body;

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ success: false, message: 'Name cannot be empty.' });
      }
      lead.name = name.trim();
    }

    if (phone !== undefined) {
      if (!phone.trim()) {
        return res.status(400).json({ success: false, message: 'Phone cannot be empty.' });
      }
      lead.phone = phone.trim();
    }

    if (company !== undefined) lead.company = company.trim();
    if (email !== undefined) lead.email = email.toLowerCase().trim();
    if (status !== undefined && Object.values(LEAD_STATUS).includes(status)) lead.status = status;
    if (priority !== undefined && Object.values(LEAD_PRIORITY).includes(priority)) lead.priority = priority;
    if (source !== undefined) lead.source = source.trim();
    if (value !== undefined) lead.value = Math.max(0, Number(value) || 0);

    if (followUpDate !== undefined) {
      if (!followUpDate) {
        lead.followUpDate = null;
      } else {
        const d = new Date(followUpDate);
        if (!isNaN(d.getTime())) {
          lead.followUpDate = d;
        }
      }
    }

    if (notes !== undefined) lead.notes = notes.trim();

    // Admins, Managers, and Data Analysts can reassign leads
    if (canAssignLeads(req.user.role) && assignedTo !== undefined) {
      if (!assignedTo || assignedTo === 'unassigned') {
        lead.assignedTo = null;
        lead.assignmentStatus = 'Unassigned';
      } else if (mongoose.Types.ObjectId.isValid(assignedTo)) {
        const targetUser = await User.findById(assignedTo);
        if (targetUser && targetUser.isActive) {
          if (!lead.assignedTo || !lead.assignedTo.equals(targetUser._id)) {
            const previousAssignee = lead.assignedTo;
            const isReassignment = !!previousAssignee;
            lead.assignedTo = targetUser._id;
            lead.assignedBy = req.user._id;
            lead.assignedAt = new Date();
            lead.assignmentStatus = isReassignment ? 'Reassigned' : 'Assigned';
            lead.assignmentHistory.push({
              assignedTo: targetUser._id,
              assignedBy: req.user._id,
              assignedAt: new Date(),
              previousAssignee: previousAssignee || null,
              notes: 'Updated via lead edit',
            });
          }
        }
      }
    }

    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('assignedTo', 'name email role phone isActive')
      .populate('assignedBy', 'name email role')
      .populate('createdBy', 'name email role')
      .populate('assignmentHistory.assignedTo', 'name email role')
      .populate('assignmentHistory.assignedBy', 'name email role')
      .populate('assignmentHistory.previousAssignee', 'name email role');

    return res.status(200).json({
      success: true,
      message: 'Lead updated successfully.',
      lead: updatedLead,
    });
  } catch (error) {
    next(error);
  }
};

// @route   POST /api/leads/:id/assign
// @desc    Assign or reassign an individual lead to a Sales Executive
// @access  Private (Admin, Manager, Data Analyst)
const assignLead = async (req, res, next) => {
  try {
    if (!canAssignLeads(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to assign leads.',
      });
    }

    const { id } = req.params;
    const { salesExecutiveId, notes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lead ID format.',
      });
    }

    if (!salesExecutiveId || !mongoose.Types.ObjectId.isValid(salesExecutiveId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid Sales Executive ID is required.',
      });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.',
      });
    }

    // Verify target employee exists and is active
    const targetEmployee = await User.findById(salesExecutiveId);
    if (!targetEmployee) {
      return res.status(404).json({
        success: false,
        message: 'Selected Sales Executive not found.',
      });
    }

    if (!targetEmployee.isActive) {
      return res.status(400).json({
        success: false,
        message: `Cannot assign lead: '${targetEmployee.name}' account is currently deactivated.`,
      });
    }

    // Prevent duplicate assignment if lead is already assigned to this employee
    if (lead.assignedTo && lead.assignedTo.toString() === targetEmployee._id.toString()) {
      return res.status(400).json({
        success: false,
        message: `Lead '${lead.name}' is already assigned to ${targetEmployee.name}.`,
      });
    }

    const previousAssignee = lead.assignedTo;
    const isReassignment = !!previousAssignee;

    lead.assignedTo = targetEmployee._id;
    lead.assignedBy = req.user._id;
    lead.assignedAt = new Date();
    lead.assignmentStatus = isReassignment ? 'Reassigned' : 'Assigned';

    lead.assignmentHistory.push({
      assignedTo: targetEmployee._id,
      assignedBy: req.user._id,
      assignedAt: new Date(),
      previousAssignee: previousAssignee || null,
      notes: notes ? notes.trim() : (isReassignment ? 'Lead reassigned' : 'Initial assignment'),
    });

    await lead.save();

    const populatedLead = await Lead.findById(lead._id)
      .populate('assignedTo', 'name email role phone isActive')
      .populate('assignedBy', 'name email role')
      .populate('createdBy', 'name email role')
      .populate('assignmentHistory.assignedTo', 'name email role')
      .populate('assignmentHistory.assignedBy', 'name email role')
      .populate('assignmentHistory.previousAssignee', 'name email role');

    return res.status(200).json({
      success: true,
      message: `Lead '${lead.name}' successfully ${isReassignment ? 'reassigned' : 'assigned'} to ${targetEmployee.name}.`,
      lead: populatedLead,
    });
  } catch (error) {
    next(error);
  }
};

// @route   POST /api/leads/bulk-assign
// @desc    Bulk assign multiple leads to a Sales Executive
// @access  Private (Admin, Manager, Data Analyst)
const bulkAssignLeads = async (req, res, next) => {
  try {
    if (!canAssignLeads(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to assign leads.',
      });
    }

    const { leadIds, salesExecutiveId, notes } = req.body;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of one or more lead IDs.',
      });
    }

    if (!salesExecutiveId || !mongoose.Types.ObjectId.isValid(salesExecutiveId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid Sales Executive ID is required.',
      });
    }

    // Validate target employee
    const targetEmployee = await User.findById(salesExecutiveId);
    if (!targetEmployee) {
      return res.status(404).json({
        success: false,
        message: 'Selected Sales Executive not found.',
      });
    }

    if (!targetEmployee.isActive) {
      return res.status(400).json({
        success: false,
        message: `Cannot assign leads: '${targetEmployee.name}' account is currently deactivated.`,
      });
    }

    // Filter valid ObjectIDs
    const validIds = leadIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid lead IDs provided.',
      });
    }

    const leads = await Lead.find({ _id: { $in: validIds } });
    if (leads.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No matching leads found.',
      });
    }

    let updatedCount = 0;
    let skippedCount = 0;
    const now = new Date();

    for (const lead of leads) {
      // Prevent duplicate assignment if already assigned to this employee
      if (lead.assignedTo && lead.assignedTo.toString() === targetEmployee._id.toString()) {
        skippedCount++;
        continue;
      }

      const previousAssignee = lead.assignedTo;
      const isReassignment = !!previousAssignee;

      lead.assignedTo = targetEmployee._id;
      lead.assignedBy = req.user._id;
      lead.assignedAt = now;
      lead.assignmentStatus = isReassignment ? 'Reassigned' : 'Assigned';

      lead.assignmentHistory.push({
        assignedTo: targetEmployee._id,
        assignedBy: req.user._id,
        assignedAt: now,
        previousAssignee: previousAssignee || null,
        notes: notes ? notes.trim() : (isReassignment ? 'Bulk reassignment' : 'Bulk lead assignment'),
      });

      await lead.save();
      updatedCount++;
    }

    return res.status(200).json({
      success: true,
      message: `Successfully assigned ${updatedCount} lead(s) to ${targetEmployee.name}.${skippedCount > 0 ? ` (${skippedCount} lead(s) were already assigned to them).` : ''}`,
      modifiedCount: updatedCount,
      skippedCount,
      assignedTo: {
        _id: targetEmployee._id,
        name: targetEmployee.name,
        email: targetEmployee.email,
        role: targetEmployee.role,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @route   DELETE /api/leads/:id
// @desc    Delete a lead
// @access  Private (Admin and Manager only)
const deleteLead = async (req, res, next) => {
  try {
    if (!canManageAllLeads(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only Admins and Managers are authorized to delete leads.',
      });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lead ID format.',
      });
    }

    const lead = await Lead.findByIdAndDelete(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Lead deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
};

// @route   GET /api/leads/assignable-users
// @desc    Get team members eligible for lead assignment
// @access  Private (Admin, Manager, Data Analyst, and Sales Executives)
const getAssignableUsers = async (req, res, next) => {
  try {
    const { salesOnly } = req.query;
    const filter = { isActive: true };

    if (salesOnly === 'true' || salesOnly === '1') {
      filter.role = { $in: [ROLES.SALES_EXECUTIVE, ROLES.SALES_MEMBER] };
    }

    const users = await User.find(
      filter,
      'name email role phone isActive'
    ).sort('name');

    return res.status(200).json({
      success: true,
      users,
    });
  } catch (error) {
    next(error);
  }
};

// @route   GET /api/leads/stats
// @desc    Get lead statistics aggregated for dashboard
// @access  Private (Scoped for Sales Executive)
const getLeadStats = async (req, res, next) => {
  try {
    const filter = {};
    if (isSalesUser(req.user.role)) {
      filter.assignedTo = req.user._id;
    }

    const [total, unassigned, assigned] = await Promise.all([
      Lead.countDocuments(filter),
      Lead.countDocuments({ ...filter, assignedTo: null }),
      Lead.countDocuments({ ...filter, assignedTo: { $ne: null } }),
    ]);

    const statusCounts = await Lead.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const byStatus = {};
    Object.values(LEAD_STATUS).forEach((st) => {
      byStatus[st] = 0;
    });
    statusCounts.forEach((item) => {
      byStatus[item._id] = item.count;
    });

    // Count upcoming follow-ups
    const now = new Date();
    const upcomingFollowUps = await Lead.countDocuments({
      ...filter,
      followUpDate: { $gte: now },
    });

    return res.status(200).json({
      success: true,
      stats: {
        total,
        unassigned,
        assigned,
        byStatus,
        upcomingFollowUps,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLeads,
  getLeadById,
  createLead,
  updateLead,
  assignLead,
  bulkAssignLeads,
  deleteLead,
  getAssignableUsers,
  getLeadStats,
};

