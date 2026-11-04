const mongoose = require('mongoose');

const CALL_DISPOSITIONS = Object.freeze({
  CONNECTED: 'Connected',
  BUSY: 'Busy',
  NO_ANSWER: 'No Answer',
  LEFT_VOICEMAIL: 'Left Voicemail',
  WRONG_NUMBER: 'Wrong Number',
  FOLLOW_UP_SCHEDULED: 'Follow-up Scheduled',
});

const CALL_TYPES = Object.freeze({
  OUTBOUND: 'Outbound',
  INBOUND: 'Inbound',
});

const callLogSchema = new mongoose.Schema(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      required: [true, 'Associated Lead ID is required'],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Caller User ID is required'],
      index: true,
    },
    phoneNumber: {
      type: String,
      required: [true, 'Phone number called is required'],
      trim: true,
    },
    callType: {
      type: String,
      enum: {
        values: Object.values(CALL_TYPES),
        message: '{VALUE} is not a valid call type',
      },
      default: CALL_TYPES.OUTBOUND,
    },
    disposition: {
      type: String,
      enum: {
        values: Object.values(CALL_DISPOSITIONS),
        message: '{VALUE} is not a valid call outcome',
      },
      required: [true, 'Call outcome / disposition is required'],
      index: true,
    },
    duration: {
      type: Number,
      default: 0,
      min: [0, 'Duration cannot be negative'], // stored in seconds
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    followUpDate: {
      type: Date,
      default: null,
    },
    updatedLeadStatus: {
      type: String,
      default: null,
    },
    recordingUrl: {
      type: String,
      default: null,
    },
    recordingDuration: {
      type: Number,
      default: 0,
    },
    hasRecording: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for rapid lookups and sorting
callLogSchema.index({ leadId: 1, createdAt: -1 });
callLogSchema.index({ userId: 1, createdAt: -1 });
callLogSchema.index({ disposition: 1, createdAt: -1 });

const CallLog = mongoose.model('CallLog', callLogSchema);

module.exports = {
  CallLog,
  CALL_DISPOSITIONS,
  CALL_TYPES,
};

