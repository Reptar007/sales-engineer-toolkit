import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { getAllProjects } from '../../projects';

/**
 * Sidebar Navigation Component
 */
function Sidebar() {
  const location = useLocation();
  const projects = getAllProjects();

  const navItems = [
    { path: '/', label: 'Home', icon: '🏠' },
    ...projects.map(project => ({
      path: `/projects/${project.id}`,
      label: project.name,
      icon: project.icon,
    })),
  ];

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        <ul className="nav-list">
          {navItems.map((item) => (
            <li key={item.path} className="nav-item">
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `nav-link ${isActive ? 'active' : ''}`
                }
                end={item.path === '/'}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

export default Sidebar;

