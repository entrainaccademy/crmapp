const express = require('express');
const router = express.Router();
const {
  createCallLog,
  getCallLogsForLead,
  getCallStats,
  getAllCallLogs,
  uploadCallRecording,
  streamCallRecording,
  updateRecordingStatus,
} = require('../controllers/callLog.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { audioUpload } = require('../middleware/upload.middleware');

// All call routes require authentication
router.use(authenticateToken);

// Call Stats & List
router.get('/stats', getCallStats);
router.get('/', getAllCallLogs);

// Lead-specific call logs
router.get('/lead/:leadId', getCallLogsForLead);

// Upload an audio recording file
router.post('/upload-recording', audioUpload.single('audio'), uploadCallRecording);

// Stream or download secure call recording (HTTP Range & RBAC)
router.get('/:callLogId/recording', streamCallRecording);

// Update recording status lifecycle
router.patch('/:callLogId/recording-status', updateRecordingStatus);

// Log a call outcome
router.post('/', createCallLog);

module.exports = router;

