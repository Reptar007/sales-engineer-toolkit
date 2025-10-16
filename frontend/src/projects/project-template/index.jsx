import React from 'react';

/**
 * Project Template - Template for creating new projects
 * Copy this file and modify it for your new project
 */
function ProjectTemplate() {
  return (
    <div className="project-template">
      <div className="project-header">
        <h1>Project Template</h1>
        <p>This is a template for creating new projects</p>
      </div>
      
      <div className="project-content">
        <div className="feature-section">
          <h2>Getting Started</h2>
          <p>To create a new project:</p>
          <ol>
            <li>Copy this template directory</li>
            <li>Rename it to your project name</li>
            <li>Update the component name and functionality</li>
            <li>Add it to the projects registry</li>
            <li>Create any project-specific components, hooks, or services</li>
          </ol>
        </div>
        
        <div className="feature-section">
          <h2>Project Structure</h2>
          <pre>
{`project-name/
├── index.jsx          # Main project component
├── components/        # Project-specific components
├── hooks/            # Project-specific hooks
├── services/         # Project-specific API calls
└── styles/           # Project-specific styles (optional)`}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default ProjectTemplate;
