import { useState } from 'react';
import { fetchWorkflowFromUrl, generateSummary } from '../services/api.js';
import '../../salesforce/lookup/SalesforceLookup.css';

export default function WorkflowForm() {
  const [qawolfUrl, setQawolfUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [workflowData, setWorkflowData] = useState(null);
  const [includedSteps, setIncludedSteps] = useState(new Set());
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setWorkflowData(null);
    setIncludedSteps(new Set()); // Reset included steps when fetching new workflow

    try {
      const data = await fetchWorkflowFromUrl(qawolfUrl);
      setWorkflowData(data);
      // Default all utility steps to included
      const utilityStepIndices = new Set(
        data.steps
          .map((step, index) => (step.utility ? index : null))
          .filter((index) => index !== null)
      );
      setIncludedSteps(utilityStepIndices);
    } catch (err) {
      setError(err.message || 'Failed to fetch workflow');
    } finally {
      setLoading(false);
    }
  };


  const handleToggleStep = (index) => {
    setIncludedSteps((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const handleGetSummary = async () => {
    if (!workflowData) return;

    setSummaryLoading(true);
    setSummaryError(null);
    setSummary(null);

    try {
      // Collect code from all non-utility steps (always included)
      // and utility steps only if checkbox is checked
      const codeToInclude = workflowData.steps
        .filter((step, index) => {
          // Include if it's not a utility, or if it's a utility and checkbox is checked
          return !step.utility || includedSteps.has(index);
        })
        .map((step) => step.code)
        .join('\n\n// ============================================\n\n');

      // Call the summary endpoint
      const result = await generateSummary(workflowData.flowName, codeToInclude);
      setSummary(result.summary);
    } catch (err) {
      setSummaryError(err.message || 'Failed to generate summary');
    } finally {
      setSummaryLoading(false);
    }
  };

  return (
    <>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2.75rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: '#333333' }}>
          PDF Generator
        </h1>
        <p style={{ fontSize: '1.1rem', fontWeight: 400, color: '#666666', margin: 0 }}>
          Fetch flow from QA Wolf URL
        </p>
      </div>

      <form onSubmit={handleSubmit} className="lookup-search-form" noValidate>
        <div className="lookup-search-container">
          <input
            id="qawolfUrl"
            type="text"
            className="lookup-search-input"
            value={qawolfUrl}
            onChange={(e) => setQawolfUrl(e.target.value)}
            placeholder="Enter QA Wolf flow URL..."
            disabled={loading}
            required
          />
          <button 
            type="submit" 
            className="lookup-search-button"
            disabled={loading || !qawolfUrl.trim()}
          >
            {loading ? 'Loading...' : 'Fetch Flow'}
          </button>
        </div>

        {error && (
          <div role="alert" className="error" style={{ marginTop: '1rem' }}>
            {error}
          </div>
        )}
      </form>

      {workflowData && (
        <>
          <div style={{ 
            marginBottom: '2rem', 
            paddingBottom: '1.5rem', 
            borderBottom: '1px solid #e0e0e0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem'
          }}>
            <h2 style={{ 
              fontSize: '1.75rem', 
              fontWeight: 600, 
              margin: 0, 
              color: '#333333',
              lineHeight: '1.4',
              flex: 1
            }}>
              Flow: {workflowData.flowName || 'Unknown'}
            </h2>
            {summary && !summaryError && (
              <button
                className="lookup-search-button"
                style={{ 
                  flexShrink: 0,
                  padding: '0.5rem 1rem',
                  fontSize: '0.875rem',
                  minHeight: 'auto',
                  height: 'auto'
                }}
              >
                Get PDF
              </button>
            )}
          </div>
          
          <div style={{ 
            display: 'flex', 
            gap: '2rem', 
            alignItems: 'flex-start' 
          }}>
            {/* Tests Section - Left Side */}
            <section className="section" style={{ flex: '1 1 50%', minWidth: 0 }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'flex-start', 
                justifyContent: 'space-between', 
                marginBottom: '1.5rem',
                gap: '1rem'
              }}>
                <div style={{ flex: 1 }}>
                  <h2 className="section-title" style={{ marginBottom: '0.5rem' }}>Tests</h2>
                  <p style={{ margin: 0, color: '#666666', fontSize: '0.875rem' }}>
                    Total Tests: {workflowData.totalSteps}
                  </p>
                </div>
                <button
                  onClick={handleGetSummary}
                  className="lookup-search-button"
                  disabled={summaryLoading}
                  style={{ 
                    flexShrink: 0,
                    alignSelf: 'flex-start',
                    padding: '0.5rem 1rem',
                    fontSize: '0.875rem',
                    minHeight: 'auto',
                    height: 'auto'
                  }}
                >
                  {summaryLoading ? 'Generating...' : 'Get Summary'}
                </button>
              </div>
            
            {workflowData.steps.map((step, index) => (
            <div 
              key={index} 
              style={{ 
                marginBottom: '1.5rem', 
                padding: '1.5rem', 
                border: '1px solid var(--soft-gray)', 
                borderRadius: 'var(--radius-lg)',
                backgroundColor: '#ffffff',
                boxShadow: '0 0.125rem 0.5rem rgba(0, 0, 0, 0.08)',
                transition: 'all 0.2s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: step.utility ? 'space-between' : 'flex-start', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                  <strong style={{ fontSize: '1.125rem', color: '#333333' }}>{step.name}</strong>
                  {step.utility && (
                    <span style={{ 
                      padding: '0.25rem 0.75rem', 
                      background: '#e3f2fd', 
                      color: '#1976d2',
                      borderRadius: 'var(--radius-pill)', 
                      fontSize: '0.75rem',
                      fontWeight: 500
                    }}>
                      Utility
                    </span>
                  )}
                </div>
                {step.utility && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginLeft: '1rem' }}>
                    <input
                      type="checkbox"
                      checked={includedSteps.has(index)}
                      onChange={() => handleToggleStep(index)}
                      style={{ 
                        width: '1.125rem', 
                        height: '1.125rem', 
                        cursor: 'pointer',
                        accentColor: '#2e7d32'
                      }}
                    />
                    <span style={{ fontSize: '0.875rem', color: '#666666', fontWeight: 500 }}>Include in summary</span>
                  </label>
                )}
              </div>
              <details>
                <summary style={{ 
                  cursor: 'pointer', 
                  marginBottom: '0.5rem',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: '#f5f5f5',
                  fontWeight: 500,
                  color: '#333333',
                  transition: 'background-color 0.2s ease',
                  listStyle: 'none'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#eeeeee'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                >
                  View Code
                </summary>
                <pre style={{ 
                  background: '#1e1e1e', 
                  color: '#d4d4d4',
                  padding: '1.25rem', 
                  overflow: 'auto', 
                  maxHeight: '400px', 
                  borderRadius: 'var(--radius-sm)', 
                  fontSize: '0.875rem',
                  lineHeight: '1.6',
                  marginTop: '0.5rem',
                  border: '1px solid #3e3e3e',
                  fontFamily: 'Monaco, "Courier New", monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>
                  <code style={{ color: 'inherit', fontFamily: 'inherit' }}>
                    {step.code}
                  </code>
                </pre>
              </details>
            </div>
          ))}
            </section>

            {/* Summary Section - Right Side */}
            <section className="section" style={{ 
              flex: '1 1 50%', 
              minWidth: 0,
              position: 'sticky',
              top: '1rem',
              alignSelf: 'flex-start',
              maxHeight: 'calc(100vh - 2rem)',
              overflowY: 'auto'
            }}>
              <h2 className="section-title" style={{ marginBottom: '1rem' }}>Summary</h2>
              
              {summaryLoading && (
                <div style={{ 
                  padding: '1.5rem', 
                  textAlign: 'center', 
                  color: '#666666' 
                }}>
                  Generating summary...
                </div>
              )}

              {summaryError && (
                <div role="alert" className="error" style={{ marginBottom: '1rem' }}>
                  {summaryError}
                </div>
              )}

              {summary && (
                <div style={{
                  padding: '1.5rem',
                  border: '1px solid #e0e0e0',
                  borderRadius: 'var(--radius-lg)',
                  backgroundColor: '#ffffff',
                  boxShadow: '0 0.125rem 0.5rem rgba(0, 0, 0, 0.08)',
                }}>
                  <div style={{
                    whiteSpace: 'pre-wrap',
                    lineHeight: '1.6',
                    color: '#333333',
                    fontSize: '0.9375rem'
                  }}>
                    {summary}
                  </div>
                </div>
              )}

              {!summary && !summaryLoading && !summaryError && (
                <div style={{ 
                  padding: '1.5rem', 
                  textAlign: 'center', 
                  color: '#999999',
                  fontStyle: 'italic'
                }}>
                  Click "Get Summary" to generate a summary of the selected tests.
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

