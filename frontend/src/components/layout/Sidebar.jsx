import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { getAllProjects } from '../../projects';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
/**
 * Sidebar Navigation Component
 */
function Sidebar({ isSidebarOpen }) {
  const projects = getAllProjects();
  const navigate = useNavigate();
  const location = useLocation();
  const [openDropdown, setOpenDropdown] = useState(false);

  const toggleDropdown = () => {
    setOpenDropdown(!openDropdown);
  };

  // Separate Home from other nav items
  const homeItem = { path: '/', label: 'Home', icon: '🏠' };

  const navItems = [
    ...projects
      .filter((project) => project.id !== 'salesforce-metrics')
      .map((project) => ({
      path: `/projects/${project.id}`,
      label: project.name,
      icon: project.icon,
    })),
  ];

  const salesforceSubItems = [
    { 
      path: '/projects/salesforce-metrics', 
      label: 'Metrics', 
      icon: '📈' // from registry
    },
    { 
      path: '/projects/salesforce/calculator', 
      label: 'Calculator', 
      icon: '🧮' // hardcoded for now
    },
    { 
      path: '/projects/salesforce/lookup', 
      label: 'Lookup', 
      icon: '🔍' // hardcoded for now
    }
  ];

  // Get Salesforce project from registry for icon/name
  const salesforceProject = projects.find(project => project.id === 'salesforce-metrics');

  // Auto-expand dropdown when on Salesforce routes
  useEffect(() => {
    if (location.pathname.startsWith('/projects/salesforce') || location.pathname === '/projects/salesforce-metrics') {
      setOpenDropdown(true);
    }
  }, [location.pathname]);

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
          {/* Home - Always at the top */}
          <li className="nav-item">
            <NavLink
              to={homeItem.path}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              end={homeItem.path === '/'}
            >
              <span className="nav-icon">{homeItem.icon}</span>
              <span className="nav-label">{homeItem.label}</span>
            </NavLink>
          </li>
          {isAdmin && (
            <li className="nav-item">
              <NavLink to="/admin" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">👑</span>
                <span className="nav-label">Admin</span>
              </NavLink>
            </li>
          )}
          {/* Salesforce Dropdown */}
          <li className="nav-item">
            <button
              type="button"
              className={`nav-link nav-link-dropdown ${location.pathname.startsWith('/projects/salesforce') || location.pathname === '/projects/salesforce-metrics' ? 'active' : ''}`}
              onClick={toggleDropdown}
            >
              <span className="nav-icon">{salesforceProject?.icon || '📊'}</span>
              <span className="nav-label">Salesforce</span>
              <span className="nav-chevron">{openDropdown ? '▼' : '▶'}</span>
            </button>
            {openDropdown && (
              <ul className="nav-submenu">
                {salesforceSubItems.map((item) => (
                  <li key={item.path} className="nav-subitem">
                    <NavLink
                      to={item.path}
                      className={({ isActive }) => {
                        // Special check for Metrics - also active on salesforce-metrics route
                        const isMetricsActive = item.path === '/projects/salesforce-metrics' && location.pathname === '/projects/salesforce-metrics';
                        return `nav-link nav-sublink ${isActive || isMetricsActive ? 'active' : ''}`;
                      }}
                    >
                      <span className="nav-icon">{item.icon}</span>
                      <span className="nav-label">{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </li>
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
