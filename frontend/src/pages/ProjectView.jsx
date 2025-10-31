import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getProject } from '../projects';
import ErrorBoundary from '../components/ErrorBoundary';
import ProjectHeader from '../components/layout/ProjectHeader';

/**
 * Project View - Wrapper for individual project components
 */
function ProjectView() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const project = getProject(projectId);
  console.log('ProjectView - projectId:', projectId);
  console.log('ProjectView - project:', project);

  if (!project) {
    return (
      <div className="project-not-found">
        <h2>Project Not Found</h2>
        <p>The project "{projectId}" could not be found.</p>
        <button onClick={() => navigate('/')} className="btn-primary">
          Back to Dashboard
        </button>
      </div>
    );
  }

  const ProjectComponent = project.component;

  return (
    <ErrorBoundary>
      <div className="project-view">
        <ProjectHeader project={project} />
        <div className="project-content">
          <ProjectComponent />
        </div>
      </div>
    </ErrorBoundary>
  );
}

export default ProjectView;
