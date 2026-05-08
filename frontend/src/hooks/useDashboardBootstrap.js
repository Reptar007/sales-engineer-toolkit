import { useEffect, useRef, useState } from 'react';
import {
  fetchDashboardCalendar,
  fetchDashboardLinear,
  fetchSalesforceSnapshotMetrics,
  getSalesforceConfig,
} from '../services/api';

/**
 * useDashboardBootstrap
 *
 * Orchestrates a single, parallel "warm-up" of every dashboard data
 * source the first time the user lands on /. The hook does NOT pass the
 * resolved data down to widgets — each widget still owns its own state.
 * It just ensures we don't show the dashboard until every source has
 * settled, so that when the loading screen lifts the widgets are
 * already populated (their own concurrent fetches resolve at the same
 * time as ours, sharing the browser's HTTP cache).
 *
 * The hook returns:
 *   - ready: true once all critical fetches have settled (or failed)
 *   - The bootstrap honors a small minimum dwell time so the loading
 *     screen doesn't flash if the network is fast.
 *
 * @param {object} [options]
 * @param {number} [options.minDurationMs=900] Floor for how long to keep
 *   the loading screen up — prevents jarring flashes on warm caches.
 * @param {number} [options.maxDurationMs=8000] Hard ceiling — even if
 *   one source hangs, lift the loader after this so the user is never
 *   stuck staring at the axolotl forever.
 */
export default function useDashboardBootstrap({ minDurationMs = 900, maxDurationMs = 8000 } = {}) {
  const [ready, setReady] = useState(false);
  const startedAt = useRef(0);

  useEffect(() => {
    let cancelled = false;
    startedAt.current = Date.now();

    const finish = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt.current;
      const wait = Math.max(0, minDurationMs - elapsed);
      setTimeout(() => {
        if (!cancelled) setReady(true);
      }, wait);
    };

    // Salesforce metrics needs the year from config first, so we chain
    // them and roll the pair into a single promise. The metrics call
    // also stays "best-effort" — if config fails or there's no usable
    // year, we still resolve so the loader can lift.
    const calendarYear = new Date().getFullYear();
    const salesforceChain = getSalesforceConfig()
      .then((config) => {
        const candidates = [
          calendarYear,
          ...new Set([
            ...Object.keys(config?.reportIdsByYear || {}).map(Number),
            ...(config?.snapshotYears || []),
          ]),
        ].filter((y) => Number.isFinite(y));
        const year = candidates[0];
        if (!year) return null;
        return fetchSalesforceSnapshotMetrics(year).catch(() => null);
      })
      .catch(() => null);

    const allFetches = Promise.allSettled([
      fetchDashboardCalendar(),
      fetchDashboardLinear(),
      salesforceChain,
    ]);

    allFetches.then(finish).catch(finish);

    // Safety net: if a request hangs forever, flip ready anyway so the
    // user can still interact with whatever did load.
    const ceiling = setTimeout(() => {
      if (!cancelled) setReady(true);
    }, maxDurationMs);

    return () => {
      cancelled = true;
      clearTimeout(ceiling);
    };
  }, [minDurationMs, maxDurationMs]);

  return { ready };
}
