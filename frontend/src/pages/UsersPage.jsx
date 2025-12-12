import React from 'react';
import { useEffect, useState } from 'react';
import { fetchUsers } from '../services/api';
import UserModal from './UserModal';

const UsersPage = () => {
  const [users, setUsers] = useState([]);
  const [openCreateUserModal, setOpenCreateUserModal] = useState(false);

  const loadUsers = async () => {
    try {
      const response = await fetchUsers();
      setUsers(response.users);
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleUserCreated = () => {
    loadUsers(); // Refresh the list after user creation
  };

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

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Roles</th>
            <th>Team</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan="5" className="empty-state">
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
                  {user.userRoles.map((role) => role.role.split('_').join(' ').toUpperCase()).join(', ')}
                </td>
                <td>{user.salesEngineer?.team?.name || 'No team'}</td>
                <td>{user.isActive ? 'Active' : 'Inactive'}</td>
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
    </div>
  );
};

export default UsersPage;
