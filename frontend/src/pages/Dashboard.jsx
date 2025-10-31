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
      <div className="dashboard-footer">
        <p>Need help? Check out our documentation or contact support.</p>
      </div>
    </div>
  );
}

export default Dashboard;
