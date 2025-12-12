import React from 'react';
import { NavLink } from 'react-router-dom';
import { getAllProjects } from '../../projects';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
/**
 * Sidebar Navigation Component
 */
function Sidebar({ isSidebarOpen }) {
  const projects = getAllProjects();
  const navigate = useNavigate();

  const navItems = [
    { path: '/', label: 'Home', icon: '🏠' },
    ...projects.map((project) => ({
      path: `/projects/${project.id}`,
      label: project.name,
      icon: project.icon,
    })),
  ];

  const { user,logout } = useAuth();
  const handleLogout = () => {
    logout();
    navigate('/login');
  };
  const isAdmin = user?.roles?.includes('admin');

  return (
    <aside className={`sidebar ${!isSidebarOpen ? 'sidebar-closed' : ''}`}>
      <nav className="sidebar-nav">
        <ul className="nav-list">
          {isAdmin && (
            <li className="nav-item">
              <NavLink to="/admin" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">👑</span>
                <span className="nav-label">Admin</span>
              </NavLink>
            </li>
          )}
          {navItems.map((item) => (
            <li key={item.path} className="nav-item">
              <NavLink
                to={item.path}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                end={item.path === '/'}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        {/* Bottom section */}
        <div className="sidebar-footer">
          <div className="sidebar-divider"></div>
          <button className="nav-link" type="button">
            <span className="nav-icon">⚙️</span>
            <span className="nav-label">Settings</span>
          </button>
          <button className="nav-link" type="button" onClick={handleLogout}>
            <span className="nav-icon">🚪</span>
            <span className="nav-label">Log out</span>
          </button>
        </div>
      </nav>
    </aside>
  );
}

export default Sidebar;
