import React from 'react';

const PaginationControls = React.memo(({ currentPage, totalPages, onPageChange }) => {
  const handlePrevious = () => {
    onPageChange(Math.max(currentPage - 1, 1));
  };

  const handleNext = () => {
    onPageChange(Math.min(currentPage + 1, totalPages));
  };

  if (totalPages <= 1) return null;

  return (
    <div className="pagination">
      <button
        className="btn pagination-btn"
        onClick={handlePrevious}
        disabled={currentPage === 1}
        aria-label="Previous page"
      >
        ← Previous
      </button>

      <div className="page-numbers">
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          const pageNum = currentPage <= 3 ? i + 1 : currentPage - 2 + i;
          if (pageNum > totalPages) return null;
          return (
            <button
              key={pageNum}
              className={`btn pagination-number ${pageNum === currentPage ? 'active' : ''}`}
              onClick={() => onPageChange(pageNum)}
              aria-label={`Go to page ${pageNum}`}
            >
              {pageNum}
            </button>
          );
        })}
      </div>

      <button
        className="btn pagination-btn"
        onClick={handleNext}
        disabled={currentPage === totalPages}
        aria-label="Next page"
      >
        Next →
      </button>
    </div>
  );
});

export default PaginationControls;
