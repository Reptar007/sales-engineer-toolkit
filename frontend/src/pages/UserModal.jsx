import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createUser, fetchTeams } from '../services/api';
import { useToast } from '../contexts/ToastContext';

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'sales_engineer_lead', label: 'Sales Engineer Lead' },
  { value: 'sales_engineer_2', label: 'Sales Engineer 2' },
  { value: 'sales_engineer_1', label: 'Sales Engineer 1' },
];

const SE_ROLES = new Set(['sales_engineer_1', 'sales_engineer_2', 'sales_engineer_lead']);

// Sentinel values for the team picker. Plain strings (not the empty string)
// so we can distinguish "no team" from "create a new one" without hitting
// the same falsy guard.
const TEAM_PICK_NONE = '__NONE__';
const TEAM_PICK_NEW = '__NEW__';

const UserModal = ({ isOpen, onClose, onSuccess }) => {
  const toast = useToast();
  const dialogRef = useRef(null);

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [roles, setRoles] = useState(['sales_engineer_1']);

  // Team picker state. `teamPick` is either a sentinel
  // (TEAM_PICK_NONE / TEAM_PICK_NEW) or the id of an existing team.
  const [teamPick, setTeamPick] = useState(TEAM_PICK_NONE);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDescription, setNewTeamDescription] = useState('');

  // Existing-teams list, lazily loaded the first time the modal opens.
  // Filtered down to teams that still need an SE so we never present an
  // option that the backend would reject.
  const [allTeams, setAllTeams] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const hasSERole = useMemo(() => roles.some((r) => SE_ROLES.has(r)), [roles]);

  const availableTeams = useMemo(
    () => allTeams.filter((t) => t.isActive !== false && !t.salesEngineer),
    [allTeams],
  );

  useEffect(() => {
    if (!isOpen) return;
    setEmail('');
    setFirstName('');
    setLastName('');
    setRoles(['sales_engineer_1']);
    setTeamPick(TEAM_PICK_NONE);
    setNewTeamName('');
    setNewTeamDescription('');
    setError(null);

    setTeamsLoading(true);
    fetchTeams()
      .then((res) => setAllTeams(res.teams || []))
      .catch((err) => {
        console.error('Failed to load teams for picker:', err);
        setAllTeams([]);
      })
      .finally(() => setTeamsLoading(false));
  }, [isOpen]);

  // If the admin removes all SE roles, reset the team picker — team
  // assignment is meaningless without an SE role and the backend rejects it.
  useEffect(() => {
    if (!hasSERole && teamPick !== TEAM_PICK_NONE) {
      setTeamPick(TEAM_PICK_NONE);
      setNewTeamName('');
      setNewTeamDescription('');
    }
  }, [hasSERole, teamPick]);

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
    setError(null);

    if (!email.trim() || !firstName.trim() || !lastName.trim()) {
      setError('Email, first name, and last name are required.');
      return;
    }
    if (roles.length === 0) {
      setError('Pick at least one role.');
      return;
    }
    if (teamPick === TEAM_PICK_NEW && !newTeamName.trim()) {
      setError('Provide a name for the new team or pick an existing one.');
      return;
    }

    const payload = {
      email: email.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      roles,
    };
    if (hasSERole) {
      if (teamPick === TEAM_PICK_NEW) {
        payload.teamName = newTeamName.trim();
        if (newTeamDescription.trim()) payload.teamDescription = newTeamDescription.trim();
      } else if (teamPick !== TEAM_PICK_NONE) {
        payload.teamId = teamPick;
      }
    }

    setSubmitting(true);
    try {
      const result = await createUser(payload);
      onSuccess?.({
        user: result.user,
        team: result.team,
        temporaryPassword: result.temporaryPassword,
      });
      onClose();
    } catch (err) {
      const msg = err.message || 'Failed to create user.';
      setError(msg);
      toast.error(msg);
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
                <span>Team</span>
                <select
                  value={teamPick}
                  onChange={(e) => setTeamPick(e.target.value)}
                  disabled={teamsLoading}
                >
                  <option value={TEAM_PICK_NONE}>
                    {teamsLoading ? 'Loading teams…' : 'No team — attach later'}
                  </option>
                  {availableTeams.length > 0 && (
                    <optgroup label="Existing teams (no SE assigned)">
                      {availableTeams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <option value={TEAM_PICK_NEW}>+ Create a new team…</option>
                </select>
                <small className="admin-form-hint">
                  Existing teams that already have a Sales Engineer aren&apos;t shown here. Reassign
                  from the Teams tab if needed.
                </small>
              </label>

              {teamPick === TEAM_PICK_NEW && (
                <>
                  <label className="admin-form-field">
                    <span>New team name</span>
                    <input
                      type="text"
                      value={newTeamName}
                      onChange={(e) => setNewTeamName(e.target.value)}
                      placeholder="Team Sonic"
                      required
                    />
                  </label>
                  <label className="admin-form-field">
                    <span>Team description (optional)</span>
                    <input
                      type="text"
                      value={newTeamDescription}
                      onChange={(e) => setNewTeamDescription(e.target.value)}
                    />
                  </label>
                </>
              )}
            </>
          )}

          <p className="admin-form-hint">
            A random temporary password will be generated and shown once after creation. The user
            will be required to change it on their first login.
          </p>

          {error && <p className="admin-form-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
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
