import React, { useState, useEffect, useRef } from 'react';

/**
 * Single-line text input variant of EditableTextArea, used for the
 * property row (CSM, QA Lead, etc.) and product-tour URL. When
 * `editable` is false the value renders as plain text.
 */
function EditableField({ value, editable, placeholder, onSave, onStatusChange, type = 'text' }) {
  const [draft, setDraft] = useState(value || '');
  const dirty = useRef(false);
  const saveTimer = useRef(null);

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
    }, 600);
  };

  if (!editable) {
    if (!draft) {
      return <span className="opp-property__value opp-section__placeholder">—</span>;
    }
    if (type === 'url') {
      return (
        <a
          className="opp-property__value"
          href={draft}
          target="_blank"
          rel="noopener noreferrer"
        >
          {draft}
        </a>
      );
    }
    return <span className="opp-property__value">{draft}</span>;
  }

  return (
    <input
      className="opp-property__input"
      type={type === 'url' ? 'url' : 'text'}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => schedule(e.target.value)}
    />
  );
}

export default EditableField;
