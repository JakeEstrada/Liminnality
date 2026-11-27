const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScopePlugin');

/**
 * One fingerprint per job, kept off the Job document the pipeline loads.
 * The number list is the worksheet note only.
 */
const jobFingerprintSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
      index: true,
    },
    text: {
      type: String,
      required: true,
    },
    embedding: {
      type: [Number],
      required: true,
    },
    embeddedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

jobFingerprintSchema.plugin(tenantScopePlugin);
jobFingerprintSchema.index({ tenantId: 1, jobId: 1 }, { unique: true });

module.exports = mongoose.model('JobFingerprint', jobFingerprintSchema);
