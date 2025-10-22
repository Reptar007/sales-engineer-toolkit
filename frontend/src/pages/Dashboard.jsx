import React from 'react';
import SalesforceMetrics from '../projects/salesforce-metrics';

/**
 * Main Dashboard - Project selection and overview
 */
function Dashboard() {
  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Welcome to SalesWolf!</h1>
        <p>Select a project to get started</p>
      </div>
      <SalesforceMetrics />
      <div className="projects-grid">
        <div className="project-card">
          <div className="project-card-header">
            <div className="project-icon">📊</div>
            <h3 className="project-name">Ratio Estimator</h3>
          </div>
          <div className="project-card-body">
            <p className="project-description">AI-powered test ratio estimation tool</p>
            <div className="project-features">
              <span className="feature-tag">CSV Upload</span>
              <span className="feature-tag">AI Processing</span>
              <span className="feature-tag">Review & Approval</span>
            </div>
          </div>
          <div className="project-card-footer">
            <span className="project-version">v1.0.0</span>
            <span className="project-category">Analysis Tools</span>
          </div>
        </div>
        
        <div className="project-card">
          <div className="project-card-header">
            <div className="project-icon">📈</div>
            <h3 className="project-name">Salesforce Metrics</h3>
          </div>
          <div className="project-card-body">
            <p className="project-description">Salesforce performance metrics and analytics</p>
            <div className="project-features">
              <span className="feature-tag">Data Analysis</span>
              <span className="feature-tag">Reporting</span>
              <span className="feature-tag">Visualization</span>
            </div>
          </div>
          <div className="project-card-footer">
            <span className="project-version">v1.0.0</span>
            <span className="project-category">Analytics</span>
          </div>
        </div>
      </div>

      <div className="dashboard-footer">
        <p>Need help? Check out our documentation or contact support.</p>
      </div>
    </div>
  );
}

export default Dashboard;
