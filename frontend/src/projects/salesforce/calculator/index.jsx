import React, { useState, useEffect } from 'react';
import {
  fetchSalesforceReport,
  getSalesforceConfig,
  fetchSalesforceSnapshotMetrics,
  fetchSalesforceSnapshotCalculator,
} from '../../../services/api';
import './SalesforceCalculator.css';

function getCurrentQuarter() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  let quarter;
  if (month >= 1 && month <= 3) quarter = 1;
  else if (month >= 4 && month <= 6) quarter = 2;
  else if (month >= 7 && month <= 9) quarter = 3;
  else quarter = 4;
  return `Q${quarter} CY${year}`;
}

const SalesforceCalculator = () => {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(null);
  const [data, setData] = useState(null);
  const [metricsData, setMetricsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedOpps, setSelectedOpps] = useState([]);
  const [sortColumn, setSortColumn] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');

  const currentQuarter = getCurrentQuarter();
  const currentYear = new Date().getFullYear();

  const compensation = {
    'sales engineer 1': 15000,
    'sales engineer 2': 17500,
    'sales engineer Lead': 20000,
  };

  useEffect(() => {
    let cancelled = false;
    getSalesforceConfig()
      .then((c) => {
        if (!cancelled) {
          setConfig(c);
          setConfigError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setConfigError(err.message);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!config) {
      setLoading(true);
      return;
    }
    const reportIds = config.reportIdsByYear?.[currentYear];
    const isSnapshotYear = (config.snapshotYears || []).includes(currentYear);
    if (!isSnapshotYear && (!reportIds?.metrics || !reportIds?.calculator)) {
      setError(`No report IDs configured for year ${currentYear}`);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchCalculator = () =>
      isSnapshotYear
        ? fetchSalesforceSnapshotCalculator(currentYear).catch(() => {
            if (reportIds?.calculator) return fetchSalesforceReport(reportIds.calculator);
            throw new Error('Snapshot unavailable and no calculator report ID');
          })
        : fetchSalesforceReport(reportIds.calculator);
    const fetchMetrics = () =>
      isSnapshotYear
        ? fetchSalesforceSnapshotMetrics(currentYear).catch(() => {
            if (reportIds?.metrics) return fetchSalesforceReport(reportIds.metrics);
            throw new Error('Snapshot unavailable and no metrics report ID');
          })
        : fetchSalesforceReport(reportIds.metrics);

    Promise.all([fetchCalculator(), fetchMetrics()])
      .then(([calculatorResponse, metricsResponse]) => {
        if (!cancelled) {
          setData(calculatorResponse);
          setMetricsData(metricsResponse);
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

  const toggleSelection = (opportunityId) => {
    setSelectedOpps((prev) => {
      if (prev.includes(opportunityId)) {
        return prev.filter((id) => id !== opportunityId);
      } else {
        return [...prev, opportunityId];
      }
    });
  };

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const quarterlyGoalsFromConfig = config?.goalsByYear?.[currentYear] || [];
  const selectedQuarterGoal = quarterlyGoalsFromConfig.find((q) => q.label === currentQuarter);
  const quarterlyGoal = selectedQuarterGoal?.goal || 0;

  const selectedQuarterData = metricsData?.quarterlyData?.[currentQuarter];
  const currentQuarterAAR = selectedQuarterData?.totalARR || 0;
  const currentQuarterAARFormatted = `$${currentQuarterAAR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const allOpportunities = data?.data || [];
  const totalOpportunities = data?.totalOpportunities || 0;

  const sortedOpportunities = [...allOpportunities].sort((a, b) => {
    if (!sortColumn) return 0;
    let aValue, bValue;
    switch (sortColumn) {
      case 'opportunityName':
        aValue = (a.opportunityName || '').toLowerCase();
        bValue = (b.opportunityName || '').toLowerCase();
        break;
      case 'aeName':
        aValue = (a.aeName || '').toLowerCase();
        bValue = (b.aeName || '').toLowerCase();
        break;
      case 'probability':
        aValue = typeof a.probability === 'number' ? a.probability : parseInt(a.probability) || 0;
        bValue = typeof b.probability === 'number' ? b.probability : parseInt(b.probability) || 0;
        break;
      case 'arrAmount':
        aValue = a.arrAmount || 0;
        bValue = b.arrAmount || 0;
        break;
      default:
        return 0;
    }
    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const opportunities = sortedOpportunities;

  const addedTotalARR = opportunities
    .filter((opp) => selectedOpps.includes(opp.opportunityId))
    .reduce((sum, opp) => sum + (opp.arrAmount || 0), 0);
  const addedTotalARRFormatted = `$${addedTotalARR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const projectedTotalARR = currentQuarterAAR + addedTotalARR;
  const projectedTotalARRFormatted = `$${projectedTotalARR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const calculateCompensation = (role, projectedAAR, goal) => {
    const yearlyCompensation = compensation[role];
    const quarterlyCompensation = yearlyCompensation / 4;
    if (!goal || projectedAAR / goal < 0.8) {
      return { compensation: 0, quarterlyCompensation };
    } else {
      const comp = quarterlyCompensation * (projectedAAR / goal);
      return { compensation: comp, quarterlyCompensation };
    }
  };

  const clearSelection = () => setSelectedOpps([]);
  const selectAll = () => setSelectedOpps(opportunities.map((opp) => opp.opportunityId));

  const getProgressClass = (percentage) => {
    if (percentage < 30) return 'progress-bar-low';
    if (percentage < 80) return 'progress-bar-medium';
    return 'progress-bar-high';
  };

  if (configError) {
    return (
      <div className="salesforce-calculator">
        <div className="error-state">
          <h1>Salesforce Calculator</h1>
          <p>Failed to load config: {configError}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="salesforce-calculator">
        <div className="loading-state">
          <h1>Salesforce Calculator</h1>
          <p>Loading opportunities...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="salesforce-calculator">
        <div className="error-state">
          <h1>Salesforce Calculator</h1>
          <p>Error: {error}</p>
        </div>
      </div>
    );
  }

  const progressPercentage = quarterlyGoal > 0 ? (projectedTotalARR / quarterlyGoal) * 100 : 0;
  const goalFormatted = `$${(quarterlyGoal / 1000000).toFixed(2)}M`;

  return (
    <div className="salesforce-calculator">
      <div className="calculator-header">
        <div className="calculator-header-text">
          <h1>Salesforce Calculator</h1>
          <p>Calculate projected totals and compensation for {currentQuarter}</p>
        </div>
      </div>

      <div className="calculator-content">
        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Current Quarter AAR</h2>
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">{currentQuarterAARFormatted}</h3>
            <p className="quarterly-goal-text">Closed won for {currentQuarter}</p>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Added Opportunities</h2>
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">{addedTotalARRFormatted}</h3>
            <p className="quarterly-goal-text">{selectedOpps.length} selected</p>
          </div>
        </div>
        <div className="metric-card" style={{ backgroundColor: '#f0f8ff' }}>
          <div className="metric-card-header">
            <h2>Projected Total</h2>
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">{projectedTotalARRFormatted}</h3>
            <p className="quarterly-goal-text">If selected opportunities close</p>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-card-header">
            <h2>Quarterly Goal Progress</h2>
          </div>
          <div className="metric-card-body">
            <h3 className="metric-card-body-text">{progressPercentage.toFixed(2)}%</h3>
            <div className={`progress-bar ${getProgressClass(progressPercentage)}`}>
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.min(progressPercentage, 100)}%` }}
              ></div>
            </div>
            <p className="quarterly-goal-text">Goal: {goalFormatted}</p>
          </div>
        </div>
      </div>

      <div className="table-separator"></div>

      <div className="calculator-compensation-container">
        {Object.keys(compensation).map((role) => {
          const compData = calculateCompensation(role, projectedTotalARR, quarterlyGoal);
          const roleClass =
            role === 'sales engineer 1'
              ? 'compensation-card-se1'
              : role === 'sales engineer 2'
                ? 'compensation-card-se2'
                : 'compensation-card-lead';
          return (
            <div key={role} className={`compensation-card ${roleClass}`}>
              <div className="metric-card-header">
                <h2>{role.toUpperCase()}</h2>
              </div>
              <div className="metric-card-body">
                <h3 className="metric-card-body-text" style={{ fontSize: '2rem' }}>
                  ${compData.compensation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </h3>
                <p className="quarterly-goal-text">
                  Quarterly: ${compData.quarterlyCompensation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                {quarterlyGoal > 0 && projectedTotalARR / quarterlyGoal < 0.8 && (
                  <p style={{ fontSize: '0.75rem', color: '#d32f2f', marginTop: '0.5rem' }}>
                    Must hit 80% of goal to earn compensation
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="table-separator"></div>

      <div className="calculator-actions">
        <button
          className="btn-calculator"
          onClick={selectAll}
          disabled={opportunities.length === 0 || selectedOpps.length === opportunities.length}
        >
          Select All
        </button>
        <button
          className="btn-calculator"
          onClick={clearSelection}
          disabled={selectedOpps.length === 0}
        >
          Clear Selection ({selectedOpps.length})
        </button>
      </div>

      <div className="table-container">
        <table>
          <caption>High Probability Opportunities ({totalOpportunities})</caption>
          <thead>
            <tr>
              <th>Select</th>
              <th className="sortable" onClick={() => handleSort('opportunityName')}>
                Opportunity Name
                {sortColumn === 'opportunityName' && (
                  <span className="sort-indicator">{sortDirection === 'asc' ? ' ▲' : ' ▼'}</span>
                )}
              </th>
              <th>Stage</th>
              <th className="sortable" onClick={() => handleSort('aeName')}>
                AE Name
                {sortColumn === 'aeName' && (
                  <span className="sort-indicator">{sortDirection === 'asc' ? ' ▲' : ' ▼'}</span>
                )}
              </th>
              <th className="sortable" onClick={() => handleSort('probability')}>
                Probability
                {sortColumn === 'probability' && (
                  <span className="sort-indicator">{sortDirection === 'asc' ? ' ▲' : ' ▼'}</span>
                )}
              </th>
              <th className="sortable" onClick={() => handleSort('arrAmount')}>
                ARR Amount
                {sortColumn === 'arrAmount' && (
                  <span className="sort-indicator">{sortDirection === 'asc' ? ' ▲' : ' ▼'}</span>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {opportunities.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ padding: '2rem', textAlign: 'center' }}>
                  No opportunities found
                </td>
              </tr>
            ) : (
              opportunities.map((opportunity) => {
                const isSelected = selectedOpps.includes(opportunity.opportunityId);
                return (
                  <tr
                    key={opportunity.opportunityId}
                    className={isSelected ? 'selected' : ''}
                    onClick={() => toggleSelection(opportunity.opportunityId)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelection(opportunity.opportunityId)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td>{opportunity.opportunityName}</td>
                    <td>{opportunity.stage}</td>
                    <td>{opportunity.aeName}</td>
                    <td>{opportunity.probabilityFormatted || `${opportunity.probability}%`}</td>
                    <td>
                      {opportunity.amount ||
                        `$${(opportunity.arrAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SalesforceCalculator;
