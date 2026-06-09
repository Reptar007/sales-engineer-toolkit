import React, { useState, useEffect, useRef } from 'react';

/**
 * Lightweight editable text area used by Opp sections. When `editable` is
 * false (read-only mode for non-owners) it just renders the saved value
 * inline. Saves are debounced and surface a "Saving…" / "Saved" status the
 * parent can render via `onStatusChange`.
 *
 * The component does NOT manage its own server state -- the parent owns
 * the canonical value and patches it via `onSave(value)` which should
 * return a promise. We optimistically reflect what the user typed so
 * keystrokes never feel laggy.
 */
function EditableTextArea({ value, editable, placeholder, minHeight, onSave, onStatusChange }) {
  const [draft, setDraft] = useState(value || '');
  const dirty = useRef(false);
  const saveTimer = useRef(null);

  // Sync external updates only when we're not actively typing. This avoids
  // wiping a half-written sentence if the parent refetches while the user
  // is mid-edit.
  useEffect(() => {
    if (!dirty.current) setDraft(value || '');
  }, [value]);

  const schedule = (next) => {
    setDraft(next);
    dirty.current = true;
    onStatusChange?.('typing');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      onStatusChange?.('saving');
      try {
        await onSave(next);
        dirty.current = false;
        onStatusChange?.('saved');
      } catch (err) {
        onStatusChange?.('error', err?.message);
      }
    }, 700);
  };

  if (!editable) {
    if (!draft) {
      return <p className="opp-section__placeholder">{placeholder || 'Nothing here yet.'}</p>;
    }
    return <div className="opp-section__view">{draft}</div>;
  }

  return (
    <textarea
      className="opp-section__textarea"
      style={minHeight ? { minHeight } : undefined}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => schedule(e.target.value)}
    />
  );
}

export default EditableTextArea;
