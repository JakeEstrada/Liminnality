const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScopePlugin');

const smsMessageSchema = new mongoose.Schema(
  {
    direction: {
      type: String,
      enum: ['inbound', 'outbound'],
      required: true,
    },
    from: {
      type: String,
      trim: true,
    },
    to: {
      type: String,
      trim: true,
    },
    body: {
      type: String,
      trim: true,
      default: '',
    },
    media: [
      {
        contentType: { type: String, trim: true, default: 'image/jpeg' },
        fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File' },
        filename: { type: String, trim: true },
        path: { type: String, trim: true },
        s3Key: { type: String, trim: true },
      },
    ],
    twilioSid: {
      type: String,
      trim: true,
      index: true,
    },
    deliveryStatus: {
      type: String,
      trim: true,
    },
    deliveredAt: Date,
    readAt: Date,
    statusUpdatedAt: Date,
    errorCode: String,
    errorMessage: String,
    source: {
      type: String,
      enum: ['adhoc', 'employee', 'appointment', 'inbound', 'payment_notification', 'other'],
      default: 'other',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

smsMessageSchema.plugin(tenantScopePlugin);

smsMessageSchema.index({ direction: 1, createdAt: -1 });

module.exports = mongoose.model('SmsMessage', smsMessageSchema);
