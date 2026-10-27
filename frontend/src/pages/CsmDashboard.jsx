import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchLoneWolves } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { fullName, seesAllClients } from '../utils/roles';
import {
  activationList,
  clientsFor,
  dayLabel,
  describeRuns,
  doneCount,
  formatMoney,
  segmentLabel,
  usageMessage,
} from '../projects/lone-wolves/onboardingView';
import '../projects/lone-wolves/LoneWolves.css';

/**
 * Home for a customer success account: its self-serve clients, read from
 * the same scan as Lone Wolves.
 *
 * A CSM sees the workspaces whose CSM (picked on the Lone Wolves card) is
 * them; the CSM lead and admins see every one. Each client shows where
 * onboarding stands and its usage, with last week's usage message ready to
 * copy. Changing anything happens in Lone Wolves, by its editors.
 */

const POLL_MS = 4000;
const IDLE_POLL_MS = 5 * 60 * 1000;
const ERROR_POLL_MS = 30 * 1000;

function ClientCard({ row }) {
  const toast = useToast();
  const pricing = row.pricing || 'old';
  const thisWeek = row.usage?.thisWeek;
  const lastWeek = row.usage?.lastWeek;
  const copy = async () => {
    const message = usageMessage(row, pricing);
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
      toast.success(`Copied ${row.name}'s usage for last week.`);
    } catch {
      toast.error('Could not copy to the clipboard.');
    }
  };
  const priceOf = (week) => (pricing === 'none' ? null : week?.prices?.[pricing]);
  return (
    <article className="lw-client">
      <header className="lw-client-head">
        <div>
          <div className="lw-overline">{segmentLabel(row.segment)}</div>
          <h2>{row.name}</h2>
          <div className="lw-muted lw-small">
            {dayLabel(row)}
            {row.environmentName ? ` · ${row.environmentName}` : ''}
          </div>
        </div>
        <span className={`lw-pill lw-status--${row.status.replace(/\s/g, '').toLowerCase()}`}>
          {row.status}
        </span>
      </header>
      {row.reason ? <p className="lw-client-reason">{row.reason}</p> : null}

      <div className="lw-client-steps">
        <div className="lw-dots">
          {activationList(row.activation).map((step) => (
            <span
              key={step.label}
              role="img"
              aria-label={`${step.label}: ${step.word}`}
              title={`${step.label}: ${step.word}`}
              className={`lw-dot lw-dot--${step.flag}`}
            />
          ))}
        </div>
        <span className="lw-muted lw-small">{doneCount(row.activation)} of 6 steps</span>
      </div>

      <dl className="lw-client-facts">
        <div>
          <dt>Runs 24h</dt>
          <dd>{describeRuns(row.runs)}</dd>
        </div>
        <div>
          <dt>Bugs</dt>
          <dd>
            {row.bugs ? `${row.bugs.open} open · ${row.bugs.unprioritized} unprioritized` : '—'}
          </dd>
        </div>
        <div>
          <dt>This week</dt>
          <dd>
            {thisWeek
              ? `${thisWeek.flowRuns} test runs · ${thisWeek.runnerMinutes} min · ${thisWeek.credits} credits`
              : '—'}
            {priceOf(thisWeek) ? ` · ${formatMoney(priceOf(thisWeek).amount)}` : ''}
          </dd>
        </div>
        <div>
          <dt>Last week</dt>
          <dd>
            {lastWeek
              ? `${lastWeek.flowRuns} test runs · ${lastWeek.runnerMinutes} min · ${lastWeek.credits} credits`
              : '—'}
            {priceOf(lastWeek) ? ` · ${formatMoney(priceOf(lastWeek).amount)}` : ''}
          </dd>
        </div>
      </dl>

      <div className="lw-card-actions">
        {lastWeek ? (
          <button type="button" className="lw-btn lw-btn--ghost" onClick={copy}>
            Copy last week's usage
          </button>
        ) : null}
        <Link
          className="lw-btn lw-btn--quiet"
          to={`/projects/lone-wolves?workspace=${encodeURIComponent(row.workspaceId)}`}
        >
          Open in Lone Wolves
        </Link>
      </div>
    </article>
  );
}

export default function CsmDashboard() {
  const { user } = useAuth();
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const stopped = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchLoneWolves();
      if (stopped.current) return null;
      setPayload(data);
      setError(null);
      return data;
    } catch (err) {
      if (!stopped.current) setError(err);
      return null;
    }
  }, []);

  useEffect(() => {
    stopped.current = false;
    let timer;
    const tick = async () => {
      const data = await load();
      if (stopped.current) return;
      const busy = data && (data.status === 'building' || data.refreshing);
      timer = setTimeout(tick, busy ? POLL_MS : data ? IDLE_POLL_MS : ERROR_POLL_MS);
    };
    tick();
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [load]);

  const all = seesAllClients(user);
  const clients = useMemo(
    () => clientsFor(payload?.rows || [], { all, name: fullName(user), email: user?.email }),
    [payload, user, all],
  );
  const firstName = user?.firstName || 'there';

  return (
    <div className="lone-wolves">
      <header className="lw-header">
        <div>
          <div className="lw-overline">Customer success</div>
          <h1>{all ? 'Self-serve clients' : 'My self-serve clients'}</h1>
          <p>
            Hi {firstName}.{' '}
            {all
              ? 'Every self-serve, custom-contract and pilot workspace, stalled ones first.'
              : 'The self-serve workspaces you are the CSM for, stalled ones first.'}{' '}
            Usage weeks run Monday to Sunday (UTC).
          </p>
        </div>
        <div className="lw-actions">
          <Link className="lw-btn lw-btn--ghost" to="/projects/lone-wolves">
            Open Lone Wolves
          </Link>
        </div>
      </header>

      {error ? <div className="lw-warning">{error.message}</div> : null}
      {!payload || payload.status === 'building' ? (
        <div className="lw-hint">Reading your clients… this takes a minute.</div>
      ) : clients.length === 0 ? (
        <div className="lw-hint">
          No self-serve clients are assigned to you yet. The CSM on each workspace is set in Lone
          Wolves by Becca or Kyla; once you are picked on one, it shows here.
        </div>
      ) : (
        <section className="lw-clients" aria-label="Clients">
          {clients.map((row) => (
            <ClientCard key={row.workspaceId} row={row} />
          ))}
        </section>
      )}
    </div>
  );
}
