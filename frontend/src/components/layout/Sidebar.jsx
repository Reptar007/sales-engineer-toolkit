import React, { useState, useEffect } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { getAllProjects } from '../../projects';
import { useAuth } from '../../contexts/AuthContext';
import {
  GoHome,
  GoStar,
  GoGoal,
  GoTrophy,
  GoNumber,
  GoSearch,
  GoFile,
  GoPerson,
  GoSignOut,
  GoChevronLeft,
  GoChevronRight,
  GoChevronDown,
} from 'react-icons/go';

/**
 * Sidebar Navigation Component
 */
// Wolf-themed label + icon overrides keyed by project id, so we can rebrand the
// sidebar without touching the project registry (which other surfaces consume).
const PROJECT_LABEL_OVERRIDES = {
  'ratio-estimator': 'Howl Sheet',
};

const PROJECT_ICON_OVERRIDES = {
  'ratio-estimator': <GoFile />,
  'salesforce-metrics': <GoGoal />,
};

function Sidebar({ isSidebarOpen, toggleSidebar }) {
  const projects = getAllProjects();
  const navigate = useNavigate();
  const location = useLocation();
  const [openDropdown, setOpenDropdown] = useState(false);

  const toggleDropdown = () => {
    setOpenDropdown(!openDropdown);
  };

  // Separate Home from other nav items
  const homeItem = { path: '/', label: 'The Den', icon: <GoHome /> };

  const navItems = [
    ...projects
      .filter((project) => project.id !== 'salesforce-metrics')
      .map((project) => ({
      path: `/projects/${project.id}`,
      label: PROJECT_LABEL_OVERRIDES[project.id] || project.name,
      icon: PROJECT_ICON_OVERRIDES[project.id] || project.icon,
    })),
  ];

  const salesforceSubItems = [
    {
      path: '/projects/salesforce-metrics',
      label: 'Trophies',
      icon: <GoTrophy />,
    },
    {
      path: '/projects/salesforce/calculator',
      label: 'Bounty Calc',
      icon: <GoNumber />,
    },
    {
      path: '/projects/salesforce/lookup',
      label: 'Scent Tracker',
      icon: <GoSearch />,
    },
  ];

  // Auto-expand dropdown when on Salesforce routes
  useEffect(() => {
    if (location.pathname.startsWith('/projects/salesforce') || location.pathname === '/projects/salesforce-metrics') {
      setOpenDropdown(true);
    }
  }, [location.pathname]);

  // Force the dropdown closed when the rail collapses to icon-only.
  useEffect(() => {
    if (!isSidebarOpen) {
      setOpenDropdown(false);
    }
  }, [isSidebarOpen]);

  const { user,logout } = useAuth();
  const handleLogout = () => {
    logout();
    navigate('/login');
  };
  const isAdmin = user?.roles?.includes('admin');

  return (
    <aside className={`sidebar ${!isSidebarOpen ? 'sidebar-closed' : ''}`}>
      <div className="top-header">
        <Link to="/" className="header-logo">
          <img src="/saleswolf-icon.png" alt="SalesWolf" className="header-logo-icon" />
          <div className="header-text">
            <h1>
              Sales<span className="header-wolf">Wolf</span>
            </h1>
            <p>HUNT • CLOSE • DOMINATE</p>
          </div>
        </Link>
      </div>
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
                <span className="nav-icon"><GoStar /></span>
                <span className="nav-label">Alpha Pack</span>
              </NavLink>
            </li>
          )}
          {/* Salesforce Dropdown — wolf-rebranded as "Hunt Pipeline" */}
          <li className="nav-item">
            <button
              type="button"
              className={`nav-link nav-link-dropdown ${location.pathname.startsWith('/projects/salesforce') || location.pathname === '/projects/salesforce-metrics' ? 'active' : ''}`}
              onClick={toggleDropdown}
            >
              <span className="nav-icon"><GoGoal /></span>
              <span className="nav-label">Hunt Pipeline</span>
              <span className="nav-chevron">
                {openDropdown ? <GoChevronDown /> : <GoChevronRight />}
              </span>
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
          <NavLink
            to="/profile"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon"><GoPerson /></span>
            <span className="nav-label">My Wolf</span>
          </NavLink>
          <button className="nav-link" type="button" onClick={handleLogout}>
            <span className="nav-icon"><GoSignOut /></span>
            <span className="nav-label">Leave the Pack</span>
          </button>

          {toggleSidebar && (
            <button
              type="button"
              className="sidebar-collapse"
              onClick={toggleSidebar}
              aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <span className="sidebar-collapse__icon" aria-hidden>
                {isSidebarOpen ? <GoChevronLeft /> : <GoChevronRight />}
              </span>
              <span className="sidebar-collapse__label">Collapse</span>
            </button>
          )}
        </div>
      </nav>
    </aside>
  );
}

export default Sidebar;
