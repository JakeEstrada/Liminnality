const mongoose = require('mongoose');
const { verifyAccessToken } = require('../utils/generateToken');
const User = require('../models/User');
const { runWithTenantContext } = require('./tenantContext');

function readOnlyRequestAllowed(method, originalUrl) {
  const verb = String(method || 'GET').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return true;
  const path = String(originalUrl || '').split('?')[0];
  if (verb === 'POST' && /\/auth\/logout$/.test(path)) return true;
  if (verb === 'POST' && /\/audit-logs\/?$/.test(path)) return true;
  if (verb === 'POST' && /\/tts\/(speech|speech-stream|transcribe)$/.test(path)) return true;
  return false;
}

async function requireAuth(req, res, next) {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'Database connection unavailable',
        message: 'MongoDB is not connected yet. Retry in a few seconds.',
      });
    }

    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer '
    
    // Verify token
    const decoded = verifyAccessToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Get user from database without tenant filter, then scope subsequent queries by that user tenant
    const user = await User.findById(decoded.userId).setOptions({ bypassTenant: true });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }
    
    if (user.role === 'read_only' && !readOnlyRequestAllowed(req.method, req.originalUrl || req.url)) {
      return res.status(403).json({ error: 'Read-only accounts cannot change data' });
    }

    // Attach user to request
    req.user = user;
    runWithTenantContext(
      {
        tenantId: user.tenantId ? String(user.tenantId) : null,
        bypassTenant: false,
      },
      () => next()
    );
  } catch (error) {
    res.status(500).json({ error: 'Authentication error' });
  }
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only super admins can access this resource' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !['super_admin', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireSuperAdmin, requireAdmin, readOnlyRequestAllowed };
