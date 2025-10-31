import React from 'react';

const EmptyState = React.memo(() => {
  return (
    <div className="empty-review-state">
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
            <td colSpan="4" className="empty-message">
              <div className="empty-content">
                <span className="empty-icon">🎯</span>
                <h3>Ready for Analysis!</h3>
                <p>
                  Your CSV is loaded and waiting. Hit that Submit button to start the ratio
                  estimation magic! ✨
                </p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
});

export default EmptyState;
