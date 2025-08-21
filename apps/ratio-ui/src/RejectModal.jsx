import { useEffect, useRef, useState } from 'react';

function RejectModal({ row, onClose, onConfirm }) {
  const dialogRef = useRef(null);
  const reasonInputRef = useRef(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [estimatedRatio, setEstimatedRatio] = useState('');

  // Focus rejection reason input on open
  useEffect(() => {
    reasonInputRef.current?.focus();
  }, []);

  // Close on ESC
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Close on backdrop click
  function onBackdropClick(e) {
    if (e.target === dialogRef.current) onClose();
  }

  // Handle rejection reason change
  function handleReasonChange(e) {
    setRejectionReason(e.target.value);
  }

  // Handle estimated ratio change
  function handleEstimatedRatioChange(e) {
    const value = e.target.value;
    // Allow empty string, numbers, decimal points, and colon notation (e.g., 3:5 or 3.5)
    if (value === '' || /^[\d.:]*$/.test(value)) {
      setEstimatedRatio(value);
    }
  }

  // Handle form submission
  function handleConfirm() {
    if (rejectionReason.trim()) {
      onConfirm(rejectionReason.trim(), estimatedRatio.trim());
    }
  }

  // Handle Enter key in textarea (Ctrl/Cmd + Enter to submit)
  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && rejectionReason.trim()) {
      handleConfirm();
    }
  }

  const isReasonValid = rejectionReason.trim().length >= 3;

  return (
    <div
      ref={dialogRef}
      className="modal-backdrop"
      onMouseDown={onBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-title"
      aria-describedby="reject-description"
    >
      <div className="modal reject-modal">
        <h3 id="reject-title">Reject this test?</h3>
        <p id="reject-description">
          {row?.name ? (
            <>
              Please provide a reason for rejecting <strong>{row.name}</strong>:
            </>
          ) : (
            'Please provide a reason for rejection:'
          )}
        </p>

        <div className="form-group">
          <label htmlFor="rejection-reason" className="form-label">
            Rejection Reason <span className="required">*</span>
          </label>
          <textarea
            ref={reasonInputRef}
            id="rejection-reason"
            className="form-textarea"
            placeholder="Enter reason for rejection (minimum 3 characters)..."
            value={rejectionReason}
            onChange={handleReasonChange}
            onKeyDown={handleKeyDown}
            rows="3"
            required
            aria-describedby="reason-hint"
          />
          <small id="reason-hint" className="form-hint">
            {rejectionReason.length === 0
              ? 'A rejection reason is required'
              : rejectionReason.length < 3
                ? `${3 - rejectionReason.length} more characters required`
                : `${rejectionReason.length} characters • Press Ctrl+Enter to submit`}
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="estimated-ratio" className="form-label">
            Estimated Ratio <span className="optional">(optional)</span>
          </label>
          <input
            type="text"
            id="estimated-ratio"
            className="form-input ratio-input"
            placeholder="e.g., 3:5"
            value={estimatedRatio}
            onChange={handleEstimatedRatioChange}
            aria-describedby="ratio-hint"
          />
          <small id="ratio-hint" className="form-hint">
            Your estimated ratio for this test (e.g., 3:5 or 2.5)
          </small>
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn reject solid"
            onClick={handleConfirm}
            disabled={!isReasonValid}
            title={!isReasonValid ? 'Please provide a reason for rejection' : 'Reject with reason'}
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

export default RejectModal;
