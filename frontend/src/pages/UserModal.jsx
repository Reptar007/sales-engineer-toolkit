import React, { useEffect, useRef } from 'react';

const UserModal = ({ isOpen, onClose }) => {
  const dialogRef = useRef(null);

  // Close on ESC key
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape' && isOpen) onClose();
    }
    if (isOpen) {
      document.addEventListener('keydown', onKeyDown);
      return () => document.removeEventListener('keydown', onKeyDown);
    }
  }, [isOpen, onClose]);

  // Close on backdrop click
  function onBackdropClick(e) {
    if (e.target === dialogRef.current) onClose();
  }

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      className="modal-backdrop"
      onMouseDown={onBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-modal-title"
    >
      <div className="modal">
        <h3 id="user-modal-title">Create New User</h3>
        <p>Form will go here</p>
      </div>
    </div>
  );
};

export default UserModal;