import { useState, useEffect } from 'react';
import { getSalesforceConfig, createSnapshot } from '../services/api';
import './CreateSnapshotPage.css';

const CreateSnapshotPage = () => {
  // Data snapshots tab state
  const [snapshotYears, setSnapshotYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [configLoading, setConfigLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Load config and set snapshot years (Step 2)
  const loadConfigYears = async () => {
    setConfigLoading(true);
    setMessage('');
    try {
      const response = await getSalesforceConfig();
      setSnapshotYears(response.snapshotYears ?? []);
    } catch (error) {
      setMessage(error?.message || 'Failed to load config');
    } finally {
      setConfigLoading(false);
    }
  };

  useEffect(() => {
    loadConfigYears();
  }, []);

  const handleCreateSnapshot = async () => {
    setMessage('');
    setCreateLoading(true);
    try {
      await createSnapshot(selectedYear);
      setMessage(`Snapshot for ${selectedYear} has been created.`);
      const response = await getSalesforceConfig();
      setSnapshotYears(response.snapshotYears ?? []);
    } catch (error) {
      setMessage(error?.message || 'Failed to create snapshot');
    } finally {
      setCreateLoading(false);
    }
  };

  const isSuccessMessage = message && message.includes('created');

  return (
    <div className="create-snapshot">
      <h2 className="section-title create-snapshot__title">Snapshot Data</h2>
      <p className="create-snapshot__intro">
        Snapshots are created per year so we can create historical data, and so we do not keep calling SF APIs for older data.
      </p>
      {configLoading ? (
        <p className="create-snapshot__loading">Loading…</p>
      ) : (
        <>
          <div className="create-snapshot__existing">
            <strong className="create-snapshot__existing-label">Existing snapshot years</strong>
            <span
              className={`create-snapshot__existing-value ${!snapshotYears.length ? 'create-snapshot__existing-value--empty' : ''}`}
            >
              {snapshotYears.length ? snapshotYears.join(', ') : 'None'}
            </span>
          </div>
          <div className="create-snapshot__form">
            <label htmlFor="snapshot-year" className="create-snapshot__form-label">Year</label>
            <select
              id="snapshot-year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="create-snapshot__form-select"
            >
              {[2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleCreateSnapshot}
              disabled={createLoading}
              className="create-snapshot__form-button"
            >
              {createLoading ? 'Creating…' : 'Create snapshot'}
            </button>
          </div>
          {message && (
            <p
              className={`create-snapshot__message ${isSuccessMessage ? 'create-snapshot__message--success' : 'create-snapshot__message--error'}`}
            >
              {message}
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default CreateSnapshotPage;
