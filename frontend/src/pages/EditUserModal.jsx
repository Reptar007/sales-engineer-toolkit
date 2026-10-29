import React, { useEffect, useRef, useState } from 'react';
import { updateUser } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { ROLE_OPTIONS } from '../utils/roles';

const rolesOf = (user) => (user?.userRoles || []).map((r) => r.role);
const sameRoles = (a, b) => a.length === b.length && a.every((role) => b.includes(role));

/**
 * Admin: edit an existing user's profile fields.
 *
 * Fields supported:
 *  - First name / Last name (User.firstName / User.lastName)
 *  - Email (User.email — the credential used to log in)
 *  - Roles (UserRole rows). They apply on the user's next request; their
 *    sidebar catches up when they reload. An admin cannot drop their own
 *    admin role, here or on the server.
 *  - Salesforce email (SalesEngineer.salesforceEmail) — only rendered when the
 *    target user has an SE record. Defaults to the app email so the admin
 *    can keep them in sync with one click.
 *
 * Mirrors the UserModal styling/layout so create + edit feel like the same
 * tool from the admin Users tab.
 */
const EditUserModal = ({ isOpen, user, onClose, onSaved }) => {
  const toast = useToast();
  const dialogRef = useRef(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [salesforceEmail, setSalesforceEmail] = useState('');
  // When true, the SF email field tracks the app email field as the admin
  // types. Flips to false the moment the admin manually edits SF email so
  // we don't clobber an intentional split.
  const [syncSalesforceEmail, setSyncSalesforceEmail] = useState(true);
  const [roles, setRoles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const hasSE = Boolean(user?.salesEngineer);
  const isSelf = useAuth().user?.id === user?.id;

  useEffect(() => {
    if (!isOpen || !user) return;
    setFirstName(user.firstName ?? '');
    setLastName(user.lastName ?? '');
    setEmail(user.email ?? '');
    const initialSfEmail = user.salesEngineer?.salesforceEmail ?? '';
    setSalesforceEmail(initialSfEmail);
    // Default to "in sync" when SF email matches the app email or is empty;
    // otherwise the admin clearly wants them tracked separately.
    setSyncSalesforceEmail(!initialSfEmail || initialSfEmail === user.email);
    setRoles(rolesOf(user));
    setError(null);
  }, [isOpen, user]);

  useEffect(() => {
    if (!isOpen) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  function handleEmailChange(value) {
    setEmail(value);
    if (syncSalesforceEmail && hasSE) {
      setSalesforceEmail(value);
    }
  }

  function handleSalesforceEmailChange(value) {
    setSalesforceEmail(value);
    setSyncSalesforceEmail(false);
  }

  function toggleRole(role) {
    setRoles((current) =>
      current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
    );
  }

  function onBackdropClick(e) {
    if (e.target === dialogRef.current) onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('Email is required.');
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      setError('First name and last name are required.');
      return;
    }
    if (roles.length === 0) {
      setError('Pick at least one role.');
      return;
    }

    // Build a minimal patch so we never overwrite fields the admin didn't
    // actually touch. Compare against the current user record before
    // including the field.
    const patch = {};
    if ((user.firstName ?? '') !== firstName.trim()) patch.firstName = firstName.trim();
    if ((user.lastName ?? '') !== lastName.trim()) patch.lastName = lastName.trim();
    if (user.email !== email.trim()) patch.email = email.trim();
    if (!sameRoles(rolesOf(user), roles)) patch.roles = roles;
    if (hasSE) {
      const currentSf = user.salesEngineer?.salesforceEmail ?? '';
      if (currentSf !== salesforceEmail.trim()) {
        patch.salesforceEmail = salesforceEmail.trim();
      }
    }

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSubmitting(true);
    try {
      await updateUser(user.id, patch);
      onSaved?.();
      onClose();
    } catch (err) {
      const msg = err.message || 'Failed to update user.';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen || !user) return null;

  const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email || 'user';

  return (
    <div
      ref={dialogRef}
      className="modal-backdrop"
      onMouseDown={onBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-user-modal-title"
    >
      <div className="modal admin-modal" style={{ maxWidth: '32rem' }}>
        <h3 id="edit-user-modal-title">Edit {fullName}</h3>

        <form onSubmit={handleSubmit} className="admin-form">
          <div className="admin-form-row">
            <label className="admin-form-field">
              <span>First name</span>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoFocus
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
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              required
            />
            <small className="admin-form-hint">
              The login credential. Changing it updates the email this user signs in with.
            </small>
          </label>

          <fieldset className="admin-form-field">
            <legend>Roles</legend>
            <div className="admin-form-checkbox-grid">
              {ROLE_OPTIONS.map((opt) => {
                const ownAdmin = isSelf && opt.value === 'admin';
                return (
                  <label key={opt.value} className="admin-form-checkbox">
                    <input
                      type="checkbox"
                      checked={roles.includes(opt.value)}
                      onChange={() => toggleRole(opt.value)}
                      disabled={ownAdmin}
                    />
                    <span>{opt.label}</span>
                  </label>
                );
              })}
            </div>
            <small className="admin-form-hint">
              Takes effect right away; they see the new menu after a reload.
              {isSelf && ' You cannot remove your own admin role.'}
            </small>
          </fieldset>

          {hasSE && (
            <label className="admin-form-field">
              <span>Salesforce email</span>
              <input
                type="email"
                value={salesforceEmail}
                onChange={(e) => handleSalesforceEmailChange(e.target.value)}
                placeholder={email}
              />
              <small className="admin-form-hint">
                Used to match this Sales Engineer to Salesforce records. Leave blank to clear.
                {syncSalesforceEmail && hasSE && ' Currently tracking the app email above.'}
              </small>
            </label>
          )}

          {error && <p className="admin-form-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditUserModal;
