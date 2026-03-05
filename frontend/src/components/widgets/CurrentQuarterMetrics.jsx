import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchSalesforceReport,
  getSalesforceConfig,
  fetchSalesforceSnapshotMetrics,
} from '../../services/api';
import '../../styles/CurrentQuarterMetrics.less';

/**
 * Get current quarter based on actual date
 * Format: Q1 CY2025, Q2 CY2025, etc.
 */
function getCurrentQuarter() {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();

  let quarter;
  if (month >= 1 && month <= 3) {
    quarter = 1;
  } else if (month >= 4 && month <= 6) {
    quarter = 2;
  } else if (month >= 7 && month <= 9) {
    quarter = 3;
  } else {
    quarter = 4;
  }

  return `Q${quarter} CY${year}`;
}

/**
 * Current Quarter Metrics Widget - Summary version for home page
 */
function CurrentQuarterMetrics() {
  const navigate = useNavigate();
  const [config, setConfig] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const actualCurrentQuarter = getCurrentQuarter();
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    let cancelled = false;
    getSalesforceConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load config');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!config) return;
    const isSnapshotYear = (config.snapshotYears || []).includes(currentYear);
    const reportId = config.reportIdsByYear?.[currentYear]?.metrics;
    if (!isSnapshotYear && !reportId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const fetchMetrics = () => {
      if (isSnapshotYear) {
        return fetchSalesforceSnapshotMetrics(currentYear).catch(() => {
          if (reportId) return fetchSalesforceReport(reportId);
          throw new Error('Snapshot unavailable and no report ID for this year');
        });
      }
      return fetchSalesforceReport(reportId);
    };
    fetchMetrics()
      .then((response) => {
        if (!cancelled) {
          setData(response);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [config, currentYear]);

  const quarterlyData = data?.quarterlyData || {};
  const currentQuarterKey = quarterlyData[actualCurrentQuarter]
    ? actualCurrentQuarter
    : Object.keys(quarterlyData).find(
          (key) => key !== 'Total' && quarterlyData[key]?.opportunities?.length > 0
        ) ||
      Object.keys(quarterlyData).find((key) => key !== 'Total') ||
      actualCurrentQuarter;
  const currentQuarterData = quarterlyData[currentQuarterKey] || {};
  const currentAAR = currentQuarterData?.totalARR || 0;
  const currentYearAAR = quarterlyData?.Total?.totalARR || 0;

  const quarterlyGoals = config?.goalsByYear?.[currentYear] || [];
  const currentQuarterGoal = quarterlyGoals.find((q) => q.label === currentQuarterKey)?.goal || 0;
  const yearlyGoal = quarterlyGoals.reduce((acc, q) => acc + q.goal, 0);

  const calculateGoalProgress = (current, goal) => {
    if (!current || !goal) return 0;
    return (current / goal) * 100;
  };

  const formatNumber = (num) => {
    if (!num) return '0';
    if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(0) + 'K';
    }
    return num.toString();
  };

  const quarterlyProgress = calculateGoalProgress(currentAAR, currentQuarterGoal);
  const yearlyProgress = calculateGoalProgress(currentYearAAR, yearlyGoal);

  const handleViewFull = () => {
    navigate('/projects/salesforce-metrics');
  };

  if (loading) {
    return (
      <div className="current-quarter-metrics widget">
        <div className="widget-header">
          <h2>Current Quarter Metrics</h2>
          <button className="widget-link" onClick={handleViewFull}>
            View Full Dashboard →
          </button>
        </div>
        <div className="widget-content">
          <p>Loading metrics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    if (error.includes('credentials not configured') || error.includes('no username password')) {
      return null;
    }
    return (
      <div className="current-quarter-metrics widget">
        <div className="widget-header">
          <h2>Current Quarter Metrics</h2>
        </div>
        <div className="widget-content">
          <p className="error">Unable to load metrics. Please check your Salesforce configuration.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="current-quarter-metrics widget">
      <div className="widget-header">
        <h2>Current Quarter Metrics</h2>
        <button className="widget-link" onClick={handleViewFull}>
          View Full Dashboard →
        </button>
      </div>

      <div className="widget-content">
        <div className="metrics-grid">
          <div className="metric-summary">
            <div className="metric-label">Quarter Goal</div>
            <div className="metric-value">${formatNumber(currentQuarterGoal)}</div>
            <div className="metric-quarter">{currentQuarterKey}</div>
          </div>

          <div className="metric-summary">
            <div className="metric-label">Quarter AAR</div>
            <div className="metric-value">${formatNumber(currentAAR)}</div>
            <div className="metric-progress">
              {quarterlyProgress.toFixed(1)}% of goal
            </div>
          </div>

          <div className="metric-summary">
            <div className="metric-label">Yearly Goal</div>
            <div className="metric-value">${formatNumber(yearlyGoal)}</div>
            <div className="metric-opportunities">
              {data?.totalOpportunities || 0} opportunities
            </div>
          </div>

          <div className="metric-summary">
            <div className="metric-label">Yearly AAR</div>
            <div className="metric-value">${formatNumber(currentYearAAR)}</div>
            <div className="metric-progress">
              {yearlyProgress.toFixed(1)}% of goal
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CurrentQuarterMetrics;
