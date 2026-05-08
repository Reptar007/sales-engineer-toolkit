import React, { useEffect, useState } from 'react';
import { fetchUsers, resetUserPassword } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import UserModal from './UserModal';
import EditUserModal from './EditUserModal';

const UsersPage = () => {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [openCreateUserModal, setOpenCreateUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  // Banner shown after a successful password reset so the admin can copy
  // the temporary password to send out-of-band. Stays visible until the
  // admin dismisses it (or another reset overwrites it) so they don't
  // miss the value if they look away mid-flow.
  const [resetBanner, setResetBanner] = useState(null);
  const [resettingUserId, setResettingUserId] = useState(null);
  // Briefly flips to true after a successful copy so the button can flash a
  // "Copied" affordance — auto-clears after a short timeout so the admin can
  // copy the value again without dismissing the banner.
  const [copied, setCopied] = useState(false);

  const loadUsers = async () => {
    try {
      const response = await fetchUsers();
      setUsers(response.users);
    } catch (error) {
      console.error('Failed to load users:', error);
      toast.error(error.message || 'Failed to load users.');
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleUserCreated = (result) => {
    loadUsers();
    const created = result?.user;
    const fullName = created
      ? `${created.firstName ?? ''} ${created.lastName ?? ''}`.trim() || created.email
      : 'User';
    toast.success(`${fullName} created.`);
    // When the backend auto-generated a temp password, surface it in the
    // same banner the reset-password flow uses so the admin can copy it
    // and pass it to the new user out-of-band.
    if (result?.temporaryPassword && created) {
      setCopied(false);
      setResetBanner({
        userId: created.id,
        name: fullName,
        email: created.email,
        temporaryPassword: result.temporaryPassword,
        // Tagging the source so the banner can speak the right verb without
        // us having to spin up a second nearly-identical component.
        kind: 'create',
      });
    }
  };

  const handleUserUpdated = () => {
    loadUsers();
    toast.success('User updated.');
  };

  async function handleCopyTempPassword() {
    if (!resetBanner?.temporaryPassword) return;
    try {
      // Prefer the async Clipboard API; fall back to the legacy execCommand
      // path so this still works in older browsers / non-secure contexts
      // (e.g. a stray http:// preview URL) where navigator.clipboard is not
      // available.
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(resetBanner.temporaryPassword);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = resetBanner.temporaryPassword;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success('Temporary password copied to clipboard.');
    } catch (err) {
      console.error('Failed to copy temporary password:', err);
      toast.error('Could not copy to clipboard. Select the password manually instead.');
    }
  }

  async function handleResetPassword(user) {
    const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email;
    const ok = window.confirm(
      `Reset password for ${fullName}?\n\nThey will be required to change it on their next login.`,
    );
    if (!ok) return;

    setResettingUserId(user.id);
    try {
      const result = await resetUserPassword(user.id);
      setCopied(false);
      setResetBanner({
        userId: user.id,
        name: fullName,
        email: user.email,
        temporaryPassword: result.temporaryPassword,
      });
      toast.success(`Password reset for ${fullName}.`);
    } catch (error) {
      toast.error(error.message || 'Failed to reset password.');
    } finally {
      setResettingUserId(null);
    }
  }

  return (
    <div>
      <div className="users-header">
        <h2 className="section-title">Users</h2>
        <button
          onClick={() => setOpenCreateUserModal(true)}
          className="btn-metric btn-primary"
        >
          Create New User
        </button>
      </div>

      {resetBanner && (
        <div className="admin-reset-banner" role="status" aria-live="polite">
          <div className="admin-reset-banner__text">
            <strong>
              {resetBanner.kind === 'create'
                ? `${resetBanner.name} created.`
                : `Password reset for ${resetBanner.name}.`}
            </strong>
            <span className="admin-reset-banner__credential">
              Temporary password:{' '}
              <code className="admin-reset-banner__code">{resetBanner.temporaryPassword}</code>
              <button
                type="button"
                className="btn-ghost admin-reset-banner__copy"
                onClick={handleCopyTempPassword}
                aria-label="Copy temporary password"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </span>
            <small>
              Share this with {resetBanner.email} out-of-band. They&apos;ll be required to change
              it on their next login.
            </small>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setResetBanner(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Roles</th>
            <th>Team</th>
            <th>Status</th>
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan="6" className="empty-state">
                No users found
              </td>
            </tr>
          ) : (
            users.map((user) => (
              <tr key={user.id}>
                <td>
                  {user.firstName} {user.lastName}
                </td>
                <td>{user.email}</td>
                <td>
                  {user.userRoles
                    .map((role) => role.role.split('_').join(' ').toUpperCase())
                    .join(', ')}
                </td>
                <td>{user.salesEngineer?.team?.name || 'No team'}</td>
                <td>{user.isActive ? 'Active' : 'Inactive'}</td>
                <td>
                  <div className="admin-row-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setEditingUser(user)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => handleResetPassword(user)}
                      disabled={resettingUserId === user.id}
                    >
                      {resettingUserId === user.id ? 'Resetting…' : 'Reset password'}
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <UserModal
        isOpen={openCreateUserModal}
        onClose={() => setOpenCreateUserModal(false)}
        onSuccess={handleUserCreated}
      />

      <EditUserModal
        isOpen={Boolean(editingUser)}
        user={editingUser}
        onClose={() => setEditingUser(null)}
        onSaved={handleUserUpdated}
      />
    </div>
  );
};

export default UsersPage;
