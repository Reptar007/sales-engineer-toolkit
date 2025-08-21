import React from 'react';
import LoadingState from './LoadingState';
import EmptyState from './EmptyState';
import SearchBar from './SearchBar';
import ReviewStats from './ReviewStats';
import ReviewTable from './ReviewTable';
import PaginationControls from './PaginationControls';

const ReviewSection = React.memo(
  ({
    showReview,
    isLoading,
    showReviewData,
    searchTerm,
    onSearch,
    filteredData,
    statusCounts,
    shouldUsePagination,
    shouldUseScrollableContainer,
    currentPage,
    totalPages,
    currentItems,
    onPageChange,
    onApprove,
    onReject,
  }) => {
    if (!showReview) return null;

    return (
      <section className="section">
        <h2 className="section-title">Review Section</h2>

        {isLoading ? (
          <LoadingState />
        ) : showReviewData ? (
          <>
            <div className="review-header">
              <SearchBar searchTerm={searchTerm} onSearch={onSearch} />
              <ReviewStats
                filteredDataLength={filteredData.length}
                searchTerm={searchTerm}
                statusCounts={statusCounts}
                shouldUsePagination={shouldUsePagination}
                currentPage={currentPage}
                totalPages={totalPages}
              />
            </div>

            <ReviewTable
              data={shouldUsePagination ? currentItems : filteredData}
              shouldUseScrollableContainer={shouldUseScrollableContainer}
              onApprove={onApprove}
              onReject={onReject}
            />

            {shouldUsePagination && (
              <PaginationControls
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={onPageChange}
              />
            )}
          </>
        ) : (
          <EmptyState />
        )}
      </section>
    );
  },
);

export default ReviewSection;
