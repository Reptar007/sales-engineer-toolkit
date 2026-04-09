import React from 'react';
import CurrentQuarterMetrics from '../components/widgets/CurrentQuarterMetrics';
import DashboardWidgets from '../components/dashboard/DashboardWidgets';
import { useAuth } from '../contexts/AuthContext';

function getCurrentQuarterLabel() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const quarter = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  return `Q${quarter} CY${year}`;
}

/** Replace with team from API when available */
const PLACEHOLDER_TEAM_NAME = 'Team Kirby';

/**
 * Main Dashboard - Home page with metrics widget and project overview
 */
function Dashboard() {
  const { user } = useAuth();
  const firstName = user?.firstName?.trim();
  const greeting = firstName ? `Hello, ${firstName} 👋` : 'Welcome to SalesWolf!';
  const subline = `${PLACEHOLDER_TEAM_NAME} · ${getCurrentQuarterLabel()}`;

  return (
    <div className="dashboard">
      <header className="dashboard-page-head">
        <div className="dashboard-page-head__text">
          <h1 className="dashboard-page-head__title">{greeting}</h1>
          <p className="dashboard-page-head__sub">{subline}</p>
        </div>
        <button
          type="button"
          className="dashboard-page-head__menu"
          aria-label="More actions"
        >
          ⋯
        </button>
      </header>

      <CurrentQuarterMetrics />

      <DashboardWidgets />

      <div className="dashboard-footer">
        <p>Need help? Check out our documentation or contact support.</p>
      </div>
    </div>
  );
}

export default Dashboard;
