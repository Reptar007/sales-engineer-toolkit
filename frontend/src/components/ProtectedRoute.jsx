import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Navigate, useLocation } from 'react-router-dom';
import LoadingSpinner from './LoadingSpinner';
import { CSM_PATHS, isCsmOnly } from '../utils/roles';

const ProtectedRoute = ({ children }) => {
  const { user, isLoading, mustChangePassword } = useAuth();
  const location = useLocation();

  // Show loading while checking auth
  if (isLoading) {
    return <LoadingSpinner />;
  }

  // Redirect to login if not authenticated (preserve the location they were trying to access)
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Redirect to password change if needed (unless already on password change page)
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  // Customer success accounts see their clients and Lone Wolves only; the
  // SE pages would only show errors (their APIs refuse a CSM token).
  if (isCsmOnly(user) && !CSM_PATHS.has(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  // User is authenticated and password is changed (or on password change page)
  return children;
};

export default ProtectedRoute;
