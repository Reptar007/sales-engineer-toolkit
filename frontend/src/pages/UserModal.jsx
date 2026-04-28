import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'sales_engineer_lead', label: 'Sales Engineer Lead' },
  { value: 'sales_engineer_2', label: 'Sales Engineer 2' },
  { value: 'sales_engineer_1', label: 'Sales Engineer 1' },
];

const SE_ROLES = new Set(['sales_engineer_1', 'sales_engineer_2', 'sales_engineer_lead']);

const UserModal = ({ isOpen, onClose, onSuccess }) => {
  const dialogRef = useRef(null);
  const { register, error: authError, validationErrors, clearError } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [roles, setRoles] = useState(['sales_engineer_1']);
  const [teamName, setTeamName] = useState('');
  const [teamDescription, setTeamDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState(null);

  const hasSERole = useMemo(() => roles.some((r) => SE_ROLES.has(r)), [roles]);

  // Reset form whenever the modal opens, and clear stale auth errors.
  useEffect(() => {
    if (!isOpen) return;
    setEmail('');
    setPassword('');
    setFirstName('');
    setLastName('');
    setRoles(['sales_engineer_1']);
    setTeamName('');
    setTeamDescription('');
    setLocalError(null);
    clearError?.();
  }, [isOpen, clearError]);

  useEffect(() => {
    if (!isOpen) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  function onBackdropClick(e) {
    if (e.target === dialogRef.current) onClose();
  }

  function toggleRole(role) {
    setRoles((current) =>
      current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError(null);

    if (!email.trim() || !password || !firstName.trim() || !lastName.trim()) {
      setLocalError('Email, password, first name, and last name are all required.');
      return;
    }
    if (roles.length === 0) {
      setLocalError('Pick at least one role.');
      return;
    }
    if (teamName.trim() && !hasSERole) {
      setLocalError('Team name can only be set when at least one Sales Engineer role is selected.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await register(
        email.trim(),
        password,
        firstName.trim(),
        lastName.trim(),
        roles,
        teamName.trim() || null,
        teamDescription.trim() || null,
      );
      // The current AuthProvider.register doesn't always return a result
      // object on the failure path (it just sets the shared `error` state),
      // so we treat "result missing or success !== true" as failure and let
      // the auth error message render below.
      if (result?.success) {
        onSuccess?.();
        onClose();
      }
    } catch (err) {
      setLocalError(err.message || 'Failed to create user.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      className="modal-backdrop"
      onMouseDown={onBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-modal-title"
    >
      <div className="modal admin-modal" style={{ maxWidth: '32rem' }}>
        <h3 id="user-modal-title">Create New User</h3>

        <form onSubmit={handleSubmit} className="admin-form">
          <label className="admin-form-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@qawolf.com"
              autoFocus
              required
            />
          </label>

          <div className="admin-form-row">
            <label className="admin-form-field">
              <span>First name</span>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </label>
            <label className="admin-form-field">
              <span>Last name</span>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </label>
          </div>

          <label className="admin-form-field">
            <span>Initial password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <small className="admin-form-hint">
              The user will be prompted to change this on first login.
            </small>
          </label>

          <fieldset className="admin-form-field">
            <legend>Roles</legend>
            <div className="admin-form-checkbox-grid">
              {ROLE_OPTIONS.map((opt) => (
                <label key={opt.value} className="admin-form-checkbox">
                  <input
                    type="checkbox"
                    checked={roles.includes(opt.value)}
                    onChange={() => toggleRole(opt.value)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {hasSERole && (
            <>
              <label className="admin-form-field">
                <span>Team name (optional)</span>
                <input
                  type="text"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="Team Mario"
                />
                <small className="admin-form-hint">
                  Leave blank to add the SE without a team — you can attach them from the Teams tab later.
                </small>
              </label>
              {teamName.trim() && (
                <label className="admin-form-field">
                  <span>Team description (optional)</span>
                  <input
                    type="text"
                    value={teamDescription}
                    onChange={(e) => setTeamDescription(e.target.value)}
                  />
                </label>
              )}
            </>
          )}

          {localError && <p className="admin-form-error">{localError}</p>}
          {authError && !localError && <p className="admin-form-error">{authError}</p>}
          {validationErrors?.length > 0 && (
            <ul className="admin-form-error">
              {validationErrors.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserModal;
