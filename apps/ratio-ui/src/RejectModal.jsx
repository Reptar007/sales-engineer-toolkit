import { useEffect, useRef } from 'react'

function RejectModal({ row, onClose, onConfirm }) {
  const dialogRef = useRef(null)
  const cancelBtnRef = useRef(null)

  // Focus first actionable element on open
  useEffect(() => {
    cancelBtnRef.current?.focus()
  }, [])

  // Close on ESC
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Close on backdrop click
  function onBackdropClick(e) {
    if (e.target === dialogRef.current) onClose()
  }

  return (
    <div
      ref={dialogRef}
      className="modal-backdrop"
      onMouseDown={onBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-title"
    >
      <div className="modal">
        <h3 id="reject-title">Reject this test?</h3>
        <p>
          {row?.name ? (
            <>Are you sure you want to reject <strong>{row.name}</strong>?</>
          ) : (
            'Are you sure?'
          )}
        </p>
        <div className="modal-actions">
          <button ref={cancelBtnRef} className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn reject solid" onClick={onConfirm}>
            Reject
          </button>
        </div>
      </div>
    </div>
  )
}

export default RejectModal
