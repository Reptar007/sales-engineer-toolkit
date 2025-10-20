import { useState, useEffect, useCallback } from 'react';

// Mock data for now - will be replaced with API calls
const mockData = {
  'Q1 2025': {
    currentAAR: 1000000,
    quarterlyGoal: 1900000,
    lastQuarterAAR: 120000,
    quarterlyIncrease: 25.0,
    opportunities: [
      {
        id: 1,
        aeName: 'John Doe',
        opportunityName: 'Opportunity 1',
        amount: 100000,
        closeDate: '2025-01-01',
        accountScore: 5,
      },
      {
        id: 2,
        aeName: 'Jane Doe',
        opportunityName: 'Opportunity 2',
        amount: 200000,
        closeDate: '2025-02-01',
        accountScore: 4,
      },
      {
        id: 3,
        aeName: 'Jim Beam',
        opportunityName: 'Opportunity 3',
        amount: 300000,
        closeDate: '2025-03-01',
        accountScore: 3,
      },
    ],
  },
  'Q2 2025': {
    currentAAR: 180000,
    quarterlyGoal: 2520000,
    lastQuarterAAR: 150000,
    quarterlyIncrease: 20.0,
    opportunities: [
      {
        id: 4,
        aeName: 'John Doe',
        opportunityName: 'Opportunity 4',
        amount: 150000,
        closeDate: '2025-04-01',
        accountScore: 5,
      },
      {
        id: 5,
        aeName: 'Jane Doe',
        opportunityName: 'Opportunity 5',
        amount: 250000,
        closeDate: '2025-05-01',
        accountScore: 4,
      },
      {
        id: 6,
        aeName: 'Jim Beam',
        opportunityName: 'Opportunity 6',
        amount: 350000,
        closeDate: '2025-06-01',
        accountScore: 3,
      },
    ],
  },
  'Q3 2025': {
    currentAAR: 205000,
    quarterlyGoal: 2500000,
    lastQuarterAAR: 180000,
    quarterlyIncrease: 13.89,
    opportunities: [
      {
        id: 7,
        aeName: 'John Doe',
        opportunityName: 'Opportunity 7',
        amount: 200000,
        closeDate: '2025-07-01',
        accountScore: 5,
      },
      {
        id: 8,
        aeName: 'Jane Doe',
        opportunityName: 'Opportunity 8',
        amount: 300000,
        closeDate: '2025-08-01',
        accountScore: 4,
      },
      {
        id: 9,
        aeName: 'Jim Beam',
        opportunityName: 'Opportunity 9',
        amount: 400000,
        closeDate: '2025-09-01',
        accountScore: 3,
      },
    ],
  },
  'Q4 2025': {
    currentAAR: 205000,
    quarterlyGoal: 3560000,
    lastQuarterAAR: 205000,
    quarterlyIncrease: 0.0,
    opportunities: [
      {
        id: 10,
        aeName: 'John Doe',
        opportunityName: 'Opportunity 10',
        amount: 100000,
        closeDate: '2025-10-01',
        accountScore: 5,
      },
      {
        id: 11,
        aeName: 'Jane Doe',
        opportunityName: 'Opportunity 11',
        amount: 200000,
        closeDate: '2025-11-01',
        accountScore: 4,
      },
      {
        id: 12,
        aeName: 'Jim Beam',
        opportunityName: 'Opportunity 12',
        amount: 300000,
        closeDate: '2025-12-01',
        accountScore: 3,
      },
    ],
  },
};

const useSalesforceData = (quarter) => {
  const [currentAAR, setCurrentAAR] = useState(null);
  const [quarterlyGoal, setQuarterlyGoal] = useState(null);
  const [lastQuarterAAR, setLastQuarterAAR] = useState(null);
  const [quarterlyIncrease, setQuarterlyIncrease] = useState(0);
  const [opportunities, setOpportunities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchSalesforceData = useCallback(async (quarterValue) => {
    setLoading(true);
    setError(null);

    try {
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Mock API call - replace with real API calls later
      const data = mockData[quarterValue];

      if (data) {
        setCurrentAAR(data.currentAAR);
        setQuarterlyGoal(data.quarterlyGoal);
        setLastQuarterAAR(data.lastQuarterAAR);
        setQuarterlyIncrease(data.quarterlyIncrease);
        setOpportunities(data.opportunities);
      } else {
        throw new Error(`No data found for quarter: ${quarterValue}`);
      }
    } catch (err) {
      setError(err.message);
      console.error('Failed to fetch Salesforce data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (quarter) {
      fetchSalesforceData(quarter);
    }
  }, [quarter, fetchSalesforceData]);

  const refetch = () => {
    fetchSalesforceData(quarter);
  };

  return {
    currentAAR,
    quarterlyGoal,
    lastQuarterAAR,
    quarterlyIncrease,
    opportunities,
    loading,
    error,
    refetch,
  };
};

export default useSalesforceData;
