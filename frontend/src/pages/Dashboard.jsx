import React from 'react';
import CurrentQuarterMetrics from '../components/widgets/CurrentQuarterMetrics';
import DashboardWidgets from '../components/dashboard/DashboardWidgets';
import PageHeader from '../components/layout/PageHeader';
import useDashboardSummary from '../hooks/useDashboardSummary';
import { useAuth } from '../contexts/AuthContext';

function getCurrentQuarterLabel() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const quarter = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  return `Q${quarter} • ${year}`;
}


/**
 * Main Dashboard - Home page with metrics widget and project overview
 */
function Dashboard() {
  const { user } = useAuth();
  const firstName = user?.firstName?.trim();
  const teamName = user?.team?.name;
  const summary = useDashboardSummary();

  return (
    <div className="dashboard">
      <PageHeader
        name={firstName}
        summary={summary}
        team={teamName ? { name: teamName, quarter: getCurrentQuarterLabel() } : undefined}
      />

      <CurrentQuarterMetrics />

      <DashboardWidgets />

      <div className="dashboard-footer">
        <p>Need help? Check out our documentation or contact support.</p>
      </div>
    </div>
  );
}

export default Dashboard;
