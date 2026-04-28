import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import UsersPage from '../../pages/UsersPage';
import CreateSnapshotPage from '../../pages/CreateSnapshotPage';
import QuarterlyGoalsPage from '../../pages/QuarterlyGoalsPage';
import TeamsPage from './TeamsPage';
import './Admin.css';

const Admin = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('user');

  if (!user?.roles?.includes('admin')) {
    return <Navigate to="/" replace />;
  }

  // The standalone "Create Account Executive" tab is intentionally gone:
  // AE create / edit / move / remove all live inside the Teams tab now,
  // grouped under the team they belong to (matches the data model and the
  // way admins actually think about roster changes).
  const tabs = [
    { id: 'user', label: 'Users', icon: '👤' },
    { id: 'team', label: 'Teams', icon: '👥' },
    { id: 'snapshot_years', label: 'Snapshot Years', icon: '📦' },
    { id: 'quarterly_goals', label: 'Quarterly Goals', icon: '🎯' },
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
            <TeamsPage />
          </section>
        )}

        {activeTab === 'snapshot_years' && (
          <section className="section">
            <CreateSnapshotPage />
          </section>
        )}

        {activeTab === 'quarterly_goals' && (
          <section className="section">
            <QuarterlyGoalsPage />
          </section>
        )}
      </div>
    </div>
  );
};

export default Admin;