const mongoose = require('mongoose');
const { User, ROLES } = require('../models/user.model');
const { Lead, LEAD_STATUS } = require('../models/lead.model');
const { CallLog } = require('../models/callLog.model');

// Helper to verify a role is a sales member role
const isSalesRole = (role) => {
  return role === ROLES.SALES_MEMBER || role === ROLES.SALES_EXECUTIVE;
};

// @route   GET /api/sales-members
// @desc    List all Sales Members with performance stats
// @access  Private (Data Analyst, Admin, Manager)
const getSalesMembers = async (req, res, next) => {
  try {
    const members = await User.find({
      role: { $in: [ROLES.SALES_MEMBER, ROLES.SALES_EXECUTIVE] },
    })
      .sort({ createdAt: -1 })
      .lean();

    // Enrich each sales member with individual performance metrics
    const enrichedMembers = await Promise.all(
      members.map(async (member) => {
        const [totalLeads, wonLeads, newLeads, contactedLeads, qualifiedLeads, totalCalls] = await Promise.all([
          Lead.countDocuments({ assignedTo: member._id }),
          Lead.countDocuments({ assignedTo: member._id, status: LEAD_STATUS.WON }),
          Lead.countDocuments({ assignedTo: member._id, status: LEAD_STATUS.NEW }),
          Lead.countDocuments({ assignedTo: member._id, status: LEAD_STATUS.CONTACTED }),
          Lead.countDocuments({ assignedTo: member._id, status: LEAD_STATUS.QUALIFIED }),
          CallLog.countDocuments({ userId: member._id }),
        ]);

        const conversionRate = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : '0.0';

        return {
          ...member,
          performance: {
            totalLeads,
            wonLeads,
            newLeads,
            contactedLeads,
            qualifiedLeads,
            totalCalls,
            conversionRate: `${conversionRate}%`,
          },
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: enrichedMembers.length,
      salesMembers: enrichedMembers,
    });
  } catch (error) {
    next(error);
  }
};

// @route   POST /api/sales-members
// @desc    Create a new Sales Member account
// @access  Private (Data Analyst, Admin, Manager)
const createSalesMember = async (req, res, next) => {
  try {
    const { name, email, phone, password, confirmPassword } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Full Name, Email Address, and Password are required.',
      });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password and Confirm Password do not match.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check whether the email already exists
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'A user account with this email address already exists.',
      });
    }

    // Role is automatically assigned as 'Sales Member'
    // Data Analysts cannot create Super Admin or Manager accounts
    const newMember = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      phone: phone ? phone.trim() : '',
      password,
      role: ROLES.SALES_MEMBER,
      isActive: true,
      mustChangePassword: false,
    });

    return res.status(201).json({
      success: true,
      message: 'Sales Member created successfully.',
      salesMember: newMember.toJSON(),
    });
  } catch (error) {
    next(error);
  }
};

// @route   PUT /api/sales-members/:id
// @desc    Update Sales Member details
// @access  Private (Data Analyst, Admin, Manager)
const updateSalesMember = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, phone, email, password } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format.',
      });
    }

    const member = await User.findById(id).select('+password');
    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Sales Member not found.',
      });
    }

    // Security check: Data Analysts cannot modify Admin or Manager accounts
    if (!isSalesRole(member.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only manage Sales Member accounts.',
      });
    }

    if (name) member.name = name.trim();
    if (phone !== undefined) member.phone = phone.trim();

    if (email) {
      const normalizedEmail = email.toLowerCase().trim();
      if (normalizedEmail !== member.email) {
        const emailCollision = await User.findOne({ email: normalizedEmail, _id: { $ne: member._id } });
        if (emailCollision) {
          return res.status(409).json({
            success: false,
            message: 'Email address is already in use by another account.',
          });
        }
        member.email = normalizedEmail;
      }
    }

    if (password) {
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 6 characters long.',
        });
      }
      member.password = password;
    }

    await member.save();

    return res.status(200).json({
      success: true,
      message: 'Sales Member updated successfully.',
      salesMember: member.toJSON(),
    });
  } catch (error) {
    next(error);
  }
};

// @route   PATCH /api/sales-members/:id/toggle-status
// @desc    Activate or deactivate a Sales Member account
// @access  Private (Data Analyst, Admin, Manager)
const toggleSalesMemberStatus = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format.',
      });
    }

    const member = await User.findById(id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Sales Member not found.',
      });
    }

    // Security check: cannot deactivate Admins or Managers
    if (!isSalesRole(member.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only activate or deactivate Sales Member accounts.',
      });
    }

    member.isActive = !member.isActive;
    await member.save();

    return res.status(200).json({
      success: true,
      message: `Sales Member account ${member.isActive ? 'activated' : 'deactivated'} successfully.`,
      salesMember: member.toJSON(),
    });
  } catch (error) {
    next(error);
  }
};

// @route   GET /api/sales-members/analytics
// @desc    Dedicated Analytics Dashboard metrics for Data Analyst
// @access  Private (Data Analyst, Admin, Manager)
const getAnalyticsOverview = async (req, res, next) => {
  try {
    const [
      totalSalesMembers,
      activeSalesMembers,
      totalLeads,
      unassignedLeads,
      assignedLeads,
      statusCounts,
      totalCalls,
      callDurationAgg,
      members,
    ] = await Promise.all([
      User.countDocuments({ role: { $in: [ROLES.SALES_MEMBER, ROLES.SALES_EXECUTIVE] } }),
      User.countDocuments({ role: { $in: [ROLES.SALES_MEMBER, ROLES.SALES_EXECUTIVE] }, isActive: true }),
      Lead.countDocuments(),
      Lead.countDocuments({ assignedTo: null }),
      Lead.countDocuments({ assignedTo: { $ne: null } }),
      Lead.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      CallLog.countDocuments(),
      CallLog.aggregate([{ $group: { _id: null, totalDuration: { $sum: '$duration' } } }]),
      User.find({ role: { $in: [ROLES.SALES_MEMBER, ROLES.SALES_EXECUTIVE] } })
        .sort({ name: 1 })
        .lean(),
    ]);

    // Format status map
    const byStatus = {
      New: 0,
      Contacted: 0,
      Qualified: 0,
      'Proposal Sent': 0,
      Won: 0,
      Lost: 0,
    };
    statusCounts.forEach((sc) => {
      if (sc._id && byStatus[sc._id] !== undefined) {
        byStatus[sc._id] = sc.count;
      }
    });

    const wonLeads = byStatus.Won || 0;
    const overallConversionRate = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : '0.0';
    const totalTalkTime = callDurationAgg[0]?.totalDuration || 0;

    // Build Individual Sales Member Performance breakdown
    const memberPerformance = await Promise.all(
      members.map(async (m) => {
        const [memberLeads, memberWon, memberNew, memberContacted, memberQualified, memberCalls] =
          await Promise.all([
            Lead.countDocuments({ assignedTo: m._id }),
            Lead.countDocuments({ assignedTo: m._id, status: LEAD_STATUS.WON }),
            Lead.countDocuments({ assignedTo: m._id, status: LEAD_STATUS.NEW }),
            Lead.countDocuments({ assignedTo: m._id, status: LEAD_STATUS.CONTACTED }),
            Lead.countDocuments({ assignedTo: m._id, status: LEAD_STATUS.QUALIFIED }),
            CallLog.countDocuments({ userId: m._id }),
          ]);

        const conv = memberLeads > 0 ? ((memberWon / memberLeads) * 100).toFixed(1) : '0.0';

        return {
          _id: m._id,
          name: m.name,
          email: m.email,
          phone: m.phone || '',
          isActive: m.isActive,
          role: m.role,
          totalLeads: memberLeads,
          wonLeads: memberWon,
          newLeads: memberNew,
          contactedLeads: memberContacted,
          qualifiedLeads: memberQualified,
          totalCalls: memberCalls,
          conversionRate: `${conv}%`,
        };
      })
    );

    return res.status(200).json({
      success: true,
      analytics: {
        totalSalesMembers,
        activeSalesMembers,
        totalLeads,
        unassignedLeads,
        assignedLeads,
        newLeads: byStatus.New || 0,
        contactedLeads: byStatus.Contacted || 0,
        qualifiedLeads: byStatus.Qualified || 0,
        wonLeads: byStatus.Won || 0,
        proposalSentLeads: byStatus['Proposal Sent'] || 0,
        lostLeads: byStatus.Lost || 0,
        salesPerformance: {
          overallConversionRate: `${overallConversionRate}%`,
          totalCalls,
          totalTalkTimeSeconds: totalTalkTime,
        },
        memberPerformance,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSalesMembers,
  createSalesMember,
  updateSalesMember,
  toggleSalesMemberStatus,
  getAnalyticsOverview,
};

