import { useState, useEffect } from 'react';
import { AuthContext } from './AuthContext';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null); // Changed to null to handle error messages
  const [validationErrors, setValidationErrors] = useState([]); // Array for validation errors
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  // True when the app should play the post-login data-warmup splash.
  // Flipped on after a successful login or after an initial token check
  // succeeds (fresh page reload while authenticated). Cleared on logout
  // and after the bootstrap gate finishes warming dashboard data, so
  // subsequent intra-app navigations don't replay the splash.
  const [needsBootstrap, setNeedsBootstrap] = useState(false);

  // Helper to get auth token from localStorage
  const getAuthToken = () => {
    return localStorage.getItem('authToken');
  };

  // Best-effort hydrate from /auth/me. The /auth/login endpoint
  // historically returned a slimmer user shape than /auth/me (e.g.
  // missing the SE team), so after a successful login we re-fetch /me
  // and merge it in. Fails silently — login itself is what matters.
  const hydrateUserFromMe = async (token) => {
    try {
      const response = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (data?.user) {
        setUser(data.user);
        localStorage.setItem('userData', JSON.stringify(data.user));
      }
      return data?.user ?? null;
    } catch {
      return null;
    }
  };

  // Check for existing authentication on app startup
  useEffect(() => {
    const checkAuthStatus = async () => {
      const token = getAuthToken();
      
      if (token) {
        try {
          const response = await fetch('/api/auth/me', {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            setUser(data.user);
            localStorage.setItem('userData', JSON.stringify(data.user));
            // Fresh page load while authenticated still needs to warm
            // dashboard data, so play the splash here too.
            setNeedsBootstrap(true);
          } else {
            // Token is invalid, clear it
            localStorage.removeItem('authToken');
            localStorage.removeItem('userData');
            setUser(null);
          }
        } catch (error) {
          console.error('Token verification error:', error);
          localStorage.removeItem('authToken');
          localStorage.removeItem('userData');
          setUser(null);
        }
      }
      
      setIsLoading(false);
    };

    checkAuthStatus();
  }, []);

  const clearError = () => {
    setError(null);
    setValidationErrors([]);
  };

  const login = async (email, password) => {
    // Clear any existing errors
    setError(null);
    setValidationErrors([]);
    
    // Check if fields are empty
    if (!email || !password) {
      setError('🐺 Something\'s not right with your info. Double-check it!');
      return;
    }
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok) {
        const userData = data.user;
        setUser(userData);
        setMustChangePassword(data.mustChangePassword || false);
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('userData', JSON.stringify(userData));
        // Fresh sign-in: trigger the splash screen so the user sees a
        // polished welcome and lands on a fully-warmed dashboard,
        // regardless of which route the post-login redirect targets.
        setNeedsBootstrap(true);
        // Background hydrate so any fields /auth/login doesn't return
        // (team membership, future profile additions) populate before
        // the splash lifts. Intentionally not awaited — login UX
        // shouldn't block on this.
        hydrateUserFromMe(data.token);
      } else {
        setError(data.error || '🐺 Oops! Looks like this wolf can\'t find the right den. Check your email and password!');
      }
    } catch (error) {
      console.error('Login error:', error);
      setError('🐺 Network error! Please check your connection and try again.');
    }
  };

  const register = async (email, password, firstName, lastName, roles, teamName, teamDescription) => {
    // Clear any existing errors
    setError(null);
    setValidationErrors([]);
    
    // Check if required fields are empty
    if (!email || !password || !firstName || !lastName) {
      setError('🐺 Email, password, first name, and last name are required!');
      return;
    }
    
    const token = getAuthToken();
    if (!token) {
      setError('🐺 You must be logged in as an admin to register new users.');
      return;
    }
    
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          email, 
          password, 
          firstName, 
          lastName, 
          roles: roles || ['sales_engineer_1'], // Default role if not provided
          teamName: teamName || null,
          teamDescription: teamDescription || null,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const userData = data.user;
        setUser(userData);
        setMustChangePassword(false); // New users don't need to change password
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('userData', JSON.stringify(userData));
        
        // Return success with optional team info
        return { success: true, user: userData, team: data.team };
      } else {
        // Handle validation errors (array) or single error
        if (data.errors && Array.isArray(data.errors)) {
          setValidationErrors(data.errors);
          setError(data.error || '🐺 Password validation failed');
        } else {
          setError(data.error || '🐺 Registration failed! Please try again.');
        }
        return { success: false, error: data.error, errors: data.errors };
      }
    } catch (error) {
      console.error('Registration error:', error);
      setError('🐺 Network error! Please check your connection and try again.');
      return { success: false, error: 'Network error' };
    }
  };

  const changePassword = async (currentPassword, newPassword) => {
    // Clear any existing errors
    setError(null);
    setValidationErrors([]);
    
    // Check if new password is provided
    if (!newPassword) {
      setError('🐺 New password is required!');
      return;
    }
    
    const token = getAuthToken();
    if (!token) {
      setError('🐺 You must be logged in to change your password.');
      return;
    }
    
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          currentPassword: currentPassword || null, // Optional if default password
          newPassword,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const userData = data.user;
        setUser(userData);
        setMustChangePassword(false); // Password changed, no longer need to change
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('userData', JSON.stringify(userData));
        
        return { success: true, user: userData };
      } else {
        // Handle validation errors (array) or single error
        if (data.errors && Array.isArray(data.errors)) {
          setValidationErrors(data.errors);
          setError(data.error || '🐺 Password validation failed');
        } else {
          setError(data.error || '🐺 Password change failed! Please try again.');
        }
        return { success: false, error: data.error, errors: data.errors };
      }
    } catch (error) {
      console.error('Change password error:', error);
      setError('🐺 Network error! Please check your connection and try again.');
      return { success: false, error: 'Network error' };
    }
  };

  const logout = () => {
    setUser(null);
    setMustChangePassword(false);
    localStorage.removeItem('authToken');
    localStorage.removeItem('userData');
    setError(null);
    setValidationErrors([]);
    // Reset so the next sign-in re-arms the post-login splash.
    setNeedsBootstrap(false);
  };

  // Called by the bootstrap gate once the dashboard data warm-up is
  // complete and the splash has finished its exit animation. Idempotent
  // so accidental double-calls during route transitions are safe.
  const markBootstrapped = () => setNeedsBootstrap(false);

  const value = {
    user,
    setUser,
    error,
    setError,
    validationErrors,
    setValidationErrors,
    clearError,
    login,
    register,
    changePassword,
    logout,
    isLoading,
    mustChangePassword,
    setMustChangePassword,
    needsBootstrap,
    markBootstrapped,
    getAuthToken, // Expose helper for other components
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};