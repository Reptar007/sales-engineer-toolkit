import React, { useState } from 'react';
import { searchOpportunities } from '../../../services/api';
import { OpportunityDetailsCard } from './OpportunityDetailsCard';
import { formatCurrency, formatDate, lookupPrimaryRevenue } from './opportunityHelpers';
import './SalesforceLookup.css';

const SalesforceLookup = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedOpportunity, setSelectedOpportunity] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const trimmedSearch = searchTerm.trim();
    if (!trimmedSearch || trimmedSearch.length < 2) {
      setError('Search term must be at least 2 characters long');
      return;
    }

    setLoading(true);
    setError(null);
    setHasSearched(true);
    setSelectedOpportunity(null);

    try {
      const response = await searchOpportunities(trimmedSearch);
      if (response.success) {
        setResults(response.data || []);
      } else {
        setError(response.error || 'Search failed');
        setResults([]);
      }
    } catch (err) {
      setError(err.message || 'Failed to search opportunities');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  // Show loading screen
  if (loading) {
    return (
      <div className="salesforce-lookup">
        <div className="lookup-loading-screen">
          <div className="lookup-spinner"></div>
          <h2>Searching Salesforce...</h2>
          <p>Please wait while we find matching opportunities</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`salesforce-lookup ${hasSearched ? 'salesforce-lookup-has-results' : ''}`}>
      <div className={`lookup-header ${hasSearched ? 'lookup-header-compact' : ''}`}>
        <div className="lookup-header-content">
          {!hasSearched && <div className="lookup-header-overline">SCENT TRACKER</div>}
          <h1>Salesforce Lookup</h1>
          {!hasSearched && <p>Search for opportunities by name or account</p>}
        </div>
        <form
          onSubmit={handleSubmit}
          className={`lookup-search-form ${hasSearched ? 'lookup-search-form-compact' : ''}`}
        >
          <div className="lookup-search-container">
            <input
              type="text"
              className="lookup-search-input"
              placeholder="Enter opportunity name or account name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={loading}
              aria-label="Search opportunities"
            />
            <button
              type="submit"
              className="lookup-search-button"
              disabled={loading || !searchTerm.trim()}
            >
              Search
            </button>
          </div>
        </form>
      </div>

      {error && (
        <div className="lookup-error">
          <p>{error}</p>
        </div>
      )}

      {hasSearched && !loading && !error && (
        <div className="lookup-results">
          {results.length === 0 ? (
            <>
              <h2>Results (0)</h2>
              <div className="lookup-empty">
                <p>No opportunities found matching your search.</p>
              </div>
            </>
          ) : results.length === 1 ? (
            <>
              <h2 className="lookup-opportunity-name">{results[0].name || 'Opportunity'}</h2>
              <div className="lookup-single-result">
                <div className="lookup-detail-card">
                  <OpportunityDetailsCard opportunity={results[0]} />
                </div>
              </div>
            </>
          ) : selectedOpportunity ? (
            <>
              <div className="lookup-results-header">
                <h2 className="lookup-opportunity-name">
                  {selectedOpportunity.name || 'Selected Opportunity'}
                </h2>
                <button
                  className="lookup-back-button"
                  onClick={() => setSelectedOpportunity(null)}
                >
                  ← Back to Results
                </button>
              </div>
              <div className="lookup-single-result">
                <div className="lookup-detail-card">
                  <OpportunityDetailsCard opportunity={selectedOpportunity} />
                </div>
              </div>
            </>
          ) : (
            <>
              <h2>Results ({results.length})</h2>
              <p className="lookup-select-hint">Click on a card to view full details</p>
              <div className="lookup-cards-container">
                {results.map((opportunity) => (
                  <div
                    key={opportunity.id}
                    className="lookup-card"
                    onClick={() => setSelectedOpportunity(opportunity)}
                  >
                    <div className="lookup-card-header">
                      <h3>{opportunity.name || 'N/A'}</h3>
                    </div>
                    <div className="lookup-card-body">
                      <div className="lookup-card-field">
                        <span className="lookup-card-label">Account:</span>
                        <span className="lookup-card-value">{opportunity.accountName || 'N/A'}</span>
                      </div>
                      <div className="lookup-card-field">
                        <span className="lookup-card-label">Stage:</span>
                        <span className="lookup-card-value">{opportunity.stage || 'N/A'}</span>
                      </div>
                      <div className="lookup-card-field">
                        <span className="lookup-card-label">CARR:</span>
                        <span className="lookup-card-value">
                          {formatCurrency(lookupPrimaryRevenue(opportunity))}
                        </span>
                      </div>
                      <div className="lookup-card-field">
                        <span className="lookup-card-label">Close Date:</span>
                        <span className="lookup-card-value">{formatDate(opportunity.closeDate)}</span>
                      </div>
                      <div className="lookup-card-field">
                        <span className="lookup-card-label">Probability:</span>
                        <span className="lookup-card-value">
                          {opportunity.probability !== null ? `${opportunity.probability}%` : 'N/A'}
                        </span>
                      </div>
                      <div className="lookup-card-field">
                        <span className="lookup-card-label">Owner:</span>
                        <span className="lookup-card-value">{opportunity.ownerName || 'N/A'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SalesforceLookup;
