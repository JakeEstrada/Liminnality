const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Organization logos (set by tenant super_admin); served at GET /tenants/branding/:id/logo?mode=light|dark
    // `logo` is kept for backward compatibility and treated as the light logo.
    logo: {
      filename: { type: String },
      path: { type: String },
      s3Key: { type: String },
      mimetype: { type: String, default: 'image/png' },
    },
    logoLight: {
      filename: { type: String },
      path: { type: String },
      s3Key: { type: String },
      mimetype: { type: String, default: 'image/png' },
    },
    logoDark: {
      filename: { type: String },
      path: { type: String },
      s3Key: { type: String },
      mimetype: { type: String, default: 'image/png' },
    },
    // Per-tenant pipeline UI: custom stage labels + hidden flags (keys = stage enum id)
    pipelineStageOverrides: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
    /** Static header block on Finance Hub estimate documents */
    estimateDocumentSettings: {
      logoUrl: { type: String, trim: true },
      logo: {
        filename: { type: String },
        path: { type: String },
        s3Key: { type: String },
        mimetype: { type: String, default: 'image/png' },
      },
      companyName: { type: String, trim: true },
      addressLine1: { type: String, trim: true },
      addressLine2: { type: String, trim: true },
      phoneLabel: { type: String, trim: true },
      phone: { type: String, trim: true },
      website: { type: String, trim: true },
      email: { type: String, trim: true },
    },
    /** Microsoft Graph mailbox used to pull team worksheets into Paarth. Tokens are not selected by default. */
    outlookLink: {
      mailbox: { type: String, trim: true },
      mailboxName: { type: String, trim: true },
      refreshToken: { type: String, select: false },
      accessToken: { type: String, select: false },
      accessTokenExpiresAt: { type: Date, select: false },
      connectedAt: { type: Date },
      connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      lastSyncAt: { type: Date },
      lastSyncError: { type: String, trim: true, default: '' },
      teamSenders: [
        {
          email: { type: String, trim: true, lowercase: true },
          name: { type: String, trim: true, default: '' },
        },
      ],
      subjectHints: { type: [String], default: ['worksheet'] },
    },
    /** Plaid Item for this org (Finance Hub / register). accessToken is not selected by default. */
    plaidLink: {
      itemId: { type: String },
      accessToken: { type: String, select: false },
      institutionId: { type: String },
      institutionName: { type: String },
      linkedAt: { type: Date },
      linkedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
    /** SMS alert when a job payment schedule row is marked paid. */
    paymentNotificationSettings: {
      enabled: { type: Boolean, default: false },
      recipients: [
        {
          kind: { type: String, enum: ['user', 'contact'], required: true },
          id: { type: mongoose.Schema.Types.ObjectId, required: true },
        },
      ],
      phoneNumbers: [{ type: String, trim: true }],
    },
    /** Customer SMS drafts shown when a job is dragged onto a pipeline stage. */
    pipelineSmsTemplates: [
      {
        stage: { type: String, required: true, trim: true },
        name: { type: String, trim: true, default: '' },
        body: { type: String, trim: true, maxlength: 1500, default: '' },
        enabled: { type: Boolean, default: true },
      },
    ],
    /** Advertising dollars entered on the Metrics page. */
    adSpend: [
      {
        month: { type: String, required: true, trim: true },
        channel: { type: String, required: true, trim: true },
        amount: { type: Number, default: 0 },
        note: { type: String, trim: true, default: '', maxlength: 200 },
      },
    ],
    /** Named SMS drafts sent from a job card (not tied to a pipeline stage). */
    cannedSmsTemplates: [
      {
        name: { type: String, trim: true, maxlength: 80, default: '' },
        body: { type: String, trim: true, maxlength: 1500, default: '' },
        enabled: { type: Boolean, default: true },
      },
    ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Tenant', tenantSchema);
