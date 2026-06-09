import React, { useState, useCallback, useRef, useEffect } from 'react';
import './FlowDocGenerator.css';
import { listMyOpps, getOpp, updateOpp } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

// Build a single-flow QA Wolf IDE URL from the demo environment URL and a flow
// file path, e.g. ".../automate/ide?file=src%2Fflows%2Ffoo.flow.ts". This is
// the same shape the Howl Sheet parses, so the saved Opp flow link is valid.
function buildFlowFileUrl(envUrl, filePath) {
  try {
    const u = new URL(envUrl);
    u.search = '';
    u.searchParams.set('file', filePath);
    return u.toString();
  } catch {
    return envUrl;
  }
}

// Auto-resizing textarea for inline editing
function EditableTextarea({ value, onChange, className }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [value]);

  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
    />
  );
}

function TestStep({ step, index, onNameChange }) {
  return (
    <div className="fdg-step">
      <h4 className="fdg-step-name-heading">
        <span className="fdg-step-index">{index + 1}</span>
        <input
          className="fdg-editable-step-name"
          value={step.name}
          onChange={(e) => onNameChange(index, e.target.value)}
          title="Click to edit step name"
        />
      </h4>
      <div className="fdg-code-wrapper">
        <pre className="fdg-code-block">
          <code>{step.code}</code>
        </pre>
      </div>
    </div>
  );
}

function DocOutput({ doc }) {
  // Editable doc state - title, summary, step names
  const [title, setTitle] = useState(doc.flowName);
  const [summary, setSummary] = useState(doc.summary);
  const [steps, setSteps] = useState(doc.steps);
  const [showPrintTip, setShowPrintTip] = useState(false);
  const helpers = doc.helpers || [];

  const handleStepNameChange = useCallback((index, newName) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, name: newName } : s)));
  }, []);

  const handleDownload = () => {
    setShowPrintTip(true);
    const logoUrl = `${window.location.origin}/QAWolf_logo_blue.png`;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; color: #0d0d1a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .fdg-qaw-logo { height: 40px; width: auto; display: block; margin-bottom: 0.75rem; }
    .fdg-doc-title { font-size: 1.4rem; font-weight: 700; text-align: center; margin-bottom: 1rem; }
    .fdg-summary-block { margin-bottom: 1rem; }
    .fdg-section-heading { font-size: 1rem; font-weight: 700; margin-bottom: 0.5rem; }
    .fdg-summary-text { font-size: 0.9rem; line-height: 1.7; color: #374151; padding-left: 1rem; border-left: 3px solid #3d3df5; }
    .fdg-step { margin-bottom: 1.25rem; }
    .fdg-step-name-heading { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; font-weight: 700; margin-bottom: 0.4rem; page-break-after: avoid; break-after: avoid; }
    .fdg-step-index { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; background: #3d3df5 !important; color: #fff !important; border-radius: 50%; font-size: 0.65rem; font-weight: 700; flex-shrink: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    pre { background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 6px; padding: 0.75rem 1rem; font-family: 'SFMono-Regular', 'Consolas', Menlo, monospace; font-size: 0.7rem; line-height: 1.55; white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; }
    @page { margin: 1.5cm 2cm; size: A4; }
  </style>
</head>
<body>
  <img src="${logoUrl}" class="fdg-qaw-logo" alt="QA Wolf" />
  <h1 class="fdg-doc-title">${title}</h1>
  <div class="fdg-summary-block">
    <h2 class="fdg-section-heading">Summary of Flow</h2>
    <p class="fdg-summary-text">${summary}</p>
  </div>
  ${steps
    .map(
      (step, i) => `
  <div class="fdg-step">
    <h3 class="fdg-step-name-heading">
      <span class="fdg-step-index">${i + 1}</span>
      ${step.name}
    </h3>
    <pre>${step.code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
  </div>`,
    )
    .join('')}
  ${
    helpers.length > 0
      ? `
  <div class="fdg-summary-block">
    <h2 class="fdg-section-heading">Helper Files</h2>
  </div>
  ${helpers
    .map(
      (helper) => `
  <div class="fdg-step">
    <h3 class="fdg-step-name-heading">${helper.path}</h3>
    <pre>${helper.code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
  </div>`,
    )
    .join('')}`
      : ''
  }
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:none;left:-9999px;top:-9999px;';
    document.body.appendChild(iframe);

    iframe.addEventListener('load', () => {
      setTimeout(() => {
        const originalTitle = document.title;
        document.title = title;
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        document.title = originalTitle;
        URL.revokeObjectURL(blobUrl);
        setTimeout(() => document.body.removeChild(iframe), 1000);
      }, 300);
    });

    iframe.src = blobUrl;
  };

  const printTipSteps = [
    'In the print dialog, find "More settings" or "Options"',
    'Uncheck "Headers and footers"',
    'Set Destination to "Save as PDF"',
    'Click Save',
  ];

  return (
    <div className="fdg-doc-card">
      <div className="fdg-doc-actions fdg-no-print">
        <button type="button" className="fdg-download-btn" onClick={handleDownload}>
          &#8681; Download PDF
        </button>
      </div>

      {showPrintTip && (
        <div className="fdg-print-tip fdg-no-print">
          <div className="fdg-print-tip-header">
            <span>To remove headers and footers from the PDF:</span>
            <button
              type="button"
              className="fdg-print-tip-close"
              onClick={() => setShowPrintTip(false)}
            >
              &#10005;
            </button>
          </div>
          <ol className="fdg-print-tip-steps">
            {printTipSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="fdg-doc-header">
        <img src="/QAWolf_logo_blue.png" alt="QA Wolf" className="fdg-qaw-logo" />
        <input
          className="fdg-editable-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          title="Click to edit title"
        />
      </div>

      <div className="fdg-doc-body">
        <section className="fdg-summary-section">
          <h3 className="fdg-section-heading">Summary of Flow</h3>
          <EditableTextarea
            className="fdg-editable-summary"
            value={summary}
            onChange={setSummary}
          />
        </section>

        <section className="fdg-steps-section">
          {steps.map((step, i) => (
            <TestStep key={`step-${i}`} step={step} index={i} onNameChange={handleStepNameChange} />
          ))}
        </section>

        {helpers.length > 0 && (
          <section className="fdg-helpers-section">
            <h3 className="fdg-section-heading">Helper Files</h3>
            {helpers.map((helper, i) => (
              <div className="fdg-step" key={`helper-${i}`}>
                <h4 className="fdg-step-name-heading">
                  <span className="fdg-helper-path">{helper.path}</span>
                </h4>
                <div className="fdg-code-wrapper">
                  <pre className="fdg-code-block">
                    <code>{helper.code}</code>
                  </pre>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

// A URL that points at a specific flow file has a ?file= query param; an
// environment URL (no file) triggers bulk generation for every flow.
function isEnvironmentUrl(url) {
  try {
    return !new URL(url).searchParams.get('file');
  } catch {
    return false;
  }
}

function authHeaders() {
  const token = localStorage.getItem('authToken');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function FlowDocGenerator() {
  const toast = useToast();
  const [flowUrl, setFlowUrl] = useState('');
  const [includeHelpers, setIncludeHelpers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [docs, setDocs] = useState([]);
  const [failures, setFailures] = useState([]);

  // Bulk selection state: the flows found in the environment, the user's
  // selection, and a filter for narrowing down long lists.
  const [flowOptions, setFlowOptions] = useState([]);
  const [selectedPaths, setSelectedPaths] = useState(() => new Set());
  const [filter, setFilter] = useState('');

  // "Save to Opp" modal state.
  const [oppModalOpen, setOppModalOpen] = useState(false);
  const [oppList, setOppList] = useState([]);
  const [oppLoading, setOppLoading] = useState(false);
  const [selectedOppId, setSelectedOppId] = useState('');
  const [saving, setSaving] = useState(false);

  const resetResults = () => {
    setError(null);
    setDocs([]);
    setFailures([]);
    setFlowOptions([]);
    setSelectedPaths(new Set());
    setFilter('');
  };

  const handleGenerate = useCallback(async () => {
    const trimmed = flowUrl.trim();
    if (!trimmed) return;

    setLoading(true);
    resetResults();

    const bulk = isEnvironmentUrl(trimmed);

    try {
      // Environment URL: fetch the flow list first so the user can choose
      // which flows to generate (instead of generating all of them).
      const endpoint = bulk ? '/flow-doc/list-flows' : '/flow-doc/generate';
      const body = bulk ? { environmentUrl: trimmed } : { flowUrl: trimmed, includeHelpers };

      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Server error ${res.status}`);
      }

      if (bulk) {
        setFlowOptions(data.flows || []);
      } else {
        setDocs([data]);
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }, [flowUrl, includeHelpers]);

  const togglePath = useCallback((filePath) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);

  const filteredOptions = flowOptions.filter((f) => {
    if (!filter.trim()) return true;
    const q = filter.trim().toLowerCase();
    return f.flowName.toLowerCase().includes(q) || f.filePath.toLowerCase().includes(q);
  });

  const selectAllFiltered = useCallback(() => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      filteredOptions.forEach((f) => next.add(f.filePath));
      return next;
    });
  }, [filteredOptions]);

  const clearSelection = useCallback(() => setSelectedPaths(new Set()), []);

  const handleGenerateSelected = useCallback(async () => {
    if (selectedPaths.size === 0) return;

    setGenerating(true);
    setError(null);
    setDocs([]);
    setFailures([]);

    try {
      const res = await fetch(`${API_BASE_URL}/flow-doc/generate-bulk`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          environmentUrl: flowUrl.trim(),
          filePaths: [...selectedPaths],
          includeHelpers,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Server error ${res.status}`);
      }

      setDocs(data.docs || []);
      setFailures(data.failures || []);
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setGenerating(false);
    }
  }, [flowUrl, selectedPaths, includeHelpers]);

  const openOppModal = useCallback(async () => {
    if (selectedPaths.size === 0) return;
    setOppModalOpen(true);
    setSelectedOppId('');
    setOppLoading(true);
    try {
      const data = await listMyOpps();
      setOppList(data?.saved || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load your Opps.');
      setOppList([]);
    } finally {
      setOppLoading(false);
    }
  }, [selectedPaths, toast]);

  const handleSaveToOpp = useCallback(async () => {
    if (!selectedOppId) return;

    setSaving(true);
    try {
      const opp = await getOpp(selectedOppId);
      const existing = opp?.creation || { demoWorkspaceUrl: '', flows: [] };
      const existingFlows = existing.flows || [];
      const existingUrls = new Set(existingFlows.map((f) => f.url));

      const envUrl = flowUrl.trim();
      const byPath = new Map(flowOptions.map((f) => [f.filePath, f]));
      const newFlows = [...selectedPaths]
        .map((filePath, i) => {
          const opt = byPath.get(filePath);
          return {
            id: `flow-${Date.now()}-${i}`,
            name: opt?.flowName || filePath,
            url: buildFlowFileUrl(envUrl, filePath),
          };
        })
        .filter((f) => !existingUrls.has(f.url));

      const merged = {
        ...existing,
        demoWorkspaceUrl: existing.demoWorkspaceUrl || envUrl,
        flows: [...existingFlows, ...newFlows],
      };

      await updateOpp(selectedOppId, { creation: merged });

      const skipped = selectedPaths.size - newFlows.length;
      const oppName = oppList.find((o) => o.id === selectedOppId)?.oppName || 'Opp';
      toast.success(
        `Added ${newFlows.length} flow${newFlows.length === 1 ? '' : 's'} to ${oppName}` +
          (skipped > 0 ? ` (${skipped} already linked)` : ''),
      );
      setOppModalOpen(false);
    } catch (err) {
      toast.error(err.message || 'Failed to save flows to the Opp.');
    } finally {
      setSaving(false);
    }
  }, [selectedOppId, flowUrl, flowOptions, selectedPaths, oppList, toast]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !loading) handleGenerate();
    },
    [handleGenerate, loading],
  );

  return (
    <div className="flow-doc-generator">
      <div className="fdg-header">
        <h1>Flow Doc Generator</h1>
        <p>
          Paste a single QA Wolf flow URL for one document, or an environment URL to bulk-generate a
          document for every flow in that environment.
        </p>
      </div>

      <div className="fdg-info-panels">
        <div className="fdg-how-it-works">
          <p className="fdg-how-title">How it works</p>
          <ol className="fdg-how-steps">
            <li>
              Paste a flow URL (single doc) or an environment URL (one doc per flow) and click{' '}
              <strong>Generate</strong>
            </li>
            <li>The AI summarizes each flow, extracts its test steps, and pulls in helper files</li>
            <li>
              Click any field — title, summary, or step names — to edit them before downloading
            </li>
            <li>
              Hit <strong>Download PDF</strong> on any document to save a branded leave-behind
            </li>
          </ol>
        </div>

        <div className="fdg-gotchas">
          <p className="fdg-gotchas-title">⚠ Gotchas</p>
          <ul className="fdg-gotchas-list">
            <li>The SE Lead must be invited to the customer&apos;s QA Wolf team</li>
            <li>Must use a production URL — staging URLs are not supported</li>
            <li>Bulk generation over large environments can take a little while</li>
            <li>
              When saving the PDF, uncheck <strong>Headers and Footers</strong> in the print dialog
            </li>
          </ul>
        </div>
      </div>

      <div className="fdg-input-section">
        <label className="fdg-input-label" htmlFor="fdg-url-input">
          QA Wolf Flow or Environment URL
        </label>
        <div className="fdg-input-row">
          <input
            id="fdg-url-input"
            type="url"
            className="fdg-url-input"
            placeholder="https://app.qawolf.com/org/environments/ENV_ID/automate/ide (add ?file=... for a single flow)"
            value={flowUrl}
            onChange={(e) => setFlowUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button
            type="button"
            className="fdg-generate-btn"
            onClick={handleGenerate}
            disabled={loading || !flowUrl.trim()}
          >
            {loading ? 'Generating...' : 'Generate'}
          </button>
        </div>

        <label className="fdg-helpers-toggle">
          <input
            type="checkbox"
            checked={includeHelpers}
            onChange={(e) => setIncludeHelpers(e.target.checked)}
            disabled={loading}
          />
          <span>Include helper files</span>
          <span className="fdg-helpers-hint">
            Pulls in utility/helper files imported by the flow. Leave off for a cleaner doc.
          </span>
        </label>
      </div>

      {loading && (
        <div className="fdg-loading">
          <span className="fdg-spinner" />
          Fetching flows...
        </div>
      )}

      {generating && (
        <div className="fdg-loading">
          <span className="fdg-spinner" />
          Generating {selectedPaths.size} document{selectedPaths.size === 1 ? '' : 's'}...
        </div>
      )}

      {error && <div className="fdg-error">{error}</div>}

      {!loading && flowOptions.length > 0 && (
        <div className="fdg-select-panel">
          <div className="fdg-select-header">
            <div>
              <p className="fdg-select-title">
                Found {flowOptions.length} flow{flowOptions.length === 1 ? '' : 's'}
              </p>
              <p className="fdg-select-subtitle">
                Select the flows you want to generate documents for.
              </p>
            </div>
            <div className="fdg-select-actions">
              <button
                type="button"
                className="fdg-text-btn"
                onClick={openOppModal}
                disabled={selectedPaths.size === 0}
              >
                Save to Opp
              </button>
              <button
                type="button"
                className="fdg-generate-btn"
                onClick={handleGenerateSelected}
                disabled={generating || selectedPaths.size === 0}
              >
                {generating ? 'Generating...' : `Generate ${selectedPaths.size} Selected`}
              </button>
            </div>
          </div>

          <div className="fdg-select-toolbar">
            <input
              type="text"
              className="fdg-filter-input"
              placeholder="Filter flows..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button type="button" className="fdg-text-btn" onClick={selectAllFiltered}>
              Select all{filter.trim() ? ' (filtered)' : ''}
            </button>
            <button type="button" className="fdg-text-btn" onClick={clearSelection}>
              Clear
            </button>
          </div>

          <ul className="fdg-flow-list">
            {filteredOptions.map((f) => (
              <li key={f.filePath}>
                <label className="fdg-flow-item">
                  <input
                    type="checkbox"
                    checked={selectedPaths.has(f.filePath)}
                    onChange={() => togglePath(f.filePath)}
                  />
                  <span className="fdg-flow-name">{f.flowName}</span>
                  <span className="fdg-flow-path">{f.filePath}</span>
                </label>
              </li>
            ))}
            {filteredOptions.length === 0 && (
              <li className="fdg-flow-empty">No flows match &quot;{filter}&quot;</li>
            )}
          </ul>
        </div>
      )}

      {!loading && failures.length > 0 && (
        <div className="fdg-warning">
          {failures.length} flow{failures.length === 1 ? '' : 's'} could not be generated:
          <ul className="fdg-failure-list">
            {failures.map((f, i) => (
              <li key={`failure-${i}`}>
                {f.filePath} — {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && docs.length > 0 && (
        <div className="fdg-doc-list">
          {docs.length > 1 && (
            <p className="fdg-doc-count">
              Generated {docs.length} documents. Edit and download each individually below.
            </p>
          )}
          {docs.map((doc, i) => (
            <DocOutput key={doc.filePath || `doc-${i}`} doc={doc} />
          ))}
        </div>
      )}

      {oppModalOpen && (
        <div
          className="fdg-modal-overlay"
          onClick={() => !saving && setOppModalOpen(false)}
          role="presentation"
        >
          <div
            className="fdg-modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Save flows to an Opp"
          >
            <div className="fdg-modal-header">
              <h3 className="fdg-modal-title">Save to Opp</h3>
              <button
                type="button"
                className="fdg-modal-close"
                onClick={() => setOppModalOpen(false)}
                disabled={saving}
                aria-label="Close"
              >
                &#10005;
              </button>
            </div>

            <p className="fdg-modal-subtitle">
              Adds {selectedPaths.size} selected flow{selectedPaths.size === 1 ? '' : 's'} and the
              demo URL to the Opportunity&apos;s Creation section.
            </p>

            {oppLoading ? (
              <div className="fdg-loading">
                <span className="fdg-spinner" />
                Loading your Opps...
              </div>
            ) : oppList.length === 0 ? (
              <p className="fdg-modal-empty">
                No saved Opps yet — create one on the Hunt Board first.
              </p>
            ) : (
              <select
                className="fdg-opp-select"
                value={selectedOppId}
                onChange={(e) => setSelectedOppId(e.target.value)}
                disabled={saving}
              >
                <option value="">Select an Opp…</option>
                {oppList.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.oppName}
                  </option>
                ))}
              </select>
            )}

            <div className="fdg-modal-actions">
              <button
                type="button"
                className="fdg-text-btn"
                onClick={() => setOppModalOpen(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fdg-generate-btn"
                onClick={handleSaveToOpp}
                disabled={saving || !selectedOppId}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FlowDocGenerator;
