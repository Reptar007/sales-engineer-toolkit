import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import SignupForm from './SignupForm';

/**
 * Login Form Component
 */
function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showSignup, setShowSignup] = useState(false);
  const { login, error, clearError } = useAuth();

  const handleSubmit = (e) => {
    e.preventDefault();
    login(email, password);
  };

  const handleSwitchToSignup = () => {
    setShowSignup(true);
  };

  const handleSwitchToLogin = () => {
    setShowSignup(false);
  };

  // Show signup form if toggled
  if (showSignup) {
    return <SignupForm onSwitchToLogin={handleSwitchToLogin} />;
  }

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
              
              <div className="form-group">
                <input
                  id="password"
                  type="password"
                  placeholder=" "
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={false}
                  className={error ? 'error' : ''}
                />
                <label htmlFor="password">Password</label>
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
          <p>Don't have an account? <button type="button" onClick={handleSwitchToSignup} className="link-button">Sign up</button></p>
        </div>
      </div>
    </div>
  );
}

export default LoginForm;
