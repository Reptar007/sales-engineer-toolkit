import React from 'react';

const ReviewStats = React.memo(
  ({
    filteredDataLength,
    searchTerm,
    statusCounts,
    shouldUsePagination,
    currentPage,
    totalPages,
  }) => {
    return (
      <div className="review-stats">
        <div className="results-info">
          <span className="results-count">
            {filteredDataLength} {filteredDataLength === 1 ? 'test' : 'tests'} found
            {searchTerm && ` for "${searchTerm}"`}
          </span>
          <div className="status-counts">
            <span className="status-badge pending">{statusCounts.pending} pending</span>
            <span className="status-badge approved">{statusCounts.approved} approved</span>
            <span className="status-badge rejected">{statusCounts.rejected} rejected</span>
          </div>
        </div>
        {shouldUsePagination && (
          <span className="page-info">
            Page {currentPage} of {totalPages}
          </span>
        )}
      </div>
    );
  },
);

export default ReviewStats;
