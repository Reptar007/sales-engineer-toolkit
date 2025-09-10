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
import { parseCSVFile } from './utils/csvParser';
import { setupTooltipListeners } from './utils/tooltipPositioning';
import { processCSVWithChatGPT, fixRejections } from './services/api';

function App() {
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [pendingReject, setPendingReject] = useState(null);

  // Custom hooks for state management
  const { theme, artistMode, toggleTheme, toggleArtistMode } = useTheme();
  const {
    selectedFile,
    errorMessage,
    isLoading,
    setIsLoading,
    handleFileChange,
    isCsvByName,
    setErrorMessage,
  } = useFileUpload();
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
    async (rejectionReason, estimatedRatio) => {
      if (pendingReject && rejectionReason) {
        updateItemStatus(pendingReject.id, 'rejected', rejectionReason, estimatedRatio);

        try {
          // Send rejection info to backend - for now just log it
          // The backend doesn't have a specific rejection tracking endpoint yet
          console.log('Item rejected:', {
            id: pendingReject.id,
            rejectionReason,
            estimatedRatio,
            originalItem: pendingReject,
          });
          // TODO: Implement specific rejection tracking endpoint on backend if needed
        } catch (error) {
          console.error('Failed to send rejection to backend:', error);
        }
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

  // Resubmit all rejected tests handler
  const handleResubmitRejected = useCallback(async () => {
    const rejectedTests = reviewData.filter((item) => item.status === 'rejected');

    if (rejectedTests.length === 0) {
      console.log('No rejected tests to resubmit');
      return;
    }

    try {
      console.log(`Sending ${rejectedTests.length} rejected tests to ChatGPT for re-processing...`);
      
      // Send rejected items to backend for AI-powered fixes
      const response = await fixRejections(rejectedTests);
      
      if (response.csv) {
        // Parse the updated CSV from ChatGPT
        const csvBlob = new Blob([response.csv], { type: 'text/csv' });
        const csvFile = new File([csvBlob], 'reprocessed.csv', { type: 'text/csv' });
        const updatedData = await parseCSVFile(csvFile);
        
        // Create a map of the updated estimates by test name
        const updatedMap = new Map();
        updatedData.forEach(item => {
          updatedMap.set(item.testName.toLowerCase().trim(), item);
        });
        
        // Update the rejected tests with new estimates from ChatGPT
        setReviewData((prevData) =>
          prevData.map((item) => {
            if (item.status === 'rejected') {
              const updated = updatedMap.get(item.testName.toLowerCase().trim());
              if (updated) {
                return {
                  ...item,
                  status: 'pending', // Reset to pending for re-review
                  ratio: updated.ratio,
                  reasoning: updated.reasoning,
                  rejectionReason: undefined, // Clear rejection reason
                  estimatedRatio: undefined, // Clear estimated ratio
                };
              }
              // If no update found, just reset to pending
              return { ...item, status: 'pending', rejectionReason: undefined };
            }
            return item;
          }),
        );
        
        console.log('Successfully updated rejected tests with ChatGPT estimates:', response);
      } else {
        // Fallback: just reset to pending if no CSV returned
        setReviewData((prevData) =>
          prevData.map((item) =>
            item.status === 'rejected'
              ? { ...item, status: 'pending', rejectionReason: undefined }
              : item,
          ),
        );
      }
    } catch (error) {
      console.error('Failed to resubmit rejected tests:', error);
      // Still reset locally even if backend call fails
      setReviewData((prevData) =>
        prevData.map((item) =>
          item.status === 'rejected'
            ? { ...item, status: 'pending', rejectionReason: undefined }
            : item,
        ),
      );
    }
  }, [reviewData, setReviewData]);

  // Download approved tests as CSV estimate
  const handleDownloadEstimate = useCallback(() => {
    const approvedTests = reviewData.filter((item) => item.status === 'approved');

    if (approvedTests.length === 0) {
      console.warn('No approved tests to download');
      return;
    }

    // Generate CSV content
    const csvHeaders = ['Test Name', 'Ratio', 'Reasoning'];
    const csvRows = approvedTests.map((test) => [
      `"${test.testName.replace(/"/g, '""')}"`, // Escape quotes in CSV
      test.ratio,
      `"${test.reasoning.replace(/"/g, '""')}"`, // Escape quotes in CSV
    ]);

    const csvContent = [csvHeaders.join(','), ...csvRows.map((row) => row.join(','))].join('\n');

    // Create and download the file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `test-estimates-${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log(`Downloaded CSV with ${approvedTests.length} approved test estimates`);
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
    async (event) => {
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

      try {
        // Send CSV file to backend for processing with ChatGPT
        console.log('Sending CSV file to backend for ChatGPT processing...');
        const response = await processCSVWithChatGPT(selectedFile);

        // The backend returns artifacts with csv and reasoning
        // We need to parse the CSV from the response
        let csvData;
        if (response.csv) {
          // Parse the CSV content returned from ChatGPT (which now has ratios)
          const csvBlob = new Blob([response.csv], { type: 'text/csv' });
          const csvFile = new File([csvBlob], 'processed.csv', { type: 'text/csv' });
          csvData = await parseCSVFile(csvFile);
        } else {
          throw new Error('No CSV data returned from backend');
        }

        setReviewData(csvData);
        setIsLoading(false);
        setShowReviewData(true);
        setErrorMessage(''); // Clear any previous errors
        console.log('Successfully processed CSV with ChatGPT', csvData);
      } catch (error) {
        console.error('Backend processing failed:', error);
        setIsLoading(false);
        setShowReview(false);
        setShowReviewData(false);
        setErrorMessage(`Failed to process CSV file: ${error.message}`);
      }
    },
    [
      selectedFile,
      isCsvByName,
      setShowReview,
      setIsLoading,
      setShowReviewData,
      setReviewData,
      setErrorMessage,
    ],
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
            onResubmitRejected={handleResubmitRejected}
            onDownloadEstimate={handleDownloadEstimate}
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
