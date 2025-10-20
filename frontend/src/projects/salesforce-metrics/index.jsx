import React, { useState } from 'react';
import './SalesforceMetrics.css';
import useSalesforceData from './hooks/useSalesforceData';

const SalesforceMetrics = () => {
  // states
  const [quarter, setQuarter] = useState({ value: 'Q1 2025', label: 'Q1 2025' });
  
  // Fetch data using custom hook
  const {
    currentAAR,
    quarterlyGoal,
    quarterlyIncrease,
    opportunities,
    loading,
    error,
    refetch
  } = useSalesforceData(quarter.value);

  // constants
  const quarters = [
    { value: 'Q1 2025', label: 'Q1 2025' },
    { value: 'Q2 2025', label: 'Q2 2025' },
    { value: 'Q3 2025', label: 'Q3 2025' },
    { value: 'Q4 2025', label: 'Q4 2025' },
  ];

  // functions
  const getProgressClass = (percentage) => {
    if (percentage < 30) return 'progress-bar-low';
    if (percentage < 80) return 'progress-bar-medium';
    return 'progress-bar-high';
  };

  const handleQuarterChange = (event) => {
    const selectedQuarter = event.target.value;
    const quarterObj = quarters.find(q => q.value === selectedQuarter);
    setQuarter(quarterObj || { value: selectedQuarter, label: selectedQuarter });
    // Data will automatically refetch due to useEffect dependency in the hook
  };

  const calculateGoalProgress = (currentAAR, quarterlyGoal) => {
    if (!currentAAR || !quarterlyGoal) return 0;
    return (currentAAR / quarterlyGoal) * 100;
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

  const progressPercentage = calculateGoalProgress(currentAAR, quarterlyGoal);

  return (
    <div className="salesforce-metrics">
      <div className="metrics-header">
        <div className="metrics-header-text">
          <h1>Salesforce Metrics</h1>
          <p>Track and analyze your Salesforce performance</p>
        </div>
        <div className="metrics-header-select">
          <p>Quarter:</p>
          <select onChange={handleQuarterChange} value={quarter.value}>
            {quarters.map((quarter) => (
              <option
                key={quarter.value}
                value={quarter.value}
              >
                {quarter.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="metrics-content">
        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Quarterly Goal</h2>
            {/* <img src={quarterlyGoalIcon} alt="Quarterly Goal" /> */}
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">$ {formatNumber(quarterlyGoal)}</h3>
            <p className="quarterly-goal-text"> Target for {quarter.label}</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Current AAR</h2>
            {/* <img src={quarterlyGoalIcon} alt="Quarterly Goal" /> */}
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">$ {formatNumber(currentAAR)}</h3>
            <p className="quarterly-goal-text" style={{ 
              color: quarterlyIncrease >= 0 ? '#27ae60' : '#e74c3c',
              fontWeight: '500'
            }}>
              {quarterlyIncrease >= 0 ? '+' : ''}{quarterlyIncrease.toFixed(2)}% from last quarter
            </p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Goal Progress</h2>
            {/* <img src={quarterlyGoalIcon} alt="Quarterly Goal" /> */}
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">{progressPercentage.toFixed(2)}%</h3>
            <div className={`progress-bar ${getProgressClass(progressPercentage)}`}>
              <div className="progress-bar-fill" style={{ width: `${progressPercentage}%` }}></div>
            </div>
          </div>
        </div>
      </div>

      <div className="table-separator"></div>

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
            opportunities.map((opportunity) => (
              <tr key={opportunity.id}>
                <td>{opportunity.aeName}</td>
                <td>{opportunity.opportunityName}</td>
                <td>${formatNumber(opportunity.amount)}</td>
                <td>{opportunity.closeDate}</td>
                <td>{opportunity.accountScore}</td>
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

      <div className="metrics-actions">
        <button className="btn-metric btn-primary" onClick={refetch} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh Data'}
        </button>
        <button className="btn-metric btn-secondary">Export Report</button>
      </div>
    </div>
  );
};

export default SalesforceMetrics;
