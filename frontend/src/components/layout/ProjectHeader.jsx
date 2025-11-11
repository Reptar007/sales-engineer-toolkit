import React from 'react';

/**
 * Project Header - Navigation and project info for individual projects
 */
function ProjectHeader({ project }) {
  return (
    <div className="project-header">
      <div className="project-header-left">
        <div className="project-info">
          <span className="project-icon">{project.icon}</span>
          <div>
            <h1 className="project-title">{project.name}</h1>
            <p className="project-subtitle">{project.description}</p>
          </div>
        </div>
      </div>
      
      <div className="project-header-right">
        <span className="project-version">v{project.version}</span>
      </div>
    </div>
  );
}

export default ProjectHeader;
