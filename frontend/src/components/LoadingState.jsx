import React from 'react';

const LoadingState = React.memo(() => {
  return (
    <div className="loading-state">
      <table className="review-table">
        <thead>
          <tr>
            <th>Test Name</th>
            <th>Ratio</th>
            <th>Reasoning</th>
            <th>Approval</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan="4" className="loading-message">
              <div className="loading-content">
                <div className="loading-spinner">
                  <span className="spinner-icon">⚡</span>
                  <span className="spinner-icon">🔍</span>
                  <span className="spinner-icon">📊</span>
                </div>
                <h3>Crunching Numbers!</h3>
                <p>
                  Our AI is analyzing your data and calculating ratios...
                  <br />
                  <span className="loading-subtext">This might take a moment ⏳</span>
                </p>
                <div className="loading-bar">
                  <div className="loading-progress"></div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
});

export default LoadingState;
