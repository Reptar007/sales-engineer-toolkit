import { useEffect, useState } from 'react';
import './App.css';
import RejectModal from './RejectModal';

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [pendingReject, setPendingReject] = useState(null);
  const [showReview, setShowReview] = useState(true);
  const [theme, setTheme] = useState('light');

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

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
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
      return;
    }
    if (!isCsvByName(file)) {
      setErrorMessage('Please upload a .csv file');
      setSelectedFile(null);
      if (event?.target) event.target.value = '';
      setShowReview(false);
      return;
    }
    setErrorMessage('');
    setSelectedFile(file);
    setShowReview(false); // require re-submit for new file
  };

  const handleSubmit = (event) => {
    event?.preventDefault?.();

    if (!selectedFile) {
      setErrorMessage('Please select a .csv file before submitting');
      setShowReview(false);
      return;
    }
    if (!isCsvByName(selectedFile)) {
      setErrorMessage('Only .csv files are allowed');
      setShowReview(false);
      return;
    }

    setErrorMessage('');
    setShowReview(true); // ✅ reveal Review Section
  };

  return (
    <div className="app">
      <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
        {theme === 'light' ? '🌙' : '☀️'}
      </button>

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

              <button type="submit" className="btn primary" disabled={!selectedFile}>
                Submit
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
            <table className="review-table">
              <thead>
                <tr>
                  <th>Test Name</th>
                  <th>Test Ratio</th>
                  <th>Test Reasoning</th>
                  <th>Test Approval</th>
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
                      className="btn reject"
                      onClick={() => openRejectModal({ name: 'Test 1' })}
                      aria-label="Reject Test 1"
                      title="Reject"
                    >
                      ✕
                    </button>
                    <button
                      type="button"
                      className="btn approve"
                      aria-label="Approve Test 1"
                      title="Approve"
                    >
                      ✓
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
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
