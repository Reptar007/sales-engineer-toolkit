import React, { useState, useCallback } from 'react';
import './FlowDocGenerator.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for older browsers
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      type="button"
      className={`fdg-copy-btn${copied ? ' copied' : ''}`}
      onClick={handleCopy}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function TestStep({ step, index }) {
  return (
    <div className="fdg-step">
      <h4 className="fdg-step-name-heading">
        <span className="fdg-step-index">{index + 1}</span>
        {step.name}
      </h4>
      <div className="fdg-code-wrapper">
        <CopyButton text={step.code} />
        <pre className="fdg-code-block"><code>{step.code}</code></pre>
      </div>
    </div>
  );
}

function DocOutput({ doc }) {
  const [showPrintTip, setShowPrintTip] = useState(false);

  const handleDownload = () => {
    setShowPrintTip(true);
    const logoUrl = `${window.location.origin}/QAWolf_logo_blue.png`;
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${doc.flowName}</title>
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
  <h1 class="fdg-doc-title">${doc.flowName}</h1>
  <div class="fdg-summary-block">
    <h2 class="fdg-section-heading">Summary of Flow</h2>
    <p class="fdg-summary-text">${doc.summary}</p>
  </div>
  ${doc.steps.map((step, i) => `
  <div class="fdg-step">
    <h3 class="fdg-step-name-heading">
      <span class="fdg-step-index">${i + 1}</span>
      ${step.name}
    </h3>
    <pre>${step.code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
  </div>`).join('')}
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    // Print via a hidden iframe - no new tab opens
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:none;left:-9999px;top:-9999px;';
    document.body.appendChild(iframe);

    iframe.addEventListener('load', () => {
      setTimeout(() => {
        const originalTitle = document.title;
        document.title = doc.flowName;
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
            <button type="button" className="fdg-print-tip-close" onClick={() => setShowPrintTip(false)}>&#10005;</button>
          </div>
          <ol className="fdg-print-tip-steps">
            {printTipSteps.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        </div>
      )}
      <div className="fdg-doc-header">
        <img src="/QAWolf_logo_blue.png" alt="QA Wolf" className="fdg-qaw-logo" />
        <h2 className="fdg-doc-title">{doc.flowName}</h2>
      </div>

      <div className="fdg-doc-body">
        <section className="fdg-summary-section">
          <h3 className="fdg-section-heading">Summary of Flow</h3>
          <p className="fdg-summary-text">{doc.summary}</p>
        </section>

        <section className="fdg-steps-section">
          {doc.steps.map((step, i) => (
            <TestStep key={`${step.name}-${i}`} step={step} index={i} />
          ))}
        </section>
      </div>
    </div>
  );
}

function FlowDocGenerator() {
  const [flowUrl, setFlowUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [doc, setDoc] = useState(null);

  const handleGenerate = useCallback(async () => {
    if (!flowUrl.trim()) return;

    setLoading(true);
    setError(null);
    setDoc(null);

    try {
      const token = localStorage.getItem('authToken');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE_URL}/flow-doc/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ flowUrl: flowUrl.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Server error ${res.status}`);
      }

      setDoc(data);
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }, [flowUrl]);

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
        <p>Paste a QA Wolf flow URL to generate a formatted technical leave-behind document.</p>
      </div>

      <div className="fdg-input-section">
        <label className="fdg-input-label" htmlFor="fdg-url-input">
          QA Wolf Flow URL
        </label>
        <div className="fdg-input-row">
          <input
            id="fdg-url-input"
            type="url"
            className="fdg-url-input"
            placeholder="https://app.qawolf.com/org/environments/ENV_ID/automate/ide?file=src%2Fflows%2F..."
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
      </div>

      {loading && (
        <div className="fdg-loading">
          <span className="fdg-spinner" />
          Fetching flow and generating document...
        </div>
      )}

      {error && (
        <div className="fdg-error">
          {error}
        </div>
      )}

      {doc && !loading && <DocOutput doc={doc} />}
    </div>
  );
}

export default FlowDocGenerator;
