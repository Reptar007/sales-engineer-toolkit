import { useEffect, useMemo, useState } from 'react';
import { getQuarterlyGoals, getSalesforceConfig, updateQuarterlyGoals } from '../services/api';
import './QuarterlyGoalsPage.css';

const ONE_MILLION = 1000000;
const ADMIN_GOALS_YEAR_STORAGE_KEY = 'adminGoals.selectedYear';
const ADMIN_GOALS_CACHE_KEY = 'adminGoals.goalsCache';

function getDefaultGoals() {
  return [
    { quarter: 1, goalMillions: '0' },
    { quarter: 2, goalMillions: '0' },
    { quarter: 3, goalMillions: '0' },
    { quarter: 4, goalMillions: '0' },
  ];
}

function formatMillionsFromDollars(dollars) {
  const millions = (Number(dollars) || 0) / ONE_MILLION;
  return Number.isInteger(millions) ? String(millions) : String(Number(millions.toFixed(3)));
}

function parseMillionsToDollars(value) {
  const millions = Number.parseFloat(value);
  if (!Number.isFinite(millions) || millions < 0) return 0;
  return Math.round(millions * ONE_MILLION);
}

const QuarterlyGoalsPage = () => {
  const currentYear = new Date().getFullYear();
  const persistedYear = Number.parseInt(localStorage.getItem(ADMIN_GOALS_YEAR_STORAGE_KEY) || '', 10);
  const initialYear = Number.isInteger(persistedYear) ? persistedYear : currentYear;

  const [years, setYears] = useState([currentYear]);
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [goals, setGoals] = useState(getDefaultGoals());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [showSavedToast, setShowSavedToast] = useState(false);

  const getCachedGoalsByYear = () => {
    try {
      const raw = localStorage.getItem(ADMIN_GOALS_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  };

  const setCachedGoalsForYear = (year, goalsForYear) => {
    const cache = getCachedGoalsByYear();
    cache[year] = goalsForYear;
    localStorage.setItem(ADMIN_GOALS_CACHE_KEY, JSON.stringify(cache));
  };

  const loadGoals = async (year) => {
    setLoading(true);
    setMessage('');
    const cached = getCachedGoalsByYear()[year];
    if (Array.isArray(cached) && cached.length === 4) {
      setGoals(cached);
      setLoading(false);
    }

    try {
      const response = await getQuarterlyGoals(year);
      const normalized = getDefaultGoals().map((entry) => {
        const match = (response?.goals || []).find((g) => g.value === entry.quarter);
        return {
          quarter: entry.quarter,
          goalMillions: formatMillionsFromDollars(match?.goal ?? 0),
        };
      });
      setGoals(normalized);
      setCachedGoalsForYear(year, normalized);
    } catch (error) {
      setMessage(error?.message || 'Failed to load quarterly goals.');
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableYears = async () => {
    try {
      const response = await getSalesforceConfig();
      const configYears = Object.keys(response?.goalsByYear || {})
        .map((y) => Number.parseInt(y, 10))
        .filter((y) => Number.isInteger(y));
      const suggestedYears = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];
      const mergedYears = [...new Set([...configYears, ...suggestedYears])].sort((a, b) => a - b);
      setYears(mergedYears.length ? mergedYears : [currentYear]);
      if (!mergedYears.includes(selectedYear)) {
        setSelectedYear(mergedYears[0] || currentYear);
      }
    } catch {
      const fallback = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];
      setYears(fallback);
      if (!fallback.includes(selectedYear)) {
        setSelectedYear(currentYear);
      }
    }
  };

  useEffect(() => {
    loadAvailableYears();
  }, []);

  useEffect(() => {
    localStorage.setItem(ADMIN_GOALS_YEAR_STORAGE_KEY, String(selectedYear));
  }, [selectedYear]);

  useEffect(() => {
    loadGoals(selectedYear);
  }, [selectedYear]);

  const handleGoalChange = (quarter, value) => {
    setGoals((prev) =>
      prev.map((entry) =>
        entry.quarter === quarter
          ? { ...entry, goalMillions: value }
          : entry,
      ),
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const payload = goals.map((g) => ({
        quarter: g.quarter,
        goal: parseMillionsToDollars(g.goalMillions),
      }));
      await updateQuarterlyGoals(selectedYear, payload);
      setMessage(`Quarterly goals for ${selectedYear} saved successfully.`);
      setShowSavedToast(true);
      setTimeout(() => setShowSavedToast(false), 2500);
      await loadGoals(selectedYear);
    } catch (error) {
      setMessage(error?.message || 'Failed to save quarterly goals.');
    } finally {
      setSaving(false);
    }
  };

  const yearlyGoalTotal = useMemo(
    () =>
      goals.reduce((acc, goalEntry) => acc + parseMillionsToDollars(goalEntry.goalMillions || '0'), 0),
    [goals],
  );

  const isSuccessMessage = message.toLowerCase().includes('saved');

  return (
    <div className="quarterly-goals">
      <h2 className="section-title quarterly-goals__title">Quarterly Goals</h2>
      <p className="quarterly-goals__intro">
        Set CARR goals for each quarter by year. These goals are used in Salesforce metrics and calculator
        views.
      </p>
      <p className="quarterly-goals__hint">
        Enter each quarter goal in millions (example: <strong>3.1</strong> = $3,100,000).
      </p>

      <div className="quarterly-goals__controls">
        <label htmlFor="goals-year" className="quarterly-goals__label">Year</label>
        <select
          id="goals-year"
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="quarterly-goals__select"
          disabled={loading || saving}
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="quarterly-goals__loading">Loading quarterly goals...</p>
      ) : (
        <>
          <div className="quarterly-goals__grid">
            {goals.map((entry) => (
              <div key={entry.quarter} className="quarterly-goals__card">
                <label htmlFor={`q${entry.quarter}-goal`} className="quarterly-goals__card-label">
                  Q{entry.quarter} CY{selectedYear}
                </label>
                <input
                  id={`q${entry.quarter}-goal`}
                  type="number"
                  min="0"
                  step="0.1"
                  value={entry.goalMillions}
                  onChange={(e) => handleGoalChange(entry.quarter, e.target.value)}
                  className="quarterly-goals__input"
                  disabled={saving}
                />
                <div className="quarterly-goals__card-subtext">
                  ${parseMillionsToDollars(entry.goalMillions).toLocaleString('en-US')}
                </div>
              </div>
            ))}
          </div>

          <p className="quarterly-goals__total">
            Yearly total goal: ${yearlyGoalTotal.toLocaleString('en-US')}
          </p>

          <button
            type="button"
            className="quarterly-goals__save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : `Save goals for ${selectedYear}`}
          </button>
        </>
      )}

      {message && (
        <p
          className={`quarterly-goals__message ${
            isSuccessMessage ? 'quarterly-goals__message--success' : 'quarterly-goals__message--error'
          }`}
        >
          {message}
        </p>
      )}

      {showSavedToast && (
        <div className="quarterly-goals__toast" role="status" aria-live="polite">
          Quarterly goals saved.
        </div>
      )}
    </div>
  );
};

export default QuarterlyGoalsPage;
