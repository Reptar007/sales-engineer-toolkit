import React from 'react';
import CurrentQuarterMetrics from '../components/widgets/CurrentQuarterMetrics';
import DashboardWidgets from '../components/dashboard/DashboardWidgets';
import HuntClock from '../components/dashboard/HuntClock';
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
 *
 * The post-login data-warmup splash is owned by <BootstrapGate /> at
 * the app shell, not by this page. That way it plays once per session
 * (after login or fresh page load) instead of on every dashboard mount,
 * and it shows even when the post-login redirect lands on a non-
 * dashboard route.
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

      <HuntClock />

      <CurrentQuarterMetrics />

      <DashboardWidgets />

    </div>
  );
}

export default Dashboard;
