import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import UsersPage from '../../pages/UsersPage';
import './Admin.css';

const Admin = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('user');

  if (!user?.roles?.includes('admin')) {
    return <Navigate to="/" replace />;
  }

  const tabs = [
    { id: 'user', label: 'Users', icon: '👤' },
    { id: 'team', label: 'Create Team', icon: '👥' },
    { id: 'ae', label: 'Create Account Executive', icon: '💼' },
  ];

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div className="admin-header-text">
          <h1>Admin Panel</h1>
          <p>Manage users, teams, and system settings</p>
        </div>
      </div>

      <nav className="admin-tabs">
        <ul className="admin-tabs-list">
          {tabs.map((tab) => (
            <li key={tab.id} className="admin-tab-item">
              <button
                className={`admin-tab-button ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <span className="admin-tab-icon">{tab.icon}</span>
                <span className="admin-tab-label">{tab.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="admin-content">
        {activeTab === 'user' && (
          <section className="section">
            <UsersPage />
          </section>
        )}

        {activeTab === 'team' && (
          <section className="section">
            <h2 className="section-title">Create Team</h2>
            <p>Team creation form will go here</p>
          </section>
        )}

        {activeTab === 'ae' && (
          <section className="section">
            <h2 className="section-title">Create Account Executive</h2>
            <p>Account Executive creation form will go here</p>
          </section>
        )}
      </div>
    </div>
  );
};

export default Admin;