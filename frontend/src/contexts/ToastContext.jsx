import { createContext, useContext } from 'react';

export const ToastContext = createContext(null);

/**
 * Hook for surfacing universal toast notifications anywhere in the app.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success('Team created');
 *   toast.error('Failed to delete AE', { duration: 6000 });
 *   toast.info('Working…');
 *
 * Returns an object with `success`, `error`, `info`, `warning`, `show`,
 * and `dismiss` helpers. All helpers return the toast id so callers can
 * dismiss programmatically (e.g. clear a long-lived "saving…" toast on
 * completion).
 */
export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
};
