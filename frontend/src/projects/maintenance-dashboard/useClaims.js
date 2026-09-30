import { useCallback, useEffect, useRef, useState } from 'react';
import {
  claimMaintenanceCustomer,
  fetchMaintenanceClaims,
  releaseMaintenanceClaim,
} from '../../services/api';

/**
 * Who has claimed which Bone Pile customer, for the page.
 *
 * Claims come from their own route, not the snapshot: they change when an SE
 * clicks, not when a scan runs, and the route reads the database and nothing
 * else, so it is cheap to ask. The page asks it once a minute while the tab is
 * visible, and at once when the reader comes back to a tab left alone for a
 * while, so a teammate's claim shows within a minute without a rescan.
 *
 * The server's answer is the truth. Nothing is shown before it answers, a
 * claim or a release included, and every write answers the whole list, which
 * replaces what the page had. A read that was out while a write ran is
 * dropped, since it may have been answered from before the write. An answer
 * the same as the one on screen keeps its identity, so nothing that follows
 * it redraws.
 *
 * A failed read keeps the last answer and says why in `error`, until a read
 * or a write works. A failed write is thrown to whoever asked for it.
 */

const CLAIMS_POLL_MS = 60 * 1000;
// A tab that turns visible again asks at once, unless it asked this recently.
const CLAIMS_REFOCUS_MS = 15 * 1000;

/** The list an answer carries; a write's answer says more beside it. */
function pick(answer) {
  return {
    claims: Array.isArray(answer?.claims) ? answer.claims : [],
    claimDays: answer?.claimDays ?? null,
    noteMaxLength: answer?.noteMaxLength ?? 140,
  };
}

export default function useClaims({ enabled }) {
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  // The write running, as `{ workspaceId, action: 'claim'|'renew'|'release' }`.
  const [busy, setBusy] = useState(null);

  // Moves when a write starts and again when it ends, so a read can tell that
  // one ran while it was out.
  const writes = useRef(0);
  // When a read last went out (ms), so returning to the tab does not ask twice.
  const lastAsked = useRef(0);

  const apply = useCallback((next) => {
    const list = pick(next);
    setAnswer((prev) => (prev && JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
  }, []);

  const read = useCallback(
    async (cancelled) => {
      const before = writes.current;
      lastAsked.current = Date.now();
      try {
        const next = await fetchMaintenanceClaims();
        if (cancelled() || writes.current !== before) return;
        apply(next);
        setError(null);
        setCheckedAt(Date.now());
      } catch (err) {
        if (cancelled() || writes.current !== before) return;
        setError(err?.message || 'Claims could not be read.');
      }
    },
    [apply],
  );

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    const cancelled = () => stopped;
    read(cancelled);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') read(cancelled);
    }, CLAIMS_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastAsked.current >= CLAIMS_REFOCUS_MS) read(cancelled);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, read]);

  const write = useCallback(
    async (busyState, run) => {
      writes.current += 1;
      setBusy(busyState);
      try {
        const res = await run();
        apply(res);
        setError(null);
        setCheckedAt(Date.now());
        return res;
      } finally {
        writes.current += 1;
        setBusy(null);
      }
    },
    [apply],
  );

  const reload = useCallback(() => read(() => false), [read]);

  /** Claim or renew (`action` only names the wait); `note` undefined keeps the note. */
  const claim = useCallback(
    (workspaceId, note, action) =>
      write({ workspaceId, action }, () => claimMaintenanceCustomer(workspaceId, { note })),
    [write],
  );

  const release = useCallback(
    (workspaceId, userId) =>
      write({ workspaceId, action: 'release' }, () => releaseMaintenanceClaim(workspaceId, userId)),
    [write],
  );

  return {
    claims: answer?.claims ?? null,
    claimDays: answer?.claimDays ?? null,
    noteMaxLength: answer?.noteMaxLength ?? 140,
    loaded: Boolean(answer),
    error,
    checkedAt,
    busy,
    reload,
    claim,
    release,
  };
}
