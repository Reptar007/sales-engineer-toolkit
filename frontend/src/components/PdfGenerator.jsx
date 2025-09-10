import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { useGetWorkflowQuery } from '../services/pdf';

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

      // Call the workflow query with the properly structured input
      const data = await useGetWorkflowQuery({
        environmentId,
        workflowId,
        inputObj // Pass the complete input object to backend
      });

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
              {loading ? 'Loading...' : 'Generate PDF'}
            </button>
          </div>
        </form>

        {error && (
          <div className="error-message">
            <p>Error: {error}</p>
          </div>
        )}

        {workflowData && (
          <div className="workflow-data">
            <h3>Workflow Data Retrieved</h3>
            <pre>{JSON.stringify(workflowData, null, 2)}</pre>
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
