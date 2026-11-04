const { CallLog, CALL_DISPOSITIONS, CALL_TYPES } = require('../models/callLog.model');
const { Lead, LEAD_STATUS } = require('../models/lead.model');

// Create a new call log entry
const createCallLog = async (req, res) => {
  try {
    const user = req.user;

    // RBAC: Data Analysts cannot log calls
    if (user.role === 'Data Analyst') {
      return res.status(403).json({
        success: false,
        message: 'Data Analysts have read-only access and cannot log call outcomes.',
      });
    }

    const {
      leadId,
      phoneNumber,
      callType = CALL_TYPES.OUTBOUND,
      disposition,
      duration = 0,
      notes = '',
      followUpDate,
      updatedLeadStatus,
      recordingUrl,
      recordingDuration,
    } = req.body;

    if (!leadId) {
      return res.status(400).json({
        success: false,
        message: 'leadId is required to log a call.',
      });
    }

    if (!disposition) {
      return res.status(400).json({
        success: false,
        message: 'Call outcome / disposition is required.',
      });
    }

    // Verify lead exists
    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Associated lead not found.',
      });
    }

    // RBAC: Sales Executives can only log calls for their own leads or unassigned leads
    if (user.role === 'Sales Executive') {
      const isAssignedToUser = lead.assignedTo && lead.assignedTo.toString() === user._id.toString();
      const isUnassigned = !lead.assignedTo;
      if (!isAssignedToUser && !isUnassigned) {
        return res.status(403).json({
          success: false,
          message: 'You can only log calls for leads assigned to you.',
        });
      }
    }

    // Create CallLog document
    const callLog = new CallLog({
      leadId: lead._id,
      userId: user._id,
      phoneNumber: phoneNumber || lead.phone,
      callType,
      disposition,
      duration: Math.max(0, Number(duration) || 0),
      notes: notes.trim(),
      followUpDate: followUpDate ? new Date(followUpDate) : null,
      updatedLeadStatus: updatedLeadStatus || null,
      recordingUrl: recordingUrl || null,
      recordingDuration: recordingDuration ? Number(recordingDuration) : 0,
      hasRecording: !!recordingUrl,
    });

    await callLog.save();

    // Auto-update lead fields based on call outcome
    let leadModified = false;

    // 1. Update status if explicitly requested, or auto-advance 'New' -> 'Contacted'
    if (updatedLeadStatus && Object.values(LEAD_STATUS).includes(updatedLeadStatus)) {
      lead.status = updatedLeadStatus;
      leadModified = true;
    } else if (lead.status === LEAD_STATUS.NEW && disposition !== CALL_DISPOSITIONS.WRONG_NUMBER) {
      lead.status = LEAD_STATUS.CONTACTED;
      leadModified = true;
    }

    // 2. Update follow-up date if provided
    if (followUpDate) {
      lead.followUpDate = new Date(followUpDate);
      leadModified = true;
    }

    // 3. Append notes if provided
    if (notes.trim()) {
      const timestamp = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const newNote = `[Call: ${disposition} (${timestamp})] ${notes.trim()}`;
      lead.notes = lead.notes ? `${lead.notes}\n${newNote}` : newNote;
      leadModified = true;
    }

    if (leadModified) {
      await lead.save();
    }

    // Populate user info for immediate display
    await callLog.populate('userId', 'name email role');

    return res.status(201).json({
      success: true,
      message: 'Call outcome logged successfully.',
      callLog,
      lead,
    });
  } catch (error) {
    console.error('Error logging call:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to log call outcome.',
    });
  }
};

// Get all call logs for a specific lead
const getCallLogsForLead = async (req, res) => {
  try {
    const { leadId } = req.params;
    const user = req.user;

    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.',
      });
    }

    // RBAC: Sales Executives can only view logs for leads they have access to
    if (user.role === 'Sales Executive') {
      const isAssigned = lead.assignedTo && lead.assignedTo.toString() === user._id.toString();
      const isUnassigned = !lead.assignedTo;
      if (!isAssigned && !isUnassigned) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to call history for this lead.',
        });
      }
    }

    const callLogs = await CallLog.find({ leadId })
      .populate('userId', 'name email role')
      .sort({ createdAt: -1 })
      .limit(50);

    return res.status(200).json({
      success: true,
      count: callLogs.length,
      callLogs,
    });
  } catch (error) {
    console.error('Error fetching lead call logs:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch call logs.',
    });
  }
};

// Get call performance statistics
const getCallStats = async (req, res) => {
  try {
    const user = req.user;
    const query = {};

    // Sales Executive only sees their own stats
    if (user.role === 'Sales Executive') {
      query.userId = user._id;
    }

    // Today's range (midnight to now)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [totalCalls, todayCalls, allCalls] = await Promise.all([
      CallLog.countDocuments(query),
      CallLog.countDocuments({ ...query, createdAt: { $gte: startOfToday } }),
      CallLog.find(query).select('disposition duration createdAt').lean(),
    ]);

    const byDisposition = {
      Connected: 0,
      Busy: 0,
      'No Answer': 0,
      'Left Voicemail': 0,
      'Wrong Number': 0,
      'Follow-up Scheduled': 0,
    };

    let totalDurationSeconds = 0;
    let connectedCount = 0;

    for (const call of allCalls) {
      if (byDisposition[call.disposition] !== undefined) {
        byDisposition[call.disposition] += 1;
      }
      totalDurationSeconds += call.duration || 0;
      if (call.disposition === 'Connected' || call.disposition === 'Follow-up Scheduled') {
        connectedCount += 1;
      }
    }

    const connectionRate = totalCalls > 0 ? Math.round((connectedCount / totalCalls) * 100) : 0;

    return res.status(200).json({
      success: true,
      stats: {
        totalCalls,
        todayCalls,
        totalDurationSeconds,
        connectionRate,
        byDisposition,
      },
    });
  } catch (error) {
    console.error('Error getting call stats:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch call stats.',
    });
  }
};

// Get all recent call logs (CRM-wide or User-scoped)
const getAllCallLogs = async (req, res) => {
  try {
    const user = req.user;
    const { disposition, page = 1, limit = 20 } = req.query;

    const query = {};
    if (user.role === 'Sales Executive') {
      query.userId = user._id;
    }

    if (disposition && disposition !== 'All') {
      query.disposition = disposition;
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [total, callLogs] = await Promise.all([
      CallLog.countDocuments(query),
      CallLog.find(query)
        .populate('leadId', 'name company phone status')
        .populate('userId', 'name email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      callLogs,
    });
  } catch (error) {
    console.error('Error fetching all call logs:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to retrieve call logs.',
    });
  }
};

// Upload an audio recording file
const uploadCallRecording = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No audio recording file provided in request.',
      });
    }

    const recordingUrl = `/uploads/audio/${req.file.filename}`;
    const { callLogId, duration } = req.body;

    let updatedLog = null;
    if (callLogId) {
      updatedLog = await CallLog.findByIdAndUpdate(
        callLogId,
        {
          recordingUrl,
          hasRecording: true,
          recordingDuration: duration ? Number(duration) : 0,
        },
        { new: true }
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Audio recording uploaded successfully.',
      recordingUrl,
      filename: req.file.filename,
      callLog: updatedLog,
    });
  } catch (error) {
    console.error('Error uploading recording:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload audio recording.',
    });
  }
};

module.exports = {
  createCallLog,
  getCallLogsForLead,
  getCallStats,
  getAllCallLogs,
  uploadCallRecording,
};

