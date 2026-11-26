const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScopePlugin');

const rfidEmployeeProfileSchema = new mongoose.Schema(
  {
    /** Normalized display name key, e.g. "felix" */
    employeeKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    /** HHMM-style token, e.g. "600" */
    shiftIn: {
      type: String,
      trim: true,
      default: '600',
    },
    /** HHMM-style token, e.g. "1430" */
    shiftOut: {
      type: String,
      trim: true,
      default: '1430',
    },
    breakMinutes: {
      type: Number,
      default: 30,
      min: 0,
      max: 480,
    },
    ratePerHour: {
      type: String,
      trim: true,
      default: '',
    },
    /** false keeps the person off payroll without deleting tag, PIN, or phone numbers. */
    onRoster: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

rfidEmployeeProfileSchema.plugin(tenantScopePlugin);
rfidEmployeeProfileSchema.index({ tenantId: 1, employeeKey: 1 }, { unique: true });

module.exports = mongoose.model('RfidEmployeeProfile', rfidEmployeeProfileSchema);
