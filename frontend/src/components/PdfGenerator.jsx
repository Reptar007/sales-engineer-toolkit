import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { fetchWorkflowData } from '../services/api';

const PdfGenerator = React.memo(() => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [workflowData, setWorkflowData] = useState(null);
  const [error, setError] = useState('');

  const parseUrlAndCreateInput = (pageUrl) => {
    if (!pageUrl) {
      throw new Error('URL is required');
    }

    // 1) Robust regex: /v3/<anything>/environments/<env>/flows/<workflow>
    const match = pageUrl.match(/\/v3\/[^/]+\/environments\/([^/]+)\/flows\/([^/]+)/);
    
    if (!match) {
      throw new Error('Invalid URL format. Expected format: /v3/.../environments/{envId}/flows/{workflowId}');
    }

    const environmentId = match[1];
    const workflowId = match[2];

    // 2) Create the input template structure (based on your Postman script)
    const inputTemplate = {
      json: {
        filter: {
          environmentId: "", // Will be replaced
          workflowId: "",    // Will be replaced
        },
        include: {
          stepsOnBranchInWorkflowOnBranch: {
            stepOnBranch: { 
              step: true 
            }
          }
        }
      }
    };

    // 3) Swap ONLY the IDs
    const inputObj = JSON.parse(JSON.stringify(inputTemplate)); // Deep clone
    inputObj.json.filter.environmentId = environmentId;
    inputObj.json.filter.workflowId = workflowId;

    return { 
      environmentId, 
      workflowId, 
      inputObj // This is the properly structured input object
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setWorkflowData(null);

    try {
      // Parse the URL and create the proper input structure
      const { environmentId, workflowId, inputObj } = parseUrlAndCreateInput(url);

      // Log the parsed data for debugging
      console.log('Parsed from URL:', { environmentId, workflowId });
      console.log('Generated inputObj:', inputObj);

      // Call the workflow API with the properly structured input
      const response = await fetchWorkflowData(environmentId, workflowId, inputObj);
      const data = response.data;

      setWorkflowData(data);
      console.log('Workflow data fetched:', data);
    } catch (err) {
      setError(err.message || 'Failed to fetch workflow data');
      console.error('Error fetching workflow:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSubmit(e);
    }
  };

  return (
    <section className="section">
      <h2 className="section-title">PDF Generator</h2>
      
      <div className="pdf-generator-form">
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <input
              type="text"
              placeholder="Enter QA Wolf workflow URL (e.g., https://app.qawolf.com/v3/.../environments/.../flows/...)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={loading}
              className="url-input"
            />
            <button 
              type="submit" 
              disabled={loading || !url.trim()}
              className="submit-button"
            >
              {loading ? 'Loading...' : 'Search'}
            </button>
          </div>
        </form>

        {error && (
          <div className="error-message">
            <p>Error: {error}</p>
          </div>
        )}

        {workflowData && workflowData.formattedSteps && (
          <div className="workflow-visualizer">
            <h3>Workflow Steps ({workflowData.formattedSteps.length} steps)</h3>
            
            {/* Workflow Table */}
            <div style={{
              fontFamily: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif',
              width: '100%',
              marginTop: '20px'
            }}>
              <table style={{
                borderCollapse: 'collapse',
                width: '100%',
                fontSize: '14px'
              }}>
                <thead>
                  <tr>
                    <th style={{
                      borderBottom: '2px solid #333',
                      padding: '12px 8px',
                      verticalAlign: 'top',
                      backgroundColor: '#f5f5f5',
                      fontWeight: 'bold',
                      textAlign: 'left'
                    }}>Index</th>
                    <th style={{
                      borderBottom: '2px solid #333',
                      padding: '12px 8px',
                      verticalAlign: 'top',
                      backgroundColor: '#f5f5f5',
                      fontWeight: 'bold',
                      textAlign: 'left'
                    }}>Step Name</th>
                    <th style={{
                      borderBottom: '2px solid #333',
                      padding: '12px 8px',
                      verticalAlign: 'top',
                      backgroundColor: '#f5f5f5',
                      fontWeight: 'bold',
                      textAlign: 'left'
                    }}>Step ID</th>
                    <th style={{
                      borderBottom: '2px solid #333',
                      padding: '12px 8px',
                      verticalAlign: 'top',
                      backgroundColor: '#f5f5f5',
                      fontWeight: 'bold',
                      textAlign: 'left'
                    }}>Utility</th>
                    <th style={{
                      borderBottom: '2px solid #333',
                      padding: '12px 8px',
                      verticalAlign: 'top',
                      backgroundColor: '#f5f5f5',
                      fontWeight: 'bold',
                      textAlign: 'left',
                      width: '40%'
                    }}>Code</th>
                  </tr>
                </thead>
                <tbody>
                  {workflowData.formattedSteps.map((row, idx) => (
                    <tr key={row.stepId || idx}>
                      <td style={{
                        borderBottom: '1px solid #ddd',
                        padding: '8px',
                        verticalAlign: 'top'
                      }}>{row.index}</td>
                      <td style={{
                        borderBottom: '1px solid #ddd',
                        padding: '8px',
                        verticalAlign: 'top',
                        fontWeight: '500'
                      }}>{row.name || 'N/A'}</td>
                      <td style={{
                        borderBottom: '1px solid #ddd',
                        padding: '8px',
                        verticalAlign: 'top',
                        fontFamily: 'monospace',
                        fontSize: '12px'
                      }}>{row.stepId || 'N/A'}</td>
                      <td style={{
                        borderBottom: '1px solid #ddd',
                        padding: '8px',
                        verticalAlign: 'top'
                      }}>{row.isUtility ? 'Yes' : 'No'}</td>
                      <td style={{
                        borderBottom: '1px solid #ddd',
                        padding: '8px',
                        verticalAlign: 'top',
                        maxWidth: '400px'
                      }}>
                        {row.code ? (
                          <pre style={{
                            whiteSpace: 'pre-wrap',
                            margin: 0,
                            fontFamily: 'monospace',
                            fontSize: '12px',
                            backgroundColor: '#f8f8f8',
                            padding: '8px',
                            borderRadius: '4px',
                            border: '1px solid #e0e0e0',
                            overflow: 'auto',
                            maxHeight: '300px'
                          }}>{row.code}</pre>
                        ) : (
                          <span style={{ color: '#666', fontStyle: 'italic' }}>No code available</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Debug Section - Collapsible */}
            <details style={{ marginTop: '30px', fontSize: '12px' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#666' }}>
                Raw API Response (for debugging)
              </summary>
              <pre style={{
                fontSize: '11px',
                backgroundColor: '#f5f5f5',
                padding: '15px',
                borderRadius: '4px',
                overflow: 'auto',
                maxHeight: '400px',
                marginTop: '10px',
                border: '1px solid #ddd'
              }}>
                {JSON.stringify(workflowData, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </section>
  );
});

// PdfGenerator.propTypes = {
//   selectedFile: PropTypes.object,
//   errorMessage: PropTypes.string.isRequired,
//   isLoading: PropTypes.bool.isRequired,
//   onFileChange: PropTypes.func.isRequired,
//   onSubmit: PropTypes.func.isRequired,
// };

export default PdfGenerator;
