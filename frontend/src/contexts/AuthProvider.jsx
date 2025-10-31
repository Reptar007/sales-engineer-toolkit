import { useState, useEffect } from 'react';
import { AuthContext } from './AuthContext';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing authentication on app startup
  useEffect(() => {
    const checkAuthStatus = async () => {
      const token = localStorage.getItem('authToken');
      
      if (token) {
        try {
          const response = await fetch('/api/auth/verify', {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            setUser(data.user);
            localStorage.setItem('userData', JSON.stringify(data.user));
          } else {
            // Token is invalid, clear it
            localStorage.removeItem('authToken');
            localStorage.removeItem('userData');
          }
        } catch (error) {
          console.error('Token verification error:', error);
          localStorage.removeItem('authToken');
          localStorage.removeItem('userData');
        }
      }
      
      setIsLoading(false);
    };

    checkAuthStatus();
  }, []);

  const clearError = () => {
    setError(false);
  };

  const login = async (email, password) => {
    // Clear any existing error
    setError(false);
    
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
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('userData', JSON.stringify(userData));
      } else {
        setError(data.error || '🐺 Oops! Looks like this wolf can\'t find the right den. Check your email and password!');
      }
    } catch (error) {
      console.error('Login error:', error);
      setError('🐺 Network error! Please check your connection and try again.');
    }
  };

  const register = async (email, password, name, team) => {
    // Clear any existing error
    setError(false);
    
    // Check if fields are empty
    if (!email || !password || !name) {
      setError('🐺 Something\'s not right with your info. Double-check it!');
      return;
    }
    
    // Check password length
    if (password.length < 6) {
      setError('🐺 That password is too weak for our wolf pack! Make it stronger!');
      return;
    }
    
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password, name, team }),
      });

      const data = await response.json();

      if (response.ok) {
        const userData = data.user;
        setUser(userData);
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('userData', JSON.stringify(userData));
      } else {
        setError(data.error || '🐺 Registration failed! Please try again.');
      }
    } catch (error) {
      console.error('Registration error:', error);
      setError('🐺 Network error! Please check your connection and try again.');
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('authToken');
    localStorage.removeItem('userData');
    setError(false);
  };

  const value = {
    user,
    setUser,
    error,
    setError,
    clearError,
    login,
    register,
    logout,
    isLoading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};