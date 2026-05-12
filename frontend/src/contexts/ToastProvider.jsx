import { useCallback, useMemo, useRef, useState } from 'react';
import { ToastContext } from './ToastContext';
import ToastContainer from '../components/Toast/ToastContainer';

const DEFAULT_DURATIONS = {
  success: 3500,
  info: 3500,
  warning: 5000,
  error: 6000,
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  // Counter ensures stable, unique ids even when several toasts are
  // pushed in the same tick (Date.now() collides on fast bursts).
  const idRef = useRef(0);
  // Track auto-dismiss timers so manual dismiss + unmount can clear them.
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (variant, message, options = {}) => {
      if (!message) return null;
      idRef.current += 1;
      const id = idRef.current;
      const duration =
        typeof options.duration === 'number'
          ? options.duration
          : (DEFAULT_DURATIONS[variant] ?? DEFAULT_DURATIONS.info);

      setToasts((current) => [
        ...current,
        {
          id,
          variant,
          message,
          title: options.title || null,
        },
      ]);

      // duration of 0 (or negative) opts out of auto-dismiss — useful for
      // long-running progress toasts that the caller will dismiss manually.
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      show,
      dismiss,
      success: (message, options) => show('success', message, options),
      error: (message, options) => show('error', message, options),
      info: (message, options) => show('info', message, options),
      warning: (message, options) => show('warning', message, options),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
};

export default ToastProvider;
