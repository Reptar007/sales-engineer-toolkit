import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import '../styles/login.less';

const PasswordChangePage = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { changePassword, error, validationErrors, clearError, user, mustChangePassword } = useAuth();
  const navigate = useNavigate();

  // Redirect if user doesn't need to change password and is already logged in
  useEffect(() => {
    if (user && !mustChangePassword) {
      navigate('/', { replace: true });
    }
  }, [user, mustChangePassword, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearError();

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      return; // Error will be shown via validation
    }

    setIsSubmitting(true);
    const result = await changePassword(currentPassword || null, newPassword);
    setIsSubmitting(false);

    if (result.success) {
      // Password changed successfully, redirect to home
      navigate('/', { replace: true });
    }
  };

  return (
    <div className="login-container">
      <div className="login-header">
        <div className="logo-container">
          <h2>Change Password</h2>
          <img src="/saleswolf-icon.png" alt="SalesWolf" className="logo" />
        </div>
        {mustChangePassword && (
          <p>You must change your password before continuing</p>
        )}
        {!mustChangePassword && (
          <p>Update your password</p>
        )}
      </div>
      
      <div className="login-card">
        <form onSubmit={handleSubmit} className="login-form">
          {/* Current password field - optional if default password */}
          {!mustChangePassword && (
            <div className="form-group">
              <input
                id="currentPassword"
                type="password"
                placeholder=" "
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={error ? 'error' : ''}
              />
              <label htmlFor="currentPassword">Current Password</label>
            </div>
          )}

          {mustChangePassword && (
            <div className="info-message" style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
              <p>You're using the default password. Please set a new password.</p>
            </div>
          )}

          <div className="form-group">
            <input
              id="newPassword"
              type="password"
              placeholder=" "
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              className={error ? 'error' : ''}
            />
            <label htmlFor="newPassword">New Password</label>
          </div>
          
          <div className="form-group">
            <input
              id="confirmPassword"
              type="password"
              placeholder=" "
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className={error ? 'error' : ''}
            />
            <label htmlFor="confirmPassword">Confirm New Password</label>
          </div>

          {/* Password requirements */}
          <div className="password-requirements" style={{ marginBottom: '1rem', fontSize: '0.875rem', color: '#666' }}>
            <p style={{ margin: '0 0 0.5rem 0', fontWeight: '600' }}>Password must contain:</p>
            <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
              <li>At least 8 characters</li>
              <li>One capital letter</li>
              <li>One lowercase letter</li>
              <li>One number</li>
              <li>One special character</li>
            </ul>
          </div>

          {/* Validation errors */}
          {validationErrors && validationErrors.length > 0 && (
            <div className="error-message" style={{ marginBottom: '1rem' }}>
              <ul style={{ margin: 0, paddingLeft: '1.5rem', color: '#e74c3c' }}>
                {validationErrors.map((err, index) => (
                  <li key={index}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Password mismatch error */}
          {newPassword && confirmPassword && newPassword !== confirmPassword && (
            <div className="error-message" style={{ marginBottom: '1rem', color: '#e74c3c' }}>
              Passwords do not match
            </div>
          )}

          {/* General error */}
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
            disabled={isSubmitting || !newPassword || !confirmPassword || (newPassword !== confirmPassword)}
          >
            {isSubmitting ? 'Changing Password...' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PasswordChangePage;

