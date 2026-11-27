const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScopePlugin');

/**
 * One stored line per job note, worksheet scrape, crew note, or task.
 * Kept off the Job document the pipeline loads. Search hangs off jobId.
 */
const jobMemorySchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ['note', 'worksheet', 'crew', 'task'],
      required: true,
    },
    sourceId: {
      type: String,
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    at: {
      type: Date,
      index: true,
    },
    embedding: {
      type: [Number],
    },
    embeddedAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

jobMemorySchema.plugin(tenantScopePlugin);
jobMemorySchema.index({ tenantId: 1, jobId: 1, kind: 1, sourceId: 1 }, { unique: true });
jobMemorySchema.index({ tenantId: 1, at: -1 });

module.exports = mongoose.model('JobMemory', jobMemorySchema);
