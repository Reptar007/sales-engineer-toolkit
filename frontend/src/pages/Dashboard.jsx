import React from 'react';
import { getAllProjects } from '../projects';
import ProjectCard from '../components/common/ProjectCard';
import CurrentQuarterMetrics from '../components/widgets/CurrentQuarterMetrics';

/**
 * Main Dashboard - Home page with metrics widget and project overview
 */
function Dashboard() {
  const projects = getAllProjects();

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Welcome to SalesWolf!</h1>
        <p>Your sales engineering toolkit dashboard</p>
      </div>

      <CurrentQuarterMetrics />

      <div className="dashboard-projects">
        <h2 className="section-title">Available Projects</h2>
        <div className="projects-grid">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      </div>

      <div className="dashboard-footer">
        <p>Need help? Check out our documentation or contact support.</p>
      </div>
    </div>
  );
}

export default Dashboard;
