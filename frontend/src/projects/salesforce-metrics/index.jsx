import React, { useState, useEffect } from 'react';
import './SalesforceMetrics.css';
import {
  fetchSalesforceReport,
  getSalesforceConfig,
  fetchSalesforceSnapshotMetrics,
} from '../../services/api';

const SELECTED_YEAR_STORAGE_KEY = 'salesforceMetrics.selectedYear';
const SELECTED_QUARTER_STORAGE_KEY = 'salesforceMetrics.selectedQuarter';

function getAvailableYears(config) {
  if (!config) return [];
  const fromReports = Object.keys(config.reportIdsByYear || {}).map(Number);
  const fromSnapshots = config.snapshotYears || [];
  const combined = [...new Set([...fromReports, ...fromSnapshots])];
  return combined.sort((a, b) => b - a);
}

function getCurrentQuarterLabel(year = new Date().getFullYear()) {
  const month = new Date().getMonth() + 1;
  const quarter = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  return `Q${quarter} CY${year}`;
}

function getFallbackYears(currentYear) {
  return [currentYear + 1, currentYear, currentYear - 1];
}

const SalesforceMetrics = () => {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(null);
  const currentCalendarYear = new Date().getFullYear();
  const persistedYear = Number.parseInt(localStorage.getItem(SELECTED_YEAR_STORAGE_KEY) || '', 10);
  const initialYear = Number.isInteger(persistedYear) ? persistedYear : currentCalendarYear;
  const persistedQuarterLabel = localStorage.getItem(SELECTED_QUARTER_STORAGE_KEY);

  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [quarter, setQuarter] = useState({
    value: '1',
    label: persistedQuarterLabel || getCurrentQuarterLabel(initialYear),
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const availableYears = config ? getAvailableYears(config) : getFallbackYears(currentCalendarYear);

  // Fetch config on mount and set default year
  useEffect(() => {
    let cancelled = false;
    getSalesforceConfig()
      .then((c) => {
        if (!cancelled) {
          setConfig(c);
          setConfigError(null);
          const years = getAvailableYears(c);
          const defaultYear = years.length
            ? (years.includes(initialYear) ? initialYear : years.includes(currentCalendarYear) ? currentCalendarYear : years[0])
            : initialYear;
          setSelectedYear(defaultYear);
        }
      })
      .catch((err) => {
        if (!cancelled) setConfigError(err.message);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (Number.isInteger(selectedYear)) {
      localStorage.setItem(SELECTED_YEAR_STORAGE_KEY, String(selectedYear));
    }
  }, [selectedYear]);

  useEffect(() => {
    if (quarter?.label) {
      localStorage.setItem(SELECTED_QUARTER_STORAGE_KEY, quarter.label);
    }
  }, [quarter]);

  // Fetch metrics data when selectedYear or config changes
  useEffect(() => {
    if (!config || selectedYear == null) {
      setLoading(!!config);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const reportId = config.reportIdsByYear?.[selectedYear]?.metrics;
    const isSnapshotYear = (config.snapshotYears || []).includes(selectedYear);

    const trySnapshotThenReport = () => {
      if (isSnapshotYear) {
        return fetchSalesforceSnapshotMetrics(selectedYear).catch(() => {
          if (reportId) return fetchSalesforceReport(reportId);
          throw new Error('Snapshot unavailable and no report ID for this year');
        });
      }
      if (!reportId) return Promise.reject(new Error(`No metrics report ID for year ${selectedYear}`));
      return fetchSalesforceReport(reportId);
    };

    trySnapshotThenReport()
      .then((response) => {
        if (!cancelled) {
          setData(response);
          setError(null);
          const quarters = Object.keys(response?.quarterlyData || {}).filter((k) => k !== 'Total');
          const labels = quarters.map((q, i) => ({ value: i + 1, label: q }));
          if (labels.length > 0 && !labels.some((l) => l.label === quarter.label)) {
            setQuarter(labels[0]);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [config, selectedYear]);

  const quarterOptionsFromData = [];
  const nonFormattedQuarters = Object.keys(data?.quarterlyData || {});
  for (let i = 0; i < nonFormattedQuarters.length; i++) {
    const q = nonFormattedQuarters[i];
    if (q === 'Total') continue;
    quarterOptionsFromData.push({ value: i + 1, label: q });
  }

  const quarterOptionsFromGoals = (config?.goalsByYear?.[selectedYear] || []).map((q) => ({
    value: q.value,
    label: q.label,
  }));

  const quarterOptions = quarterOptionsFromData.length > 0 ? quarterOptionsFromData : quarterOptionsFromGoals;

  const selectedQuarterData = data?.quarterlyData?.[quarter.label];
  const currentAAR = selectedQuarterData?.totalARR || 0;
  const currentYearAAR = data?.quarterlyData?.Total?.totalARR || 0;
  const opportunities = selectedQuarterData?.opportunities || [];

  const quarterlyGoalsFromConfig = (config?.goalsByYear?.[selectedYear] || []);
  const yearlyGoal = quarterlyGoalsFromConfig.reduce((acc, q) => acc + q.goal, 0);
  const selectedQuarterGoal = quarterlyGoalsFromConfig.find((q) => q.label === quarter.label);
  const quarterlyGoal = selectedQuarterGoal?.goal || 0;

  const compensation = {
    'sales engineer 1': 15000,
    'sales engineer 2': 17500,
    'sales engineer Lead': 20000,
  };

  const getProgressClass = (percentage) => {
    if (percentage < 30) return 'progress-bar-low';
    if (percentage < 80) return 'progress-bar-medium';
    return 'progress-bar-high';
  };

  const handleYearChange = (e) => {
    const year = parseInt(e.target.value, 10);
    if (!Number.isNaN(year)) {
      setSelectedYear(year);
      const currentYearQuarterLabel = getCurrentQuarterLabel(year);
      setQuarter((prev) => {
        const fallbackLabel = quarterOptionsFromGoals[0]?.label || currentYearQuarterLabel;
        return { ...prev, label: fallbackLabel };
      });
    }
  };

  const handleQuarterChange = (event) => {
    const selectedQuarter = event.target.value;
    const quarterObj = quarterOptions.find((q) => q.label === selectedQuarter);
    setQuarter(quarterObj || { value: selectedQuarter, label: selectedQuarter });
  };

  const calculateGoalProgress = (currentAARVal, quarterlyGoalVal) => {
    if (!currentAARVal || !quarterlyGoalVal) return 0;
    return (currentAARVal / quarterlyGoalVal) * 100;
  };

  const formatNumber = (num) => {
    if (!num) return '0';
    if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(0) + 'K';
    } else {
      return num.toString();
    }
  };

  const calculateCompensation = (role, currentAARVal, quarterlyGoalVal) => {
    const yearlyCompensation = compensation[role];
    const quarterlyCompensation = yearlyCompensation / 4;
    if (currentAARVal / quarterlyGoalVal < 0.8) {
      return { compensation: 0, quarterlyCompensation };
    } else {
      const comp = quarterlyCompensation * (currentAARVal / quarterlyGoalVal);
      return { compensation: comp, quarterlyCompensation };
    }
  };

  const progressPercentage = calculateGoalProgress(currentAAR, quarterlyGoal);

  if (configError) {
    return (
      <div className="salesforce-metrics">
        <div className="metrics-header">
          <h1>Salesforce Metrics</h1>
          <p className="error">Failed to load config: {configError}</p>
        </div>
      </div>
    );
  }

  if (config && availableYears.length === 0) {
    return (
      <div className="salesforce-metrics">
        <div className="metrics-header">
          <h1>Salesforce Metrics</h1>
          <p>No years configured. Check report IDs and snapshot years in config.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="salesforce-metrics">
      <div className="metrics-header">
        <div className="metrics-header-text">
          <h1>Salesforce Metrics</h1>
          <p>Track and analyze your Salesforce performance</p>
        </div>
        <div className="metrics-header-select">
          <p>Year:</p>
          <select
            onChange={handleYearChange}
            value={selectedYear ?? ''}
            disabled={!config || availableYears.length === 0}
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <p>Quarter:</p>
          <select
            onChange={handleQuarterChange}
            value={quarter.label}
            disabled={quarterOptions.length === 0 && loading}
          >
            {quarterOptions.length > 0 ? (
              quarterOptions.map((q) => (
                <option key={q.value} value={q.label}>
                  {q.label}
                </option>
              ))
            ) : (
              <option value="">{loading ? 'Loading quarters...' : 'No quarters available'}</option>
            )}
          </select>
        </div>
      </div>

      <div className="metrics-content">
        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Current Quarter Goal</h2>
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">$ {formatNumber(quarterlyGoal)}</h3>
            <p className="quarterly-goal-text"> Target for {quarter.label}</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Current Quarter AAR</h2>
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">$ {formatNumber(currentAAR)}</h3>
            <p className="quarterly-goal-text">Current quarter AAR</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Quarterly Goal Progress</h2>
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">{progressPercentage.toFixed(2)}%</h3>
            <div className={`progress-bar ${getProgressClass(progressPercentage)}`}>
              <div className="progress-bar-fill" style={{ width: `${progressPercentage}%` }}></div>
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Yearly Goal</h2>
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">$ {formatNumber(yearlyGoal)}</h3>
            <p className="quarterly-goal-text">Target for the year</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Yearly AAR</h2>
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">$ {formatNumber(currentYearAAR)}</h3>
            <p className="quarterly-goal-text">Current year AAR</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Yearly Goal Progress</h2>
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">
              {calculateGoalProgress(currentYearAAR, yearlyGoal).toFixed(2)}%
            </h3>
            <div
              className={`progress-bar ${getProgressClass(calculateGoalProgress(currentYearAAR, yearlyGoal))}`}
            >
              <div
                className="progress-bar-fill"
                style={{ width: `${calculateGoalProgress(currentYearAAR, yearlyGoal)}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      <div className="table-separator"></div>

      <div className="table-container">
        <table>
          <caption>Closed Won Opportunities</caption>
          <thead>
            <tr>
              <th> AE Name </th>
              <th> Opportunity Name </th>
              <th> Amount Closed </th>
              <th> Close Date </th>
              <th> Account Score </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>
                  Loading opportunities...
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: '#e74c3c' }}>
                  Error loading data: {error}
                </td>
              </tr>
            ) : opportunities && opportunities.length > 0 ? (
              opportunities.map((opportunity, index) => (
                <tr key={opportunity.opportunityId || `opp-${index}`}>
                  <td>{opportunity.aeName}</td>
                  <td>{opportunity.opportunityName}</td>
                  <td>{opportunity.arrAmountFormatted || formatNumber(opportunity.arrAmount)}</td>
                  <td>{opportunity.effectiveDate}</td>
                  <td>{opportunity.salesScore}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>
                  No opportunities found for this quarter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="table-separator"></div>

      <div className="compensation-container">
        <table>
          <caption>
            <span>Compensation</span>
            <span className="caption-subtitle">We must hit Target of <strong>{formatNumber(quarterlyGoal * .80)}</strong> for {quarter.label.split(' ')[0]}</span>
          </caption>
          <thead>
            <tr>
              <th>SE Role</th>
              <th>Yearly Compensation</th>
              <th>Quarterly Compensation</th>
              <th>Current Quarter Compensation</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(compensation).map((role) => (
              <tr key={role}>
                <td>{role.toUpperCase()}</td>
                <td>{compensation[role].toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td>{calculateCompensation(role, currentAAR, quarterlyGoal).quarterlyCompensation.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td>{calculateCompensation(role, currentAAR, quarterlyGoal).compensation.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SalesforceMetrics;
