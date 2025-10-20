import React, { useEffect, useState } from 'react';
import './SalesforceMetrics.css';

const SalesforceMetrics = () => {
  // states
  const [quarter, setQuarter] = useState({ value: 'Q4 2025', label: 'Q4 2025' });
  const [quarterlyGoal, setQuarterlyGoal] = useState(3560000);
  const [currentAAR, setCurrentAAR] = useState(205000);
  const [lastQuarterAAR, setLastQuarterAAR] = useState(145000);
  const [quarterlyIncrease, setQuarterlyIncrease] = useState(0);

  // constants
  const quarters = [
    { value: 'Q1 2025', label: 'Q1 2025' },
    { value: 'Q2 2025', label: 'Q2 2025' },
    { value: 'Q3 2025', label: 'Q3 2025' },
    { value: 'Q4 2025', label: 'Q4 2025' },
  ];

  const quarterlyGoals = [
    { value: 'Q1 2025', goal: 1900000, previousGoal: 1500000 },
    { value: 'Q2 2025', goal: 2520000, previousGoal: 1900000 },
    { value: 'Q3 2025', goal: 2500000, previousGoal: 2520000 },
    { value: 'Q4 2025', goal: 3560000, previousGoal: 2500000 },
  ];

  const quarterlyAARs = [
    { value: 'Q1 2025', aar: 150000, lastQuarterAAR: 120000 },
    { value: 'Q2 2025', aar: 180000, lastQuarterAAR: 150000 },
    { value: 'Q3 2025', aar: 205000, lastQuarterAAR: 180000 },
    { value: 'Q4 2025', aar: 205000, lastQuarterAAR: 205000 },
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
    
    // Find the data for the selected quarter
    const quarterData = quarterlyAARs.find(q => q.value === selectedQuarter);
    const goalData = quarterlyGoals.find(q => q.value === selectedQuarter);
    
    if (quarterData && goalData) {
      // Don't update currentAAR - it stays constant at $205K
      setLastQuarterAAR(quarterData.lastQuarterAAR);
      setQuarterlyGoal(goalData.goal);
      setQuarterlyIncrease(calculateQuarterlyIncrease(goalData.goal, goalData.previousGoal));
    }
  };

  const calculateGoalProgress = (currentAAR, quarterlyGoal) => {
    return (currentAAR / quarterlyGoal) * 100;
  };

  const formatNumber = (num) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(0) + 'K';
    } else {
      return num.toString();
    }
  };

  const calculateQuarterlyIncrease = (currentAAR, lastQuarterAAR) => {
    if (lastQuarterAAR === 0) return 0;
    return ((currentAAR - lastQuarterAAR) / lastQuarterAAR) * 100;
  };

  // Calculate current progress percentage based on quarter-specific AAR
  const getCurrentQuarterAAR = () => {
    const quarterData = quarterlyAARs.find(q => q.value === quarter.value);
    return quarterData ? quarterData.aar : currentAAR;
  };
  
  const progressPercentage = calculateGoalProgress(getCurrentQuarterAAR(), quarterlyGoal);

  // Use Effects
  useEffect(() => {
    // Initialize with Q4 2025 data
    const initialQuarterData = quarterlyAARs.find(q => q.value === quarter.value);
    const initialGoalData = quarterlyGoals.find(q => q.value === quarter.value);
    
    if (initialQuarterData && initialGoalData) {
      // currentAAR stays at its initial value of 205000
      setLastQuarterAAR(initialQuarterData.lastQuarterAAR);
      setQuarterlyGoal(initialGoalData.goal);
      setQuarterlyIncrease(calculateQuarterlyIncrease(initialGoalData.goal, initialGoalData.previousGoal));
    }
  }, []);


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
          <tr>
            <td> John Doe </td>
            <td> Opportunity 1 </td>
            <td> $100,000 </td>
            <td> 2025-01-01 </td>
            <td> 5 </td>
          </tr>
          <tr>
            <td> Jane Doe </td>
            <td> Opportunity 2 </td>
            <td> $200,000 </td>
            <td> 2025-02-01 </td>
            <td> 4 </td>
          </tr>
          <tr>
            <td> Jim Beam </td>
            <td> Opportunity 3 </td>
            <td> $300,000 </td>
            <td> 2025-03-01 </td>
            <td> 3 </td>
          </tr>
          <tr>
            <td> John Doe </td>
            <td> Opportunity 1 </td>
            <td> $100,000 </td>
            <td> 2025-01-01 </td>
            <td> 5 </td>
          </tr>
          <tr>
            <td> Jane Doe </td>
            <td> Opportunity 2 </td>
            <td> $200,000 </td>
            <td> 2025-02-01 </td>
            <td> 4 </td>
          </tr>
          <tr>
            <td> Jim Beam </td>
            <td> Opportunity 3 </td>
            <td> $300,000 </td>
            <td> 2025-03-01 </td>
            <td> 3 </td>
          </tr>
        </tbody>
      </table>

      <div className="metrics-actions">
        <button className="btn-metric btn-primary">Refresh Data</button>
        <button className="btn-metric btn-secondary">Export Report</button>
      </div>
    </div>
  );
};

export default SalesforceMetrics;
