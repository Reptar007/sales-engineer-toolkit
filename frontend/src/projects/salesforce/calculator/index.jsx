import React, { useState, useEffect } from 'react';
import { fetchSalesforceReport } from '../../../services/api';
import './SalesforceCalculator.css';

const SalesforceCalculator = () => { 
    const [data, setData] = useState(null);
    const [metricsData, setMetricsData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedOpps, setSelectedOpps] = useState([]);
    const [sortColumn, setSortColumn] = useState(null);
    const [sortDirection, setSortDirection] = useState('asc'); // 'asc' or 'desc'
    
    // Current quarter - hardcoded to Q4 CY2025 (can be made dynamic later)
    const currentQuarter = 'Q4 CY2025';

    // Quarterly goals and compensation structure
    const quarterlyGoals = [
        { value: 1, label: 'Q1 CY2025', goal: 1900000 },
        { value: 2, label: 'Q2 CY2025', goal: 2520000 },
        { value: 3, label: 'Q3 CY2025', goal: 2500000 },
        { value: 4, label: 'Q4 CY2025', goal: 3560000 },
    ];
    const compensation = {
        'sales engineer 1': 15000,
        'sales engineer 2': 17500,
        'sales engineer Lead': 20000,
    };

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                // Fetch both Calculator opportunities and Metrics data
                const [calculatorResponse, metricsResponse] = await Promise.all([
                    fetchSalesforceReport('00OPA000002uP5p2AE'),
                    fetchSalesforceReport('00OPA000002sLkf2AE'),
                ]);
                setData(calculatorResponse);
                setMetricsData(metricsResponse);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    // Toggle selection of an opportunity
    const toggleSelection = (opportunityId) => {
        setSelectedOpps((prev) => {
            if (prev.includes(opportunityId)) {
                return prev.filter((id) => id !== opportunityId);
            } else {
                return [...prev, opportunityId];
            }
        });
    };

    // Handle column sorting
    const handleSort = (column) => {
        if (sortColumn === column) {
            // Toggle direction if same column
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            // New column, default to ascending
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    // Get current quarter AAR from Metrics report
    const selectedQuarterData = metricsData?.quarterlyData?.[currentQuarter];
    const currentQuarterAAR = selectedQuarterData?.totalARR || 0;
    const currentQuarterAARFormatted = `$${currentQuarterAAR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Get quarterly goal for current quarter
    const selectedQuarterGoal = quarterlyGoals.find((q) => q.label === currentQuarter);
    const quarterlyGoal = selectedQuarterGoal?.goal || 0;

    // Calculate totals
    const allOpportunities = data?.data || [];
    const totalOpportunities = data?.totalOpportunities || 0;

    // Sort opportunities
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

    // Calculate added total from selected opportunities
    const addedTotalARR = opportunities
        .filter((opp) => selectedOpps.includes(opp.opportunityId))
        .reduce((sum, opp) => sum + (opp.arrAmount || 0), 0);
    const addedTotalARRFormatted = `$${addedTotalARR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Calculate projected total (Current Quarter AAR + Added opportunities)
    const projectedTotalARR = currentQuarterAAR + addedTotalARR;
    const projectedTotalARRFormatted = `$${projectedTotalARR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Calculate compensation for projected total
    const calculateCompensation = (role, projectedAAR, goal) => {
        const yearlyCompensation = compensation[role];
        const quarterlyCompensation = yearlyCompensation / 4;

        if (projectedAAR / goal < 0.8) {
            return { compensation: 0, quarterlyCompensation };
        } else {
            const comp = quarterlyCompensation * (projectedAAR / goal);
            return { compensation: comp, quarterlyCompensation };
        }
    };

    // Clear all selections
    const clearSelection = () => {
        setSelectedOpps([]);
    };

    // Select all opportunities
    const selectAll = () => {
        const allOppIds = opportunities.map(opp => opp.opportunityId);
        setSelectedOpps(allOppIds);
    };

    // Helper function to get progress bar class
    const getProgressClass = (percentage) => {
        if (percentage < 30) return 'progress-bar-low';
        if (percentage < 80) return 'progress-bar-medium';
        return 'progress-bar-high';
    };

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

            {/* Summary Cards */}
            <div className="calculator-content">
                <div className="metric-card">
                    <div className="metric-card-header">
                        <h2>💰 Current Quarter AAR</h2>
                    </div>
                    <div className="metric-card-body">
                        <h3 className="metric-card-body-text">{currentQuarterAARFormatted}</h3>
                        <p className="quarterly-goal-text">Closed won for {currentQuarter}</p>
                    </div>
                </div>
                <div className="metric-card">
                    <div className="metric-card-header">
                        <h2>➕ Added Opportunities</h2>
                    </div>
                    <div className="metric-card-body">
                        <h3 className="metric-card-body-text">{addedTotalARRFormatted}</h3>
                        <p className="quarterly-goal-text">{selectedOpps.length} selected</p>
                    </div>
                </div>
                <div className="metric-card" style={{ backgroundColor: '#f0f8ff' }}>
                    <div className="metric-card-header">
                        <h2>📊 Projected Total</h2>
                    </div>
                    <div className="metric-card-body">
                        <h3 className="metric-card-body-text">{projectedTotalARRFormatted}</h3>
                        <p className="quarterly-goal-text">If selected opportunities close</p>
                    </div>
                </div>
                <div className="metric-card">
                    <div className="metric-card-header">
                        <h2>📈 Quarterly Goal Progress</h2>
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

            {/* Compensation Cards */}
            <div className="calculator-compensation-container">
                {Object.keys(compensation).map((role) => {
                    const compData = calculateCompensation(role, projectedTotalARR, quarterlyGoal);
                    const roleClass = role === 'sales engineer 1' ? 'compensation-card-se1' : 
                                     role === 'sales engineer 2' ? 'compensation-card-se2' : 
                                     'compensation-card-lead';
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
                                {projectedTotalARR / quarterlyGoal < 0.8 && (
                                    <p style={{ fontSize: '0.75rem', color: '#d32f2f', marginTop: '0.5rem' }}>
                                        ⚠️ Must hit 80% of goal to earn compensation
                                    </p>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="table-separator"></div>

            {/* Action Buttons */}
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

            {/* Opportunities Table */}
            <div className="table-container">
                <table>
                    <caption>High Probability Opportunities ({totalOpportunities})</caption>
                    <thead>
                        <tr>
                            <th>Select</th>
                            <th 
                                className="sortable" 
                                onClick={() => handleSort('opportunityName')}
                            >
                                Opportunity Name
                                {sortColumn === 'opportunityName' && (
                                    <span className="sort-indicator">
                                        {sortDirection === 'asc' ? ' ▲' : ' ▼'}
                                    </span>
                                )}
                            </th>
                            <th>Stage</th>
                            <th 
                                className="sortable" 
                                onClick={() => handleSort('aeName')}
                            >
                                AE Name
                                {sortColumn === 'aeName' && (
                                    <span className="sort-indicator">
                                        {sortDirection === 'asc' ? ' ▲' : ' ▼'}
                                    </span>
                                )}
                            </th>
                            <th 
                                className="sortable" 
                                onClick={() => handleSort('probability')}
                            >
                                Probability
                                {sortColumn === 'probability' && (
                                    <span className="sort-indicator">
                                        {sortDirection === 'asc' ? ' ▲' : ' ▼'}
                                    </span>
                                )}
                            </th>
                            <th 
                                className="sortable" 
                                onClick={() => handleSort('arrAmount')}
                            >
                                ARR Amount
                                {sortColumn === 'arrAmount' && (
                                    <span className="sort-indicator">
                                        {sortDirection === 'asc' ? ' ▲' : ' ▼'}
                                    </span>
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
                                        <td>{opportunity.amount || `$${(opportunity.arrAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
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