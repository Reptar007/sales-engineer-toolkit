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

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const toggleArtistMode = () => {
    setArtistMode((prev) => !prev);
  };

  function confirmReject() {
    // TODO: do whatever you need (e.g., mark row rejected, call API)
    // console.log('Rejected:', pendingReject)
    closeRejectModal();
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
      return;
    }
    if (!isCsvByName(file)) {
      setErrorMessage('Please upload a .csv file');
      setSelectedFile(null);
      if (event?.target) event.target.value = '';
      setShowReview(false);
      setShowReviewData(false);
      setIsLoading(false);
      return;
    }
    setErrorMessage('');
    setSelectedFile(file);
    setShowReview(true); // ✅ show Review Section immediately
    setShowReviewData(false); // but don't show data until submit
    setIsLoading(false); // reset loading state
  };

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
                <div className="search-container">
                  <input
                    type="text"
                    placeholder="Search"
                    className="search-input"
                    aria-label="Search tests"
                  />
                </div>
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
                      <td>Test 1</td>
                      <td>1:1</td>
                      <td>Test reasoning example</td>
                      <td className="actions">
                        <button
                          type="button"
                          className="btn circular reject"
                          onClick={() => openRejectModal({ name: 'Test 1' })}
                          aria-label="Reject Test 1"
                          title="Reject"
                        >
                          ✕
                        </button>
                        <button
                          type="button"
                          className="btn circular approve"
                          aria-label="Approve Test 1"
                          title="Approve"
                        >
                          ✓
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
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
