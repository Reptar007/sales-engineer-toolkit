import React from 'react';

const ReviewStats = React.memo(
  ({
    filteredDataLength,
    searchTerm,
    statusCounts,
    shouldUsePagination,
    currentPage,
    totalPages,
    statusFilter,
    onStatusFilter,
    onResubmitRejected,
  }) => {
    return (
      <div className="review-stats">
        <div className="results-info">
          <span className="results-count">
            {filteredDataLength} {filteredDataLength === 1 ? 'test' : 'tests'}
            {statusFilter !== 'all' ? ` (${statusFilter})` : ''} found
            {searchTerm && ` for "${searchTerm}"`}
          </span>
          <div className="status-counts">
            <button
              className={`status-badge pending ${statusFilter === 'pending' ? 'active' : ''}`}
              onClick={() => onStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
              type="button"
            >
              {statusCounts.pending} pending
            </button>
            <button
              className={`status-badge approved ${statusFilter === 'approved' ? 'active' : ''}`}
              onClick={() => onStatusFilter(statusFilter === 'approved' ? 'all' : 'approved')}
              type="button"
            >
              {statusCounts.approved} approved
            </button>
            <button
              className={`status-badge rejected ${statusFilter === 'rejected' ? 'active' : ''}`}
              onClick={() => onStatusFilter(statusFilter === 'rejected' ? 'all' : 'rejected')}
              type="button"
            >
              {statusCounts.rejected} rejected
            </button>
          </div>
        </div>
        <div className="review-actions">
          {statusCounts.pending === 0 && statusCounts.rejected > 0 && (
            <button
              type="button"
              className="btn resubmit-rejected"
              onClick={onResubmitRejected}
              title="Resubmit all rejected tests"
            >
              Resubmit Rejected
            </button>
          )}
          {shouldUsePagination && (
            <span className="page-info">
              Page {currentPage} of {totalPages}
            </span>
          )}
        </div>
      </div>
    );
  },
);

export default ReviewStats;
