import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Login Form Component
 */
function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { login, error, clearError, user, mustChangePassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Redirect after successful login
  useEffect(() => {
    if (user) {
      // If user needs to change password, redirect to change-password page
      if (mustChangePassword) {
        navigate('/change-password', { replace: true });
      } else {
        // Get the original destination from location state, or default to home
        const from = location.state?.from?.pathname || '/';
        navigate(from, { replace: true });
      }
    }
  }, [user, mustChangePassword, navigate, location]);

  const handleSubmit = (e) => {
    e.preventDefault();
    login(email, password);
  };

  const handleForgotPassword = () => {
    navigate('/forgot-password');
  };

  return (
    <div className="login-container">
      <div className="login-header">
        <div className="logo-container">
          <h2>Welcome to SalesWolf</h2>
          <img src="/saleswolf-icon.png" alt="SalesWolf" className="logo" />
        </div>
        <p>Sign in to access your projects</p>
      </div>
      
      <div className="login-card">
        
            <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group">
                <input
                  id="email"
                  type="email"
                  placeholder=" "
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={false}
                  className={error ? 'error' : ''}
                />
                <label htmlFor="email">Email</label>
              </div>
              
              <div className="form-group password-group">
                <div className="password-input-wrapper">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder=" "
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={false}
                    className={error ? 'error' : ''}
                    autoComplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-form-type="other"
                  />
                  <label htmlFor="password">Password</label>
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={0}
                  >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  )}
                </button>
                </div>
              </div>
          
          {error && (
            <div className="error-message">
              <span className="error-text">{error}</span>
              <button 
                type="button" 
                className="dismiss-button"
                onClick={clearError}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}
          
          <button 
            type="submit" 
            className="login-button"
                disabled={false}
          >
            Sign In
          </button>
        </form>
        
        <div className="login-footer">
          <p><button type="button" onClick={handleForgotPassword} className="link-button">Forgot password?</button></p>
        </div>
      </div>
    </div>
  );
}

export default LoginForm;
