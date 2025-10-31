import React, { useState, useEffect } from 'react';
import './SalesforceMetrics.css';
import { fetchSalesforceReport } from '../../services/api';

const SalesforceMetrics = () => {
  console.log('✅ SalesforceMetrics component rendering');
  
  // states
  const [quarter, setQuarter] = useState({ value: '4', label: 'Q4 CY2025' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Basic API call to get you started
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const response = await fetchSalesforceReport('00OPA000002sLkf2AE');
        console.log('API Response:', response);
        setData(response);
      } catch (err) {
        setError(err.message);
        console.error('Error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Get quarter options from the data
  const quarterOptions = [];
  const nonFormattedQuarters = Object.keys(data?.quarterlyData || {});
  for (let i = 0; i < nonFormattedQuarters.length; i++) {
    const quarter = nonFormattedQuarters[i];
    if (quarter === 'Total') continue;
    quarterOptions.push({ value: i + 1, label: quarter });
  }

  // Get Data for the selected quarter
  const selectedQuarterData = data?.quarterlyData[quarter.label];
  const currentAAR = selectedQuarterData?.totalARR || 0;
  const currentYearAAR = data?.quarterlyData?.Total?.totalARR || 0;
  const opportunities = selectedQuarterData?.opportunities || [];
  const quarterlyGoals = [
    { value: 1, label: 'Q1 CY2025', goal: 1900000 },
    { value: 2, label: 'Q2 CY2025', goal: 2520000 },
    { value: 3, label: 'Q3 CY2025', goal: 2500000 },
    { value: 4, label: 'Q4 CY2025', goal: 3560000 },
  ];
  const yearlyGoal = quarterlyGoals.reduce((acc, q) => acc + q.goal, 0);
  const selectedQuarterGoal = quarterlyGoals.find((q) => q.label === quarter.label);
  const quarterlyGoal = selectedQuarterGoal?.goal || 0;
  console.log(`Opportunities: ${opportunities[0]}`);

  // functions
  const getProgressClass = (percentage) => {
    if (percentage < 30) return 'progress-bar-low';
    if (percentage < 80) return 'progress-bar-medium';
    return 'progress-bar-high';
  };

  const handleQuarterChange = (event) => {
    const selectedQuarter = event.target.value;
    const quarterObj = quarterOptions.find((q) => q.label === selectedQuarter);
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

  // Data processing logic (to be implemented by the user)
  const quarterlyIncrease = 0; // Placeholder

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
          <select onChange={handleQuarterChange} value={quarter.label} disabled={quarterOptions.length === 0}>
            {quarterOptions.length > 0 ? (
              quarterOptions.map((q) => (
                <option
                  key={q.value}
                  value={q.label}
                >{q.label}</option>
              ))
            ) : (
              <option value="">Loading quarters...</option>
            )}
          </select>
        </div>
      </div>

      <div className="metrics-content">
        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Current Quarter Goal</h2>
            {/* <img src={quarterlyGoalIcon} alt="Quarterly Goal" /> */}
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">$ {formatNumber(quarterlyGoal)}</h3>
            <p className="quarterly-goal-text"> Target for {quarter.label}</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Current Quarter AAR</h2>
            {/* <img src={quarterlyGoalIcon} alt="Quarterly Goal" /> */}
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">$ {formatNumber(currentAAR)}</h3>
            <p
              className="quarterly-goal-text"
              style={{
                color: quarterlyIncrease >= 0 ? '#27ae60' : '#e74c3c',
                fontWeight: '500',
              }}
            >
              {quarterlyIncrease >= 0 ? '+' : ''}
              {quarterlyIncrease.toFixed(2)}% from last quarter
            </p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Quarterly Goal Progress</h2>
            {/* <img src={quarterlyGoalIcon} alt="Quarterly Goal" /> */}
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
            {/* <img src={quarterlyGoalIcon} alt="Yearly Goal" /> */}
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">$ {formatNumber(yearlyGoal)}</h3>
            <p className="quarterly-goal-text">Target for the year</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Yearly AAR</h2>
            {/* <img src={quarterlyGoalIcon} alt="Yearly AAR" /> */}
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">$ {formatNumber(currentYearAAR)}</h3>
            <p className="quarterly-goal-text">Current year AAR</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Yearly Goal Progress</h2>
            {/* <img src={quarterlyGoalIcon} alt="Yearly Goal Progress" /> */}
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">{calculateGoalProgress(currentYearAAR, yearlyGoal).toFixed(2)}%</h3>
            <div className={`progress-bar ${getProgressClass(calculateGoalProgress(currentYearAAR, yearlyGoal))}`}>
              <div className="progress-bar-fill" style={{ width: `${calculateGoalProgress(currentYearAAR, yearlyGoal)}%` }}></div>
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

      <div className="metrics-actions">
        <button className="btn-metric btn-primary" onClick={null} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh Data'}
        </button>
        <button className="btn-metric btn-secondary">Export Report</button>
      </div>
    </div>
  );
};

export default SalesforceMetrics;
