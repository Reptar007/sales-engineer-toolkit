import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  attachSEToTeam,
  createAE,
  createTeam,
  deleteAE,
  fetchTeams,
  fetchUsersWithoutTeam,
  updateAE,
  updateTeam,
} from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

// Small modal shell that reuses the existing .modal-backdrop / .modal styles
// from App.css. Keeps focus trapping minimal — we close on Escape and on
// backdrop mousedown to mirror the existing UserModal behavior.
function Modal({ isOpen, onClose, titleId, title, children, footer, wide = false }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal admin-modal" style={wide ? { maxWidth: '32rem' } : undefined}>
        <h3 id={titleId}>{title}</h3>
        {children}
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>
  );
}

function teamLabel(team) {
  return team.salesEngineer?.user
    ? `${team.salesEngineer.user.firstName ?? ''} ${team.salesEngineer.user.lastName ?? ''}`.trim() ||
        team.salesEngineer.user.email
    : 'No SE assigned';
}

function CreateTeamModal({ isOpen, onClose, onCreated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setDescription('');
      setError(null);
    }
  }, [isOpen]);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Team name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createTeam({ name: trimmedName, description: description.trim() || null });
      toast.success(`Team "${trimmedName}" created.`);
      onCreated();
      onClose();
    } catch (err) {
      const msg = err.message || 'Failed to create team.';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      titleId="create-team-title"
      title="Create Team"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={submitting} className="btn-ghost">
            Cancel
          </button>
          <button
            type="submit"
            form="create-team-form"
            disabled={submitting}
            className="btn-primary"
          >
            {submitting ? 'Creating…' : 'Create team'}
          </button>
        </>
      }
    >
      <form id="create-team-form" onSubmit={handleSubmit} className="admin-form">
        <label className="admin-form-field">
          <span>Team name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team Mario"
            autoFocus
          />
        </label>
        <label className="admin-form-field">
          <span>Description (optional)</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="…"
          />
        </label>
        {error && <p className="admin-form-error">{error}</p>}
      </form>
    </Modal>
  );
}

function AttachSEModal({ isOpen, onClose, team, onAttached }) {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setUserId('');
    setError(null);
    setLoading(true);
    fetchUsersWithoutTeam()
      .then((res) => setUsers(res.users || []))
      .catch((err) => setError(err.message || 'Failed to load users'))
      .finally(() => setLoading(false));
  }, [isOpen]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!userId) {
      setError('Pick a user.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await attachSEToTeam(team.id, { userId });
      const picked = users.find((u) => u.id === userId);
      const name = picked
        ? `${picked.firstName ?? ''} ${picked.lastName ?? ''}`.trim() || picked.email
        : 'Sales Engineer';
      toast.success(`${name} attached to ${team?.name ?? 'team'}.`);
      onAttached();
      onClose();
    } catch (err) {
      const msg = err.message || 'Failed to attach SE.';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      titleId="attach-se-title"
      title={`Attach SE to ${team?.name ?? ''}`}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={submitting} className="btn-ghost">
            Cancel
          </button>
          <button
            type="submit"
            form="attach-se-form"
            disabled={submitting || users.length === 0}
            className="btn-primary"
          >
            {submitting ? 'Attaching…' : 'Attach'}
          </button>
        </>
      }
    >
      <form id="attach-se-form" onSubmit={handleSubmit} className="admin-form">
        {loading && <p>Loading available SEs…</p>}
        {!loading && users.length === 0 && (
          <p className="admin-form-hint">
            No SE-role users without a team. Create one in the Users tab first.
          </p>
        )}
        {!loading && users.length > 0 && (
          <label className="admin-form-field">
            <span>Sales Engineer</span>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} autoFocus>
              <option value="">— pick one —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName} ({u.email})
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="admin-form-error">{error}</p>}
      </form>
    </Modal>
  );
}

function AEModal({ isOpen, onClose, team, ae, allTeams, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(ae);
  const [name, setName] = useState('');
  const [salesforceId, setSalesforceId] = useState('');
  const [salesforceEmail, setSalesforceEmail] = useState('');
  const [destinationTeamId, setDestinationTeamId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(ae?.name ?? '');
    setSalesforceId(ae?.salesforceId ?? '');
    setSalesforceEmail(ae?.salesforceEmail ?? '');
    setDestinationTeamId(team?.id ?? '');
    setError(null);
  }, [isOpen, ae, team]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!salesforceId.trim()) {
      setError('Salesforce ID is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const trimmedName = name.trim();
      const trimmedSfId = salesforceId.trim();
      if (isEdit) {
        const patch = {
          name: trimmedName,
          salesforceEmail: salesforceEmail.trim() || null,
        };
        // Only include salesforceId when it actually changed so we
        // don't trip the backend's uniqueness check on a no-op edit.
        if (trimmedSfId !== (ae?.salesforceId ?? '')) {
          patch.salesforceId = trimmedSfId;
        }
        let movedToTeamName = null;
        if (destinationTeamId && destinationTeamId !== team.id) {
          patch.teamId = destinationTeamId;
          movedToTeamName =
            allTeams.find((t) => t.id === destinationTeamId)?.name ?? null;
        }
        await updateAE(team.id, ae.id, patch);
        toast.success(
          movedToTeamName
            ? `${trimmedName} updated and moved to ${movedToTeamName}.`
            : `${trimmedName} updated.`,
        );
      } else {
        await createAE(team.id, {
          name: trimmedName,
          salesforceId: trimmedSfId,
          salesforceEmail: salesforceEmail.trim() || null,
        });
        toast.success(`${trimmedName} added to ${team?.name ?? 'team'}.`);
      }
      onSaved();
      onClose();
    } catch (err) {
      const msg = err.message || 'Save failed.';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      titleId="ae-modal-title"
      title={isEdit ? `Edit ${ae?.name}` : `Add AE to ${team?.name ?? ''}`}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={submitting} className="btn-ghost">
            Cancel
          </button>
          <button
            type="submit"
            form="ae-modal-form"
            disabled={submitting}
            className="btn-primary"
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create AE'}
          </button>
        </>
      }
    >
      <form id="ae-modal-form" onSubmit={handleSubmit} className="admin-form">
        <label className="admin-form-field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Smith"
            autoFocus
          />
        </label>
        <label className="admin-form-field">
          <span>Salesforce ID</span>
          <input
            type="text"
            value={salesforceId}
            onChange={(e) => setSalesforceId(e.target.value)}
            placeholder="0055f00000…"
          />
          {isEdit && (
            <small className="admin-form-hint">
              Updating this re-keys the AE in Salesforce-derived metrics. Make sure the new ID
              actually points at the same person.
            </small>
          )}
        </label>

        <label className="admin-form-field">
          <span>Salesforce email (optional)</span>
          <input
            type="email"
            value={salesforceEmail}
            onChange={(e) => setSalesforceEmail(e.target.value)}
            placeholder="jane@qawolf.com"
          />
        </label>
        {isEdit && allTeams.length > 0 && (
          <label className="admin-form-field">
            <span>Team</span>
            <select
              value={destinationTeamId}
              onChange={(e) => setDestinationTeamId(e.target.value)}
            >
              {allTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.id === team.id ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="admin-form-error">{error}</p>}
      </form>
    </Modal>
  );
}

function EditTeamModal({ isOpen, onClose, team, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(team?.name ?? '');
    setDescription(team?.description ?? '');
    setError(null);
  }, [isOpen, team]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Team name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const trimmedName = name.trim();
      await updateTeam(team.id, {
        name: trimmedName,
        description: description.trim() || null,
      });
      toast.success(`Team "${trimmedName}" updated.`);
      onSaved();
      onClose();
    } catch (err) {
      const msg = err.message || 'Save failed.';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      titleId="edit-team-title"
      title={`Edit ${team?.name ?? ''}`}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={submitting} className="btn-ghost">
            Cancel
          </button>
          <button
            type="submit"
            form="edit-team-form"
            disabled={submitting}
            className="btn-primary"
          >
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="edit-team-form" onSubmit={handleSubmit} className="admin-form">
        <label className="admin-form-field">
          <span>Team name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <label className="admin-form-field">
          <span>Description (optional)</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {error && <p className="admin-form-error">{error}</p>}
      </form>
    </Modal>
  );
}

function TeamRow({ team, allTeams, onChanged }) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [editingTeam, setEditingTeam] = useState(false);
  const [attachingSE, setAttachingSE] = useState(false);
  const [aeModalOpen, setAEModalOpen] = useState(false);
  const [editingAE, setEditingAE] = useState(null);

  const seLabel = teamLabel(team);
  const aeCount = team.accountExecutives?.length ?? 0;

  async function handleDeleteAE(ae) {
    if (
      !window.confirm(
        `Deactivate ${ae.name}? They will be hidden from this team and any quarterly metrics.`,
      )
    ) {
      return;
    }
    try {
      await deleteAE(team.id, ae.id);
      toast.success(`${ae.name} removed from ${team.name}.`);
      onChanged();
    } catch (err) {
      toast.error(err.message || 'Failed to deactivate AE.');
    }
  }

  return (
    <>
      <tr className="admin-team-row">
        <td>
          <button
            type="button"
            className="admin-row-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${team.name}` : `Expand ${team.name}`}
          >
            {expanded ? '▼' : '▶'}
          </button>
          <strong>{team.name}</strong>
        </td>
        <td>{seLabel}</td>
        <td>{aeCount}</td>
        <td>
          <div className="admin-row-actions">
            <button type="button" className="btn-ghost" onClick={() => setEditingTeam(true)}>
              Edit
            </button>
            {!team.salesEngineer && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setAttachingSE(true)}
              >
                Attach SE
              </button>
            )}
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setEditingAE(null);
                setAEModalOpen(true);
              }}
            >
              + Add AE
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="admin-team-detail-row">
          <td colSpan={4}>
            {aeCount === 0 ? (
              <p className="admin-form-hint">No active AEs on this team.</p>
            ) : (
              <table className="admin-ae-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Salesforce ID</th>
                    <th>Salesforce email</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {team.accountExecutives.map((ae) => (
                    <tr key={ae.id}>
                      <td>{ae.name}</td>
                      <td>
                        <code>{ae.salesforceId}</code>
                      </td>
                      <td>{ae.salesforceEmail || '—'}</td>
                      <td>
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => {
                              setEditingAE(ae);
                              setAEModalOpen(true);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-ghost btn-danger"
                            onClick={() => handleDeleteAE(ae)}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}

      <EditTeamModal
        isOpen={editingTeam}
        onClose={() => setEditingTeam(false)}
        team={team}
        onSaved={onChanged}
      />
      <AttachSEModal
        isOpen={attachingSE}
        onClose={() => setAttachingSE(false)}
        team={team}
        onAttached={onChanged}
      />
      <AEModal
        isOpen={aeModalOpen}
        onClose={() => setAEModalOpen(false)}
        team={team}
        ae={editingAE}
        allTeams={allTeams}
        onSaved={onChanged}
      />
    </>
  );
}

const TeamsPage = () => {
  const toast = useToast();
  const [teams, setTeams] = useState([]);
  // `initialLoading` only fires on the very first fetch so the table can
  // render a placeholder before we have any data. Subsequent refreshes
  // (after a CRUD action) flip `refreshing` instead, which leaves the
  // table mounted — that's what preserves each TeamRow's local
  // `expanded` state across edits/adds/removes.
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  const loadTeams = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetchTeams();
      setTeams(res.teams || []);
    } catch (err) {
      const msg = err.message || 'Failed to load teams.';
      setError(msg);
      toast.error(msg);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name)),
    [teams],
  );

  return (
    <div>
      <div className="users-header">
        <h2 className="section-title">Teams</h2>
        <button className="btn-metric btn-primary" onClick={() => setCreateOpen(true)}>
          Create Team
        </button>
      </div>

      {initialLoading && <p>Loading teams…</p>}
      {error && <p className="admin-form-error">{error}</p>}

      {!initialLoading && !error && (
        <table
          aria-busy={refreshing || undefined}
          style={refreshing ? { opacity: 0.7, transition: 'opacity 120ms ease' } : undefined}
        >
          <thead>
            <tr>
              <th>Team</th>
              <th>Sales Engineer</th>
              <th>Active AEs</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedTeams.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty-state">
                  No teams yet. Create one to get started.
                </td>
              </tr>
            ) : (
              sortedTeams.map((team) => (
                <TeamRow
                  key={team.id}
                  team={team}
                  allTeams={sortedTeams}
                  onChanged={loadTeams}
                />
              ))
            )}
          </tbody>
        </table>
      )}

      <CreateTeamModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={loadTeams}
      />
    </div>
  );
};

export default TeamsPage;
