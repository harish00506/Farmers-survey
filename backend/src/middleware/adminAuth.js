export const requireAdminApiKey = (req, res, next) => {
  // Admin auth is opt-in. To enable, set ADMIN_AUTH_ENABLED=true and provide ADMIN_API_KEY in env.
  const enabled = String(process.env.ADMIN_AUTH_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) {
    // auth disabled — allow all admin routes (safe default for your current workspace)
    return next();
  }

  const expected = process.env.ADMIN_API_KEY;
  const provided = req.headers['x-admin-api-key'] || req.headers['x-api-key'];

  if (!expected) {
    console.warn('⚠️ ADMIN_AUTH_ENABLED=true but ADMIN_API_KEY is not set in environment - refusing access.');
    return res.status(500).json({ success: false, error: 'Server misconfiguration: ADMIN_API_KEY not set' });
  }

  if (!provided || provided !== expected) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  return next();
};
