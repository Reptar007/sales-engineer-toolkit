import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import '../styles/login.less';

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage(data.message || 'If an account exists with this email, a password reset link has been sent.');
      } else {
        setError(data.error || 'An error occurred. Please try again.');
      }
    } catch (error) {
      console.error('Forgot password error:', error);
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-header">
        <div className="logo-container">
          <h2>Reset Password</h2>
          <img src="/saleswolf-icon.png" alt="SalesWolf" className="logo" />
        </div>
        <p>Enter your email to receive a password reset link</p>
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
              disabled={isSubmitting}
              className={error ? 'error' : ''}
            />
            <label htmlFor="email">Email</label>
          </div>

          {error && (
            <div className="error-message">
              <span className="error-text">{error}</span>
              <button 
                type="button" 
                className="dismiss-button"
                onClick={() => setError('')}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}

          {message && (
            <div className="success-message">
              {message}
            </div>
          )}
          
          <button 
            type="submit" 
            className="login-button"
            disabled={isSubmitting || !email}
          >
            {isSubmitting ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>
        
        <div className="login-footer">
          <p>
            <Link to="/login" className="link-button">Back to Sign In</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;

