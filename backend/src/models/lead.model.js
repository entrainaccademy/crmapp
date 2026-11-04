const mongoose = require('mongoose');

const LEAD_STATUS = Object.freeze({
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  PROPOSAL_SENT: 'Proposal Sent',
  WON: 'Won',
  LOST: 'Lost',
});

const LEAD_PRIORITY = Object.freeze({
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
});

const LEAD_SOURCES = Object.freeze([
  'Website',
  'Referral',
  'Cold Call',
  'Social Media',
  'Email Campaign',
  'Trade Show',
  'Other',
]);

const leadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Lead contact name is required'],
      trim: true,
      maxlength: [120, 'Name cannot exceed 120 characters'],
    },
    company: {
      type: String,
      trim: true,
      default: '',
      maxlength: [120, 'Company name cannot exceed 120 characters'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: Object.values(LEAD_STATUS),
        message: '{VALUE} is not a valid lead status',
      },
      default: LEAD_STATUS.NEW,
      index: true,
    },
    priority: {
      type: String,
      enum: {
        values: Object.values(LEAD_PRIORITY),
        message: '{VALUE} is not a valid priority',
      },
      default: LEAD_PRIORITY.MEDIUM,
      index: true,
    },
    source: {
      type: String,
      default: 'Website',
      trim: true,
    },
    value: {
      type: Number,
      default: 0,
      min: [0, 'Lead value cannot be negative'],
    },
    followUpDate: {
      type: Date,
      default: null,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Helpful compound indexes for query efficiency
leadSchema.index({ assignedTo: 1, status: 1 });
leadSchema.index({ createdAt: -1 });

const Lead = mongoose.model('Lead', leadSchema);

module.exports = {
  Lead,
  LEAD_STATUS,
  LEAD_PRIORITY,
  LEAD_SOURCES,
};

