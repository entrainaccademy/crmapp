const mongoose = require('mongoose');
const { Lead, LEAD_STATUS, LEAD_PRIORITY } = require('../models/lead.model');
const { User, ROLES } = require('../models/user.model');

// Helper to determine if user can manage/assign any lead
const canManageAllLeads = (role) => {
  return role === ROLES.ADMIN || role === ROLES.MANAGER;
};

// @route   GET /api/leads
// @desc    Get all leads with search, filters, pagination, and RBAC scoping
// @access  Private (All authenticated roles, scoped for Sales Executive)
const getLeads = async (req, res, next) => {
  try {
    const { search, status, priority, assignedTo, page = 1, limit = 50, sort = '-createdAt' } = req.query;

    const query = {};

    // RBAC scoping
    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      // Sales Executives can ONLY view leads assigned to them
      query.assignedTo = req.user._id;
    } else if (assignedTo) {
      // Admins, Managers, and Analysts can filter by assignedTo
      if (assignedTo === 'unassigned') {
        query.assignedTo = null;
      } else if (mongoose.Types.ObjectId.isValid(assignedTo)) {
        query.assignedTo = assignedTo;
      }
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
        .populate('assignedTo', 'name email role')
        .populate('createdBy', 'name email role')
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
      .populate('assignedTo', 'name email role')
      .populate('createdBy', 'name email role');

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.',
      });
    }

    // Sales Executive can only access leads assigned to them
    if (
      req.user.role === ROLES.SALES_EXECUTIVE &&
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

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      // Sales Executives can only create leads assigned to themselves
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

    // RBAC validation for Sales Executive
    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      if (!lead.assignedTo || !lead.assignedTo.equals(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only update leads assigned to you.',
        });
      }
      // Sales Executives cannot reassign leads to someone else
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

    // Only Admins and Managers can reassign leads
    if (canManageAllLeads(req.user.role) && assignedTo !== undefined) {
      if (!assignedTo || assignedTo === 'unassigned') {
        lead.assignedTo = null;
      } else if (mongoose.Types.ObjectId.isValid(assignedTo)) {
        const targetUser = await User.findById(assignedTo);
        if (targetUser && targetUser.isActive) {
          lead.assignedTo = targetUser._id;
        }
      }
    }

    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('assignedTo', 'name email role')
      .populate('createdBy', 'name email role');

    return res.status(200).json({
      success: true,
      message: 'Lead updated successfully.',
      lead: updatedLead,
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
// @access  Private (Admin, Manager, and Sales Executives)
const getAssignableUsers = async (req, res, next) => {
  try {
    const users = await User.find(
      { isActive: true },
      'name email role'
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
    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      filter.assignedTo = req.user._id;
    }

    const total = await Lead.countDocuments(filter);

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
  deleteLead,
  getAssignableUsers,
  getLeadStats,
};

