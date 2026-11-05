const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CallLog, CALL_DISPOSITIONS, CALL_TYPES, RECORDING_STATUSES } = require('../models/callLog.model');
const { Lead, LEAD_STATUS } = require('../models/lead.model');

const isSalesUser = (role) => role === 'Sales Executive' || role === 'Sales Member';

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
      recordingType = 'none',
      recordingStatus,
      recordingOriginalFilename,
      recordingFileSize,
      recordingFileHash,
      recordingUploadedAt,
      callStartedAt,
      callEndedAt,
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

    // RBAC: Sales Members/Executives can only log calls for their own leads or unassigned leads
    if (isSalesUser(user.role)) {
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
      recordingType: recordingUrl ? (recordingType || 'device_attachment') : 'none',
      recordingStatus: recordingStatus || (recordingUrl ? RECORDING_STATUSES.UPLOADED : RECORDING_STATUSES.UNAVAILABLE),
      recordingOriginalFilename: recordingOriginalFilename || null,
      recordingFileSize: recordingFileSize ? Number(recordingFileSize) : 0,
      recordingFileHash: recordingFileHash || null,
      recordingUploadedAt: recordingUploadedAt ? new Date(recordingUploadedAt) : (recordingUrl ? new Date() : null),
      callStartedAt: callStartedAt ? new Date(callStartedAt) : null,
      callEndedAt: callEndedAt ? new Date(callEndedAt) : null,
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

    // RBAC: Sales Members can only view logs for leads they have access to
    if (isSalesUser(user.role)) {
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

    // Sales user only sees their own stats
    if (isSalesUser(user.role)) {
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
    if (isSalesUser(user.role)) {
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

// Upload an audio recording file with deduplication and metadata tracking
const uploadCallRecording = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No audio recording file provided in request.',
      });
    }

    const { callLogId, leadId, duration, fileHash: clientHash, recordingType = 'device_attachment' } = req.body;

    // Calculate MD5 hash of uploaded file if not provided by client
    let fileHash = clientHash;
    if (!fileHash && fs.existsSync(req.file.path)) {
      const fileBuffer = fs.readFileSync(req.file.path);
      fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
    }

    let recordingUrl = `/uploads/audio/${req.file.filename}`;
    let isDuplicate = false;

    // Check if another call log already has this exact recording file hash on disk
    if (fileHash) {
      const existingRecord = await CallLog.findOne({
        recordingFileHash: fileHash,
        recordingUrl: { $ne: null },
      });

      if (existingRecord && existingRecord.recordingUrl) {
        const existingDiskPath = path.join(__dirname, '../../uploads/audio', path.basename(existingRecord.recordingUrl));
        if (fs.existsSync(existingDiskPath)) {
          // File already exists on server disk; remove newly uploaded duplicate to save space
          try {
            fs.unlinkSync(req.file.path);
          } catch (_) {}
          recordingUrl = existingRecord.recordingUrl;
          isDuplicate = true;
        }
      }
    }

    let updatedLog = null;
    if (callLogId) {
      updatedLog = await CallLog.findByIdAndUpdate(
        callLogId,
        {
          recordingUrl,
          hasRecording: true,
          recordingStatus: RECORDING_STATUSES.UPLOADED,
          recordingDuration: duration ? Number(duration) : 0,
          recordingType,
          recordingFileSize: req.file.size || 0,
          recordingOriginalFilename: req.file.originalname,
          recordingFileHash: fileHash || null,
          recordingUploadedAt: new Date(),
        },
        { new: true }
      );
    }

    return res.status(200).json({
      success: true,
      message: isDuplicate ? 'Recording deduplicated & linked successfully.' : 'Audio recording uploaded successfully.',
      recordingUrl,
      filename: path.basename(recordingUrl),
      originalFilename: req.file.originalname,
      fileHash,
      fileSize: req.file.size,
      recordingStatus: RECORDING_STATUSES.UPLOADED,
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

// Stream or download a call recording with RBAC and HTTP Range request support
const streamCallRecording = async (req, res) => {
  try {
    const { callLogId } = req.params;
    const user = req.user;

    const callLog = await CallLog.findById(callLogId).populate('leadId');
    if (!callLog) {
      return res.status(404).json({
        success: false,
        message: 'Call log record not found.',
      });
    }

    if (!callLog.hasRecording || !callLog.recordingUrl) {
      return res.status(404).json({
        success: false,
        message: 'No recording file is associated with this call.',
      });
    }

    // RBAC Authorization
    if (user.role === 'Data Analyst') {
      return res.status(403).json({
        success: false,
        message: 'Data Analysts have metadata-only access and cannot stream call recordings.',
      });
    }

    if (isSalesUser(user.role)) {
      const isCaller = callLog.userId.toString() === user._id.toString();
      const isLeadAssignee = callLog.leadId?.assignedTo && callLog.leadId.assignedTo.toString() === user._id.toString();
      if (!isCaller && !isLeadAssignee) {
        return res.status(403).json({
          success: false,
          message: 'You are only authorized to listen to recordings for your own leads or calls.',
        });
      }
    }

    // Resolve file path on disk
    const audioFilename = path.basename(callLog.recordingUrl);
    const audioFilePath = path.join(__dirname, '../../uploads/audio', audioFilename);

    if (!fs.existsSync(audioFilePath)) {
      return res.status(404).json({
        success: false,
        message: 'Recording audio file is missing from server storage.',
      });
    }

    const stat = fs.statSync(audioFilePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // Detect MIME type based on file extension
    const ext = path.extname(audioFilename).toLowerCase();
    let contentType = 'audio/mp4';
    if (ext === '.mp3') contentType = 'audio/mpeg';
    else if (ext === '.wav') contentType = 'audio/wav';
    else if (ext === '.ogg') contentType = 'audio/ogg';
    else if (ext === '.webm') contentType = 'audio/webm';
    else if (ext === '.amr') contentType = 'audio/amr';

    // Download attachment support
    if (req.query.download === 'true') {
      const dlName = callLog.recordingOriginalFilename || audioFilename;
      res.setHeader('Content-Disposition', `attachment; filename="${dlName}"`);
    }

    // HTTP 206 Partial Content for streaming & seeking
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.status(416).send(`Requested range not satisfiable\n${start} >= ${fileSize}`);
        return;
      }

      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(audioFilePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      };

      res.writeHead(206, head);
      fileStream.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      };
      res.writeHead(200, head);
      fs.createReadStream(audioFilePath).pipe(res);
    }
  } catch (error) {
    console.error('Error streaming call recording:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to stream audio recording.',
    });
  }
};

// Update recording status for a call log (e.g. from offline queue transitions)
const updateRecordingStatus = async (req, res) => {
  try {
    const { callLogId } = req.params;
    const { recordingStatus, reason } = req.body;

    if (!Object.values(RECORDING_STATUSES).includes(recordingStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid recordingStatus. Must be one of: [${Object.values(RECORDING_STATUSES).join(', ')}]`,
      });
    }

    const updatedLog = await CallLog.findByIdAndUpdate(
      callLogId,
      {
        recordingStatus,
        notes: reason ? `${reason}` : undefined,
      },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      callLog: updatedLog,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update recording status.',
    });
  }
};

module.exports = {
  createCallLog,
  getCallLogsForLead,
  getCallStats,
  getAllCallLogs,
  uploadCallRecording,
  streamCallRecording,
  updateRecordingStatus,
};

