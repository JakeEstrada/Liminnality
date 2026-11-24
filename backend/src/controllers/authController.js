const User = require('../models/User');
const {
  generateAccessToken,
  generateRefreshToken,
  generatePasswordResetToken,
  verifyPasswordResetToken,
  verifyRefreshToken,
} = require('../utils/generateToken');
const { sendPasswordResetEmail } = require('../services/emailService');
const { getFileStream, deleteStoredFileBinary } = require('./fileController');
const { recordUserAudit } = require('./auditLogController');
const { resolveClientNetwork } = require('../services/clientNetwork');

function getFrontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

function photoPayloadFromMulterFile(file) {
  if (!file) return null;
  if (file.key) {
    return {
      filename: file.originalname || 'photo.png',
      path: file.key,
      s3Key: file.key,
      mimetype: file.mimetype || 'image/png',
    };
  }
  return {
    filename: file.filename,
    path: file.path,
    s3Key: undefined,
    mimetype: file.mimetype || 'image/png',
  };
}

function hasPhotoDoc(doc) {
  return !!(doc && (doc.path || doc.s3Key || doc.filename));
}

// Register new user (requires admin approval)
async function register(req, res) {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    
    // Check if user exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Create user as pending (needs admin approval)
    const user = new User({
      name,
      email: email.toLowerCase(),
      password,
      role: 'employee', // Default to employee, admin will change it
      isActive: false,
      isPending: true
    });
    
    await user.save();
    
    res.status(201).json({
      message: 'Registration successful. Your account is pending admin approval.',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        isPending: true
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Login
async function login(req, res) {
  try {
    const { email, username, password } = req.body;
    
    // Support both email and username login
    const loginField = username || email;
    if (!loginField) {
      return res.status(400).json({ error: 'Email or username is required' });
    }
    
    // Find user by email or username (if username field exists, otherwise use email)
    // For now, we'll use email as the login field, but check if it matches username pattern
    let user = await User.findOne({
      $or: [{ email: loginField.toLowerCase() }, { email: loginField }],
    });
    if (!user) {
      user = await User.findOne({
        $or: [{ email: loginField.toLowerCase() }, { email: loginField }],
      }).setOptions({ bypassTenant: true });
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid email/username or password' });
    }
    
    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Check if pending approval
    if (user.isPending) {
      return res.status(401).json({ error: 'Your account is pending admin approval. Please contact an administrator.' });
    }
    
    // Check if active
    if (!user.isActive) {
      return res.status(401).json({ error: 'Account is inactive. Please contact an administrator.' });
    }
    
    const userWithTenant = await User.findById(user._id)
      .populate('tenantId', 'name slug logo updatedAt')
      .setOptions({ bypassTenant: true });

    const kioskMode = Boolean(req.body?.kiosk);

    // Generate tokens
    const accessToken = generateAccessToken(user._id, { kiosk: kioskMode });
    const refreshToken = generateRefreshToken(user._id, { kiosk: kioskMode });

    try {
      user.lastLoginAt = new Date();
      await user.save({ validateBeforeSave: false });
    } catch (error) {
      console.error('Failed to update last login time:', error);
    }

    try {
      const network = await resolveClientNetwork(req);
      await recordUserAudit({
        userId: user._id,
        tenantId: user.tenantId,
        type: 'login',
        label: kioskMode ? 'Signed in (kiosk / shop display)' : 'Signed in',
        path: '/login',
        ip: network.ip,
        locationCity: network.locationCity,
        locationRegion: network.locationRegion,
        locationCountry: network.locationCountry,
        locationLabel: network.locationLabel,
        locationIsp: network.locationIsp,
        locationSource: network.locationSource,
        io: req.app.get('io'),
        user,
        req,
      });
    } catch (error) {
      console.error('Failed to write sign-in activity:', error);
    }

    res.json({
      user: userWithTenant,
      accessToken,
      refreshToken
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Get current user
async function me(req, res) {
  const userWithTenant = await User.findById(req.user._id)
    .populate('tenantId', 'name slug logo updatedAt')
    .setOptions({ bypassTenant: true });
  res.json({ user: userWithTenant });
}

// Logout (client-side handles token removal)
async function logout(req, res) {
  try {
    const network = await resolveClientNetwork(req);
    await recordUserAudit({
      userId: req.user._id,
      tenantId: req.user.tenantId,
      type: 'logout',
      label: 'Signed out',
      path: typeof req.body?.path === 'string' ? req.body.path : '',
      ip: network.ip,
      locationCity: network.locationCity,
      locationRegion: network.locationRegion,
      locationCountry: network.locationCountry,
      locationLabel: network.locationLabel,
      locationIsp: network.locationIsp,
      locationSource: network.locationSource,
      io: req.app.get('io'),
      user: req.user,
      req,
    });
  } catch (error) {
    console.error('Failed to write sign-out activity:', error);
  }
  res.json({ message: 'Logged out successfully' });
}

async function refresh(req, res) {
  try {
    const refreshToken = req.body?.refreshToken;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload?.userId) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const user = await User.findById(payload.userId).setOptions({ bypassTenant: true });
    if (!user || user.isPending || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    const kioskMode = Boolean(req.body?.kiosk);
    const accessToken = generateAccessToken(user._id, { kiosk: kioskMode });
    const newRefreshToken = generateRefreshToken(user._id, { kiosk: kioskMode });

    res.json({
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Forgot password - find user by email
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = await User.findOne({ email: email.toLowerCase() }).setOptions({ bypassTenant: true });
    }
    if (!user) {
      return res.json({
        message: 'If an account with that email exists, a password reset link has been sent.',
      });
    }

    const resetToken = generatePasswordResetToken(user.email);
    const resetLink = `${getFrontendUrl()}/reset-password?token=${encodeURIComponent(resetToken)}`;

    try {
      await sendPasswordResetEmail({
        toEmail: user.email,
        userName: user.name,
        resetLink,
      });
    } catch (emailError) {
      console.error('Password reset email failed:', emailError);
      return res.status(500).json({ error: 'Unable to send password reset email. Please try again later.' });
    }

    res.json({
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Forgot username - find user by email
async function forgotUsername(req, res) {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = await User.findOne({ email: email.toLowerCase() }).setOptions({ bypassTenant: true });
    }
    if (!user) {
      // Don't reveal if user exists for security
      return res.json({ 
        message: 'If an account with that email exists, your username has been sent.' 
      });
    }
    
    // In a real app, you would send an email with the username
    // For now, we'll return it (in production, only send via email)
    res.json({ 
      message: 'If an account with that email exists, your username has been sent.',
      username: user.email // Email is used as username
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Reset password using the signed token from the reset email
async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Reset token and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }

    const payload = verifyPasswordResetToken(token);
    if (!payload) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    }

    let user = await User.findOne({ email: payload.email });
    if (!user) {
      user = await User.findOne({ email: payload.email }).setOptions({ bypassTenant: true });
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/** Authenticated: stream the current user's profile photo. */
async function getMyProfilePhoto(req, res) {
  try {
    const user = await User.findById(req.user._id).select('profilePhoto').setOptions({ bypassTenant: true });
    const resolved = user?.profilePhoto;
    if (!hasPhotoDoc(resolved)) {
      return res.status(404).end();
    }
    const pseudoFile = {
      filename: resolved.filename,
      path: resolved.path,
      s3Key: resolved.s3Key,
      mimetype: resolved.mimetype,
    };
    res.setHeader('Content-Type', resolved.mimetype || 'image/png');
    res.setHeader('Cache-Control', 'private, no-cache');
    const stream = await getFileStream(pseudoFile);
    stream.on('error', (err) => {
      console.error('getMyProfilePhoto stream:', err);
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    console.error('getMyProfilePhoto:', error);
    if (!res.headersSent) res.status(500).end();
  }
}

async function uploadUserProfilePhoto(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded.' });
    }

    const user = await User.findById(req.user._id).setOptions({ bypassTenant: true });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const raw = await User.collection.findOne({ _id: user._id });
    async function delPhotoDoc(doc) {
      if (doc && (doc.path || doc.s3Key || doc.filename)) {
        await deleteStoredFileBinary({
          filename: doc.filename,
          path: doc.path,
          s3Key: doc.s3Key,
          mimetype: doc.mimetype,
        });
      }
    }
    await delPhotoDoc(raw?.profilePhotoLight);
    await delPhotoDoc(raw?.profilePhotoDark);
    await delPhotoDoc(user.profilePhoto);

    user.profilePhoto = photoPayloadFromMulterFile(req.file);
    await user.save();
    await User.collection.updateOne(
      { _id: user._id },
      { $unset: { profilePhotoLight: '', profilePhotoDark: '' } }
    );

    const fresh = await User.findById(user._id).setOptions({ bypassTenant: true });
    const userResponse = fresh.toJSON();
    delete userResponse.password;
    res.json({
      message: 'Profile photo updated',
      user: userResponse,
    });
  } catch (error) {
    console.error('uploadUserProfilePhoto:', error);
    res.status(500).json({ error: error.message || 'Failed to upload profile photo' });
  }
}

// Update own profile (name required; address optional; email cannot be changed)
async function updateProfile(req, res) {
  try {
    const { name, address } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    // User is already attached to req by requireAuth middleware
    const user = req.user;
    user.name = name.trim();
    if (address !== undefined) {
      user.address = address == null ? '' : String(address).trim();
    }
    await user.save();
    
    const userResponse = user.toJSON();
    delete userResponse.password;
    
    res.json({ 
      message: 'Profile updated successfully',
      user: userResponse
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

const HIDEABLE_NAV_PATHS = new Set([
  '/tasks',
  '/messages',
  '/metrics',
  '/bills',
  '/payroll',
  '/commission-logs',
  '/takeoff-sheet',
  '/vendors',
  '/users',
  '/archive',
  '/completed-jobs',
  '/developer',
  '/developer/analytics',
]);

async function updateNavVisibility(req, res) {
  try {
    const raw = Array.isArray(req.body?.hiddenNavPaths) ? req.body.hiddenNavPaths : [];
    const hiddenNavPaths = [...new Set(raw.map((path) => String(path || '').trim()))]
      .filter((path) => HIDEABLE_NAV_PATHS.has(path))
      .slice(0, 40);
    const user = req.user;
    user.hiddenNavPaths = hiddenNavPaths;
    await user.save();
    const userResponse = user.toJSON();
    delete userResponse.password;
    res.json({ hiddenNavPaths, user: userResponse });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to save navigation' });
  }
}

// Change own password
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }
    
    // User is already attached to req by requireAuth middleware
    const user = req.user;
    
    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // Update password (will be hashed by pre-save hook)
    user.password = newPassword;
    await user.save();
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  register,
  login,
  refresh,
  me,
  logout,
  forgotPassword,
  forgotUsername,
  resetPassword,
  updateProfile,
  updateNavVisibility,
  changePassword,
  getMyProfilePhoto,
  uploadUserProfilePhoto,
};
