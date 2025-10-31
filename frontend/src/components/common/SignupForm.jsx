import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Signup Form Component
 */
function SignupForm({ onSwitchToLogin }) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    team: ''
  });
  const { register, error, setError, clearError } = useAuth();

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (formData.password !== formData.confirmPassword) {
      setError('🐺 The passwords don\'t match! Even wolves need to be in sync!');
      return;
    }
    
    register(formData.email, formData.password, formData.name, formData.team);
  };

  return (
    <div className="login-container">
      <div className="login-header">
        <div className="logo-container">
          <h2>Join SalesWolf</h2>
          <img src="/saleswolf-icon.png" alt="SalesWolf" className="logo" />
        </div>
        <p>Create your account to get started</p>
      </div>
      
      <div className="login-card">
        
        <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group">
                <input
                  id="name"
                  name="name"
                  type="text"
                  placeholder=" "
                  value={formData.name}
                  onChange={handleChange}
                  required
                  disabled={false}
                  className={error ? 'error' : ''}
                />
                <label htmlFor="name">Full Name</label>
              </div>
              
              <div className="form-group">
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder=" "
                  value={formData.email}
                  onChange={handleChange}
                  required
                  disabled={false}
                  className={error ? 'error' : ''}
                />
                <label htmlFor="email">Email</label>
              </div>
              
              <div className="form-group">
                <input
                  id="team"
                  name="team"
                  placeholder=" "
                  type="text"
                  value={formData.team}
                  onChange={handleChange}
                  required
                  disabled={false}
                  className={error ? 'error' : ''}
                />
                <label htmlFor="team">Team</label>
              </div>
              
              <div className="form-group">
                <input
                  id="password"
                  name="password"
                  type="password"
                  placeholder=" "
                  value={formData.password}
                  onChange={handleChange}
                  required
                  disabled={false}
                  className={error ? 'error' : ''}
                />
                <label htmlFor="password">Password</label>
              </div>
              
              <div className="form-group">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder=" "
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  required
                  disabled={false}
                  className={error ? 'error' : ''}
                />
                <label htmlFor="confirmPassword">Confirm Password</label>
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
            Create Account
          </button>
        </form>
        
        <div className="login-footer">
          <p>Already have an account? <button type="button" onClick={onSwitchToLogin} className="link-button">Sign in</button></p>
        </div>
      </div>
    </div>
  );
}

export default SignupForm;