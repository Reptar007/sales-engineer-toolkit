import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Project Card Component - Displays project information and navigation
 */
function ProjectCard({ project }) {
  const navigate = useNavigate();

  const handleProjectClick = () => {
    navigate(`/projects/${project.id}`);
  };

  return (
    <div className="project-card" onClick={handleProjectClick}>
      <div className="project-card-header">
        <div className="project-icon">{project.icon}</div>
        <h3 className="project-name">{project.name}</h3>
      </div>
      
      <div className="project-card-body">
        <p className="project-description">{project.description}</p>
        
        <div className="project-features">
          {project.features?.map((feature, index) => (
            <span key={index} className="feature-tag">
              {feature}
            </span>
          ))}
        </div>
      </div>
      
      <div className="project-card-footer">
        <span className="project-version">v{project.version}</span>
        <span className="project-category">{project.category}</span>
      </div>
    </div>
  );
}

export default ProjectCard;
