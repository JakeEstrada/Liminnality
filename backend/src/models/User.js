const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const tenantScopePlugin = require('./plugins/tenantScopePlugin');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  mobile: {
    type: String,
    trim: true,
    default: '',
  },
  /** Prior phone numbers (e.g. from an old system or before they changed devices). */
  previousPhoneNumbers: {
    type: [String],
    default: [],
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['super_admin', 'admin', 'manager', 'sales', 'installer', 'read_only', 'employee', 'shop_view'],
    default: 'employee'
  },
  isActive: {
    type: Boolean,
    default: false // New users need admin approval
  },
  isPending: {
    type: Boolean,
    default: true // New registrations are pending approval
  },
  lastLoginAt: {
    type: Date,
    default: null,
  },
  address: {
    type: String,
    trim: true,
    default: '',
  },
  /** Sidebar paths this user has chosen to hide. Locked pages are never stored here. */
  hiddenNavPaths: {
    type: [String],
    default: [],
  },
  /** Single profile image for the user (header, etc.) */
  profilePhoto: {
    filename: { type: String },
    path: { type: String },
    s3Key: { type: String },
    mimetype: { type: String, default: 'image/png' },
  },
}, {
  timestamps: true  // Automatically adds createdAt and updatedAt
});

userSchema.plugin(tenantScopePlugin);
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });

// Hash password before saving
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return ;
  
  this.password = await bcrypt.hash(this.password, 10);
  
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Don't return password in JSON responses
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  return user;
};

module.exports = mongoose.model('User', userSchema);
