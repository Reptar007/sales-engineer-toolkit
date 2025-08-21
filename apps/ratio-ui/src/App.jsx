import { useEffect, useState } from 'react';
import './App.css';
import RejectModal from './RejectModal';

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [pendingReject, setPendingReject] = useState(null);
  const [showReview, setShowReview] = useState(false);
  const [showReviewData, setShowReviewData] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [theme, setTheme] = useState('light');
  const [artistMode, setArtistMode] = useState(false);

  // Review data and pagination state
  const [reviewData, setReviewData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(25);

  // Sample prompt data
  const prompt = "This is the current prompt we're using to generate the test ratio estimation:";

  function openRejectModal(row) {
    setPendingReject(row); // e.g., { name: 'Test 1', id: ... }
    setRejectModalOpen(true);
  }

  function closeRejectModal() {
    setRejectModalOpen(false);
    setPendingReject(null);
  }

  useEffect(() => {
    if (rejectModalOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [rejectModalOpen]);

  // Theme management
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Artist mode management
  useEffect(() => {
    if (artistMode) {
      document.documentElement.setAttribute('data-artist', 'true');
    } else {
      document.documentElement.removeAttribute('data-artist');
    }
  }, [artistMode]);

  // Smart tooltip positioning to prevent cutoff
  useEffect(() => {
    const handleTooltipPositioning = (indicator) => {
      const tooltip = indicator.querySelector('.tooltip');
      if (!tooltip) return;

      // Reset positioning classes
      tooltip.classList.remove('tooltip-left-adjusted', 'tooltip-right-adjusted');

      // Force a reflow to get accurate measurements
      tooltip.offsetHeight;

      // Get positions after reset
      const indicatorRect = indicator.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const margin = 16; // Margin from viewport edge

      // Calculate if tooltip would extend beyond edges
      const tooltipWidth = tooltip.offsetWidth;
      const indicatorCenter = indicatorRect.left + indicatorRect.width / 2;
      const tooltipLeftEdge = indicatorCenter - tooltipWidth / 2;
      const tooltipRightEdge = indicatorCenter + tooltipWidth / 2;

      // Check positioning and apply classes
      if (tooltipLeftEdge < margin) {
        tooltip.classList.add('tooltip-left-adjusted');
      } else if (tooltipRightEdge > viewportWidth - margin) {
        tooltip.classList.add('tooltip-right-adjusted');
      }
    };

    // Store event handlers for cleanup
    const eventHandlers = new Map();

    // Add event listeners with improved positioning logic
    const rejectionIndicators = document.querySelectorAll('.rejection-indicator');

    rejectionIndicators.forEach((indicator) => {
      const handleMouseEnter = () => {
        // Multiple attempts to ensure proper positioning
        setTimeout(() => handleTooltipPositioning(indicator), 1);
        setTimeout(() => handleTooltipPositioning(indicator), 50);
        setTimeout(() => handleTooltipPositioning(indicator), 100);
      };

      const handleMouseLeave = () => {
        const tooltip = indicator.querySelector('.tooltip');
        if (tooltip) {
          // Reset positioning when tooltip disappears
          tooltip.classList.remove('tooltip-left-adjusted', 'tooltip-right-adjusted');
        }
      };

      eventHandlers.set(indicator, { handleMouseEnter, handleMouseLeave });
      indicator.addEventListener('mouseenter', handleMouseEnter);
      indicator.addEventListener('mouseleave', handleMouseLeave);
      indicator.addEventListener('focus', handleMouseEnter);
      indicator.addEventListener('blur', handleMouseLeave);
    });

    // Also handle window resize
    const handleResize = () => {
      rejectionIndicators.forEach((indicator) => {
        if (indicator.matches(':hover') || indicator.matches(':focus')) {
          handleTooltipPositioning(indicator);
        }
      });
    };

    window.addEventListener('resize', handleResize);

    // Cleanup event listeners
    return () => {
      window.removeEventListener('resize', handleResize);
      rejectionIndicators.forEach((indicator) => {
        const handlers = eventHandlers.get(indicator);
        if (handlers) {
          indicator.removeEventListener('mouseenter', handlers.handleMouseEnter);
          indicator.removeEventListener('mouseleave', handlers.handleMouseLeave);
          indicator.removeEventListener('focus', handlers.handleMouseEnter);
          indicator.removeEventListener('blur', handlers.handleMouseLeave);
        }
      });
    };
  }, [reviewData]); // Re-run when review data changes

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const toggleArtistMode = () => {
    setArtistMode((prev) => !prev);
  };

  function confirmReject(rejectionReason) {
    if (pendingReject && rejectionReason) {
      // Update the item status to rejected with reason
      setReviewData((prevData) =>
        prevData.map((item) =>
          item.id === pendingReject.id
            ? { ...item, status: 'rejected', rejectionReason: rejectionReason }
            : item,
        ),
      );
      // TODO: Send reject status and reason to backend API
      // console.log('Rejected:', pendingReject, 'Reason:', rejectionReason)
    }
    closeRejectModal();
  }

  function handleApprove(item) {
    // Update the item status to approved
    setReviewData((prevData) =>
      prevData.map((dataItem) =>
        dataItem.id === item.id ? { ...dataItem, status: 'approved' } : dataItem,
      ),
    );
    // TODO: Send approve status to backend API
    // console.log('Approved:', item)
  }

  const isCsvByName = (file) => {
    if (!file || !file.name) return false;
    return /\.csv$/i.test(file.name);
  };

  const handleFileChange = (event) => {
    const file = event?.target?.files?.[0];
    if (!file) {
      setSelectedFile(null);
      setShowReview(false);
      setShowReviewData(false);
      setIsLoading(false);
      setReviewData([]);
      setSearchTerm('');
      setCurrentPage(1);
      return;
    }
    if (!isCsvByName(file)) {
      setErrorMessage('Please upload a .csv file');
      setSelectedFile(null);
      if (event?.target) event.target.value = '';
      setShowReview(false);
      setShowReviewData(false);
      setIsLoading(false);
      setReviewData([]);
      setSearchTerm('');
      setCurrentPage(1);
      return;
    }
    setErrorMessage('');
    setSelectedFile(file);
    setShowReview(true); // ✅ show Review Section immediately
    setShowReviewData(false); // but don't show data until submit
    setIsLoading(false); // reset loading state
    setReviewData([]); // clear previous data
    setSearchTerm(''); // reset search
    setCurrentPage(1); // reset pagination
  };

  // Generate mock data based on file size (simulate API response)
  const generateMockData = () => {
    // Simulate variable data sizes based on random selection
    const sizes = [20, 50, 100, 200];
    const randomSize = sizes[Math.floor(Math.random() * sizes.length)];

    // Sample rejection reasons to demonstrate dynamic tooltip sizing
    const sampleRejections = [
      "Test coverage is insufficient and doesn't meet our quality standards",
      'This test case duplicates existing functionality and should be merged',
      'The test logic is flawed and produces false positives in edge cases',
      'Performance impact is too high for the value provided by this test',
      'Test dependencies are unclear and may cause maintenance issues down the line',
      "The assertions are too broad and don't validate specific behavior effectively",
      "This test requires external resources that aren't available in our CI environment",
    ];

    const mockData = [];
    for (let i = 1; i <= randomSize; i++) {
      const shouldReject = Math.random() < 0.15; // 15% chance of rejection
      const item = {
        id: i,
        testName: `Test ${i}`,
        ratio: `${Math.floor(Math.random() * 10) + 1}:${Math.floor(Math.random() * 10) + 1}`,
        reasoning: `Analysis for test ${i}: ${['High priority test case', 'Standard validation', 'Edge case scenario', 'Critical path test', 'Performance validation'][Math.floor(Math.random() * 5)]}`,
        status: shouldReject ? 'rejected' : 'pending',
      };

      // Add rejection reason for rejected items
      if (shouldReject) {
        item.rejectionReason =
          sampleRejections[Math.floor(Math.random() * sampleRejections.length)];
      }

      mockData.push(item);
    }
    return mockData;
  };

  // Search and filter logic
  useEffect(() => {
    if (!searchTerm) {
      setFilteredData(reviewData);
    } else {
      const filtered = reviewData.filter(
        (item) =>
          item.testName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.reasoning.toLowerCase().includes(searchTerm.toLowerCase()),
      );
      setFilteredData(filtered);
    }
    setCurrentPage(1); // Reset to first page when filtering
  }, [reviewData, searchTerm]);

  // Handle search input
  const handleSearch = (event) => {
    setSearchTerm(event.target.value);
  };

  // Pagination calculations
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentItems = filteredData.slice(startIndex, endIndex);

  // Status counts for progress tracking
  const statusCounts = filteredData.reduce(
    (counts, item) => {
      counts[item.status] = (counts[item.status] || 0) + 1;
      return counts;
    },
    { pending: 0, approved: 0, rejected: 0 },
  );

  // Determine display strategy based on data size
  const shouldUsePagination = filteredData.length > 30;
  const shouldUseScrollableContainer = filteredData.length > 10 && filteredData.length <= 30;

  const handleSubmit = (event) => {
    event?.preventDefault?.();

    if (!selectedFile) {
      setErrorMessage('Please select a .csv file before submitting');
      setShowReview(false);
      setShowReviewData(false);
      return;
    }
    if (!isCsvByName(selectedFile)) {
      setErrorMessage('Only .csv files are allowed');
      setShowReview(false);
      setShowReviewData(false);
      return;
    }

    setErrorMessage('');
    setShowReview(true); // ✅ keep Review Section visible
    setIsLoading(true); // ✅ start loading animation
    setShowReviewData(false); // hide data during loading

    // Show loading for 5 seconds, then reveal data
    setTimeout(() => {
      const mockData = generateMockData();
      setReviewData(mockData);
      setIsLoading(false);
      setShowReviewData(true); // ✅ now show the actual data
    }, 5000);
  };

  return (
    <div className="app">
      <div className="toggle-buttons">
        <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        <button
          className="artist-toggle"
          onClick={toggleArtistMode}
          aria-label="Toggle artist mode"
        >
          {artistMode ? '🐕' : '🎨'}
        </button>
      </div>

      <header>
        <h1>Ratio Estimator</h1>
      </header>

      <main>
        {/* Current Prompt Section */}
        <section className="section">
          <h2 className="section-title">Current Prompt</h2>
          <p className="prompt-text">{prompt}</p>
        </section>

        {/* Upload CSV Section */}
        <section className="section">
          <h2 className="section-title">Upload a .csv file</h2>
          <form
            onSubmit={handleSubmit}
            className="upload-form"
            noValidate
            aria-describedby="upload-hint upload-error"
          >
            {/* Hidden file input for accessibility */}
            <input
              id="file-upload"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              onClick={(e) => {
                e.currentTarget.value = '';
              }}
              className="visually-hidden"
            />

            <div className="file-controls">
              <label htmlFor="file-upload" className="btn file-btn">
                Choose CSV
              </label>

              <span className="file-name" aria-live="polite">
                {selectedFile ? selectedFile.name : 'No file chosen'}
              </span>

              <button type="submit" className="btn primary" disabled={!selectedFile || isLoading}>
                {isLoading ? 'Processing...' : 'Submit'}
              </button>
            </div>

            <small id="upload-hint" className="hint">
              Only .csv files are allowed.
            </small>

            {errorMessage && (
              <div id="upload-error" role="alert" className="error">
                {errorMessage}
              </div>
            )}
          </form>
        </section>

        {/* Review Section */}
        {showReview && (
          <section className="section">
            <h2 className="section-title">Review Section</h2>
            {isLoading ? (
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
            ) : showReviewData ? (
              <>
                <div className="review-header">
                  <div className="search-container">
                    <input
                      type="text"
                      placeholder="Search tests..."
                      className="search-input"
                      aria-label="Search tests"
                      value={searchTerm}
                      onChange={handleSearch}
                    />
                  </div>
                  <div className="review-stats">
                    <div className="results-info">
                      <span className="results-count">
                        {filteredData.length} {filteredData.length === 1 ? 'test' : 'tests'} found
                        {searchTerm && ` for "${searchTerm}"`}
                      </span>
                      <div className="status-counts">
                        <span className="status-badge pending">{statusCounts.pending} pending</span>
                        <span className="status-badge approved">
                          {statusCounts.approved} approved
                        </span>
                        <span className="status-badge rejected">
                          {statusCounts.rejected} rejected
                        </span>
                      </div>
                    </div>
                    {shouldUsePagination && (
                      <span className="page-info">
                        Page {currentPage} of {totalPages}
                      </span>
                    )}
                  </div>
                </div>

                <div
                  className={`table-wrapper ${shouldUseScrollableContainer ? 'scrollable' : ''}`}
                >
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
                      {(shouldUsePagination ? currentItems : filteredData).map((item, index) => (
                        <tr key={item.id} className={`row-${item.status}`}>
                          <td>
                            {item.testName}
                            {item.status === 'rejected' && item.rejectionReason && (
                              <span
                                className={`rejection-indicator ${index < 2 ? 'tooltip-below' : ''}`}
                                aria-label={`Rejection reason: ${item.rejectionReason}`}
                                role="button"
                                tabIndex="0"
                              >
                                💬
                                <span className="tooltip">
                                  <strong>Rejection Reason:</strong>
                                  <br />
                                  {item.rejectionReason}
                                </span>
                              </span>
                            )}
                          </td>
                          <td>{item.ratio}</td>
                          <td>{item.reasoning}</td>
                          <td className="actions">
                            <button
                              type="button"
                              className={`btn circular reject ${item.status === 'rejected' ? 'active' : ''}`}
                              onClick={() => openRejectModal({ name: item.testName, id: item.id })}
                              aria-label={`Reject ${item.testName}`}
                              title={item.status === 'rejected' ? 'Already rejected' : 'Reject'}
                              disabled={item.status === 'approved'}
                            >
                              ✕
                            </button>
                            <button
                              type="button"
                              className={`btn circular approve ${item.status === 'approved' ? 'active' : ''}`}
                              onClick={() => handleApprove(item)}
                              aria-label={`Approve ${item.testName}`}
                              title={item.status === 'approved' ? 'Already approved' : 'Approve'}
                              disabled={item.status === 'rejected'}
                            >
                              ✓
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {shouldUsePagination && totalPages > 1 && (
                  <div className="pagination">
                    <button
                      className="btn pagination-btn"
                      onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
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
                            onClick={() => setCurrentPage(pageNum)}
                            aria-label={`Go to page ${pageNum}`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      className="btn pagination-btn"
                      onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      aria-label="Next page"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            ) : (
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
                            Your CSV is loaded and waiting. Hit that Submit button to start the
                            ratio estimation magic! ✨
                          </p>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>

      <footer>
        <p>Footer</p>
      </footer>

      {rejectModalOpen && (
        <RejectModal row={pendingReject} onClose={closeRejectModal} onConfirm={confirmReject} />
      )}
    </div>
  );
}

export default App;
