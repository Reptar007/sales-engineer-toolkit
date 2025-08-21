import React, { useEffect, useState, useCallback } from 'react';
import './styles/App.less';
import './styles/themes.less';
import RejectModal from './RejectModal';
import Header from './components/Header';
import FileUpload from './components/FileUpload';
import ReviewSection from './components/ReviewSection';
import ErrorBoundary from './components/ErrorBoundary';
import { useTheme } from './hooks/useTheme';
import { useFileUpload } from './hooks/useFileUpload';
import { useReviewData } from './hooks/useReviewData';
import { usePagination } from './hooks/usePagination';
import { generateMockData } from './utils/mockDataGenerator';
import { setupTooltipListeners } from './utils/tooltipPositioning';

function App() {
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [pendingReject, setPendingReject] = useState(null);

  // Custom hooks for state management
  const { theme, artistMode, toggleTheme, toggleArtistMode } = useTheme();
  const { selectedFile, errorMessage, isLoading, setIsLoading, handleFileChange, isCsvByName } =
    useFileUpload();
  const {
    reviewData,
    setReviewData,
    filteredData,
    searchTerm,
    statusFilter,
    showReview,
    setShowReview,
    showReviewData,
    setShowReviewData,
    statusCounts,
    handleSearch,
    handleStatusFilter,
    handleApprove,
    updateItemStatus,
    resetReviewData,
    resetDataOnly,
  } = useReviewData();
  const {
    currentPage,
    totalPages,
    currentItems,
    shouldUsePagination,
    shouldUseScrollableContainer,
    resetPage,
    handlePageChange,
  } = usePagination(filteredData);

  // Sample prompt data
  const prompt = "This is the current prompt we're using to generate the test ratio estimation:";

  // Memoized event handlers to prevent unnecessary re-renders
  const openRejectModal = useCallback((row) => {
    setPendingReject(row);
    setRejectModalOpen(true);
  }, []);

  const closeRejectModal = useCallback(() => {
    setRejectModalOpen(false);
    setPendingReject(null);
  }, []);

  const confirmReject = useCallback(
    (rejectionReason) => {
      if (pendingReject && rejectionReason) {
        updateItemStatus(pendingReject.id, 'rejected', rejectionReason);
        // TODO: Send reject status and reason to backend API
      }
      closeRejectModal();
    },
    [pendingReject, updateItemStatus, closeRejectModal],
  );

  // Handle modal body overflow
  useEffect(() => {
    if (rejectModalOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [rejectModalOpen]);

  // Setup tooltip positioning when review data changes
  useEffect(() => {
    if (reviewData.length > 0) {
      return setupTooltipListeners();
    }
  }, [reviewData]);

  // Enhanced file change handler that integrates with custom hooks
  const handleFileChangeWithReset = useCallback(
    (event) => {
      handleFileChange(event);

      const file = event?.target?.files?.[0];
      if (!file) {
        resetReviewData();
        resetPage();
        return;
      }
      if (!isCsvByName(file)) {
        resetReviewData();
        resetPage();
        return;
      }

      // Reset only data and search, then show review section with fun message
      resetDataOnly();
      resetPage();
      setShowReview(true);
      setShowReviewData(false);
    },
    [
      handleFileChange,
      resetReviewData,
      resetDataOnly,
      resetPage,
      isCsvByName,
      setShowReview,
      setShowReviewData,
    ],
  );

  // Enhanced submit handler
  const handleSubmit = useCallback(
    (event) => {
      event?.preventDefault?.();

      if (!selectedFile) {
        // Error handling is managed by useFileUpload hook
        setShowReview(false);
        setShowReviewData(false);
        return;
      }
      if (!isCsvByName(selectedFile)) {
        // Error handling is managed by useFileUpload hook
        setShowReview(false);
        setShowReviewData(false);
        return;
      }

      setShowReview(true);
      setIsLoading(true);
      setShowReviewData(false);

      // Simulate API call with 5-second delay
      setTimeout(() => {
        const mockData = generateMockData();
        setReviewData(mockData);
        setIsLoading(false);
        setShowReviewData(true);
      }, 5000);
    },
    [selectedFile, isCsvByName, setShowReview, setIsLoading, setShowReviewData, setReviewData],
  );

  return (
    <ErrorBoundary>
      <div className="app">
        <Header
          theme={theme}
          toggleTheme={toggleTheme}
          artistMode={artistMode}
          toggleArtistMode={toggleArtistMode}
        />

        <main>
          {/* Current Prompt Section */}
          <section className="section">
            <h2 className="section-title">Current Prompt</h2>
            <p className="prompt-text">{prompt}</p>
          </section>

          <FileUpload
            selectedFile={selectedFile}
            errorMessage={errorMessage}
            isLoading={isLoading}
            onFileChange={handleFileChangeWithReset}
            onSubmit={handleSubmit}
          />

          <ReviewSection
            showReview={showReview}
            isLoading={isLoading}
            showReviewData={showReviewData}
            searchTerm={searchTerm}
            onSearch={handleSearch}
            filteredData={filteredData}
            statusCounts={statusCounts}
            statusFilter={statusFilter}
            onStatusFilter={handleStatusFilter}
            shouldUsePagination={shouldUsePagination}
            shouldUseScrollableContainer={shouldUseScrollableContainer}
            currentPage={currentPage}
            totalPages={totalPages}
            currentItems={currentItems}
            onPageChange={handlePageChange}
            onApprove={handleApprove}
            onReject={openRejectModal}
          />
        </main>

        <footer>
          <p>Footer</p>
        </footer>

        {rejectModalOpen && (
          <RejectModal row={pendingReject} onClose={closeRejectModal} onConfirm={confirmReject} />
        )}
      </div>
    </ErrorBoundary>
  );
}

export default App;
