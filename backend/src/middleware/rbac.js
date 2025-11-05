export const requireRole = (roles) => {
  return (req, res, next) => {
    // Check if user is authenticated
    if (!req.user || !req.user.roles) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Normalize roles input (handle both string and array)
    const requiredRoles = Array.isArray(roles) ? roles : [roles];
    const userRoles = req.user.roles || [];

    // Admin has access to everything
    if (userRoles.includes('admin')) {
      return next();
    }

    // Check if user has any of the required roles
    const hasRequiredRole = requiredRoles.some((role) => userRoles.includes(role));

    if (!hasRequiredRole) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};
