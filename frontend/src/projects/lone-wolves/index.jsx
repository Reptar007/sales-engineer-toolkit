import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  addLoneWolvesWorkspace,
  fetchLoneWolvesEnvironments,
  fetchLoneWolves,
  rescanLoneWolves,
  saveLoneWolvesDetails,
  fetchLoneWolvesCsms,
  importLoneWolvesMetered,
  startMetronomePull,
  fetchMetronomePull,
  connectMetronome,
  disconnectMetronome,
} from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import {
  FILTERS,
  PRICINGS,
  SEGMENT_LABELS,
  STATE_WORDS,
  activationList,
  calendarCells,
  clientPath,
  dayLabel,
  describeRuns,
  doneCount,
  downloadText,
  environmentLabel,
  filterCounts,
  filterRows,
  formatDay,
  formatMoney,
  LIST_PATH,
  linearUrl,
  monthName,
  metronomeConnectionLine,
  pullFailure,
  pullProgress,
  pullSummary,
  rowsToCsv,
  segmentLabel,
  slackPulse,
  timeline,
  triggerCheck,
  usageMessage,
} from './onboardingView';
import './LoneWolves.css';

/**
 * Lone Wolves -- self-serve onboarding health.
 *
 * Every self-serve, custom-contract and pilot workspace (Task Wolf's
 * SelfService QA team, plus any added by hand), how far each is through the
 * six activation steps against its kickoff date, and what the platform says
 * about it today: flows, runs, environments, triggers and bugs.
 *
 * The list keeps one short row per workspace; a row opens the workspace's
 * own page (/projects/lone-wolves/:workspaceId) with everything else.
 * Everything comes from one server answer: the cached scan joined to the
 * page's own records. The page polls while a scan runs and every few minutes
 * otherwise. Details saved on a workspace's page (kickoff, pilot length,
 * failure owner, ticket) are written to this app's database and show on the
 * next read; they never change anything in QA Wolf.
 */

const POLL_MS = 4000;
const IDLE_POLL_MS = 5 * 60 * 1000;
const ERROR_POLL_MS = 30 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Tile({ label, value, sub, tone }) {
  return (
    <div className={`lw-tile${tone ? ` lw-tile--${tone}` : ''}`}>
      <div className="lw-tile-label">{label}</div>
      <div className="lw-tile-value">{value}</div>
      {sub ? <div className="lw-tile-sub">{sub}</div> : null}
    </div>
  );
}

function StepDots({ activation }) {
  return (
    <div className="lw-dots">
      {activationList(activation).map((step) => (
        <span
          key={step.label}
          role="img"
          aria-label={`${step.label}: ${step.word}`}
          title={`${step.label}: ${step.word}`}
          className={`lw-dot lw-dot--${step.flag}`}
        />
      ))}
    </div>
  );
}

function MilestoneChip({ chip, onClick }) {
  if (!onClick) {
    return (
      <span className={`lw-chip lw-chip--${chip.state} lw-chip--static`} title={chip.title}>
        {chip.label}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`lw-chip lw-chip--${chip.state}`}
      title={chip.title}
      onClick={onClick}
    >
      {chip.label}
    </button>
  );
}

function Legend() {
  return (
    <div className="lw-legend">
      {['kickoff', 'done', 'missed', 'unknown', 'later'].map((state) => (
        <span key={state} className={`lw-chip lw-chip--${state} lw-chip--static`}>
          {state === 'later'
            ? 'Coming up'
            : STATE_WORDS[state][0].toUpperCase() + STATE_WORDS[state].slice(1)}
        </span>
      ))}
    </div>
  );
}

/** One workspace's milestones, kickoff through decision, in a single row. */
function Timeline({ row }) {
  const { scheduled } = useMemo(() => timeline([row]), [row]);
  const [entry] = scheduled;
  if (!entry) return null;
  return (
    <div className="lw-scroll">
      <table className="lw-table lw-timeline lw-timeline--one">
        <thead>
          <tr>
            <th scope="col">Kickoff</th>
            <th scope="col">Day 1</th>
            <th scope="col">Day 3</th>
            <th scope="col">Day 7</th>
            <th scope="col">Day 14</th>
            <th scope="col">Decision</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <span className="lw-chip lw-chip--kickoff lw-chip--static">{entry.kickoff}</span>
            </td>
            {entry.columns.map((chips, index) => (
              <td key={index}>
                {chips.map((chip) => (
                  <div key={chip.label} className="lw-milestone">
                    <MilestoneChip chip={chip} />
                    <div className="lw-muted lw-small">{chip.sub}</div>
                  </div>
                ))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Calendar({ rows, onPick }) {
  const today = new Date();
  const [cursor, setCursor] = useState({
    year: today.getUTCFullYear(),
    month: today.getUTCMonth(),
  });
  const cells = useMemo(
    () => calendarCells(rows, cursor.year, cursor.month),
    [rows, cursor.year, cursor.month],
  );
  const shift = (delta) =>
    setCursor(({ year, month }) => {
      const next = new Date(Date.UTC(year, month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  return (
    <div>
      <div className="lw-cal-head">
        <h3>{monthName(cursor.year, cursor.month)}</h3>
        <button
          type="button"
          className="lw-icon-btn"
          aria-label="Previous month"
          onClick={() => shift(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="lw-icon-btn"
          aria-label="Next month"
          onClick={() => shift(1)}
        >
          ›
        </button>
        <button
          type="button"
          className="lw-btn lw-btn--ghost"
          onClick={() => setCursor({ year: today.getUTCFullYear(), month: today.getUTCMonth() })}
        >
          Today
        </button>
      </div>
      <div className="lw-scroll">
        <div className="lw-cal">
          {WEEKDAYS.map((day) => (
            <div key={day} className="lw-cal-dow">
              {day}
            </div>
          ))}
          {cells.map((cell) => (
            <div
              key={cell.key}
              className={`lw-cal-cell${cell.isToday ? ' is-today' : ''}${cell.isWeekend ? ' is-weekend' : ''}`}
            >
              <span className={`lw-cal-num${cell.inMonth ? '' : ' is-out'}`}>{cell.day}</span>
              {cell.events.map((event) => (
                <MilestoneChip
                  key={event.text}
                  chip={{
                    label: event.text,
                    state: event.state,
                    title: `${event.text}: ${STATE_WORDS[event.state]}`,
                  }}
                  onClick={onPick ? () => onPick(event.row.workspaceId) : undefined}
                />
              ))}
              {cell.more ? <span className="lw-muted lw-small">+{cell.more} more</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const EMPTY_FORM = {
  environmentId: '',
  segment: '',
  kickoffOn: '',
  pilotDays: '',
  linearIssue: '',
  ae: '',
  csm: '',
  failureOwner: '',
  metronomeAliases: '',
  clientBuildingTests: '',
  nextStep: '',
};

function formFor(row) {
  if (!row) return EMPTY_FORM;
  return {
    environmentId: row.environmentId || '',
    segment: row.segment || '',
    kickoffOn: row.kickoffOn ? row.kickoffOn.slice(0, 10) : '',
    pilotDays: row.pilotDays ?? '',
    linearIssue: row.linearIssue || '',
    ae: row.ae || '',
    csm: row.csm || '',
    failureOwner: row.failureOwner || '',
    clientBuildingTests:
      row.clientBuildingTests === true ? 'yes' : row.clientBuildingTests === false ? 'no' : '',
    nextStep: row.nextStep || '',
    metronomeAliases: row.metronomeAliases || '',
  };
}

/**
 * Old / New / None, the price a workspace is shown on. Saved per workspace,
 * so a customer on new pricing stays on it across reloads and for everyone.
 * Editors and CSMs switch it; anyone else sees the pick as a label.
 */
function PricingToggle({ pricing, onPick, label }) {
  return (
    <div className="lw-segmented lw-segmented--sm" role="group" aria-label={label}>
      {PRICINGS.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={pricing === p.id}
          title={p.label}
          onClick={() => onPick(p.id)}
        >
          {p.short}
        </button>
      ))}
    </div>
  );
}

/**
 * The card's usage: one line per week since kickoff (at most six, else the
 * last four), newest first, and their total, priced on the workspace's
 * picked pricing; then a button that copies last week's message for the CSM
 * to post. The toggle is the same saved pick as the row's: old by default,
 * since every customer signed before 10/19 is on it; "None" for trials.
 */
/**
 * Import billing's AI credits and test-building minutes: the by-week CSV
 * the Metronome usage script writes (run with --environment and --by-week).
 * Editors only. The server keeps weekly totals; the file's per-user rows and
 * emails are not stored.
 */
function MeteredImport({ row, onImported }) {
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const result = await importLoneWolvesMetered(
        row.workspaceId,
        row.environmentId,
        await file.text(),
      );
      const n = result.weeks?.length || 0;
      toast.success(`Imported ${n} week${n === 1 ? '' : 's'} of AI credits for ${row.name}.`);
      onImported();
    } catch (err) {
      toast.error(err?.message || 'The usage file could not be imported.');
    } finally {
      setBusy(false);
    }
  };
  if (!row.environmentId) return null;
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={pick}
        aria-label={`AI credits CSV for ${row.name}`}
      />
      <button
        type="button"
        className="lw-btn lw-btn--quiet"
        onClick={() => input.current?.click()}
        disabled={busy}
        title="The usage-by-week CSV from the Metronome usage script, run for this environment"
      >
        {busy ? 'Importing…' : 'Import AI credits CSV'}
      </button>
    </>
  );
}

const PULL_POLL_MS = 3000;

const METRONOME_APP = 'https://app.metronome.com';

/**
 * The steps for copying the code from a Metronome session, in plain words.
 * Only admins see them (MetronomeConnection); CSMs never touch Metronome.
 */
function MetronomeCodeSteps() {
  return (
    <ol className="lw-pull-steps">
      <li>
        Open{' '}
        <a href={METRONOME_APP} target="_blank" rel="noopener noreferrer">
          Metronome
        </a>{' '}
        and sign in.
      </li>
      <li>
        Open any customer and go to its <strong>Usage events</strong> page.
      </li>
      <li>
        Open your browser&apos;s developer tools: press <kbd>⌘</kbd> <kbd>Option</kbd> <kbd>I</kbd>{' '}
        on a Mac, or <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>I</kbd> on Windows.
      </li>
      <li>
        Click the <strong>Network</strong> tab and type <code>graphql</code> in its filter box. If
        the list is empty, refresh the page.
      </li>
      <li>
        Click any line. Under <strong>Headers</strong>, find <strong>authorization</strong> and copy
        the long code after the word Bearer.
      </li>
      <li>Paste it below and click Connect.</li>
    </ol>
  );
}

/**
 * The server's connection to Metronome, for admins: connect with the code
 * from a Metronome session (kept in the server's memory for about a day,
 * never saved), optionally pulling every card at once; or disconnect. With
 * it up, CSMs pull AI credits with one click.
 */
function MetronomeConnection({ metronome, onChanged }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [pullAll, setPullAll] = useState(true);
  const [busy, setBusy] = useState(false);

  const connect = async (event) => {
    event.preventDefault();
    const pasted = token;
    setToken('');
    setBusy(true);
    try {
      const { queued } = await connectMetronome(pasted, pullAll);
      setOpen(false);
      toast.success(
        queued
          ? `Connected to Metronome. Pulling AI credits for ${queued} customer${queued === 1 ? '' : 's'} in the background; their cards fill in as each finishes.`
          : 'Connected to Metronome. CSMs can now pull AI credits with one click.',
      );
      onChanged();
    } catch (err) {
      toast.error(err?.message || 'Metronome could not be connected.');
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    try {
      await disconnectMetronome();
      toast.info('Disconnected from Metronome.');
      onChanged();
    } catch (err) {
      toast.error(err?.message || 'Could not disconnect.');
    }
  };

  return (
    <div className={`lw-connection${metronome?.connected ? '' : ' lw-connection--off'}`}>
      <span className="lw-small">{metronomeConnectionLine(metronome)}</span>
      {!open ? (
        <span className="lw-connection-actions">
          <button type="button" className="lw-btn lw-btn--quiet" onClick={() => setOpen(true)}>
            {metronome?.connected ? 'Reconnect' : 'Connect Metronome'}
          </button>
          {metronome?.connected ? (
            <button type="button" className="lw-btn lw-btn--ghost" onClick={disconnect}>
              Disconnect
            </button>
          ) : null}
        </span>
      ) : (
        <form className="lw-pull-form" onSubmit={connect}>
          <h4>Connect SalesWolf to Metronome</h4>
          <p className="lw-small">
            CSMs can&apos;t sign in to Metronome, so SalesWolf borrows your session for the day.
            After this, anyone can click <strong>Get AI credits</strong> on a card. The code works
            for about a day; connect again when this box says it has run out.
          </p>
          <MetronomeCodeSteps />
          <label>
            Code from Metronome
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste the long code here"
              required
            />
          </label>
          <label className="lw-check">
            <input
              type="checkbox"
              checked={pullAll}
              onChange={(e) => setPullAll(e.target.checked)}
            />
            Pull AI credits for every customer now
          </label>
          <small className="lw-muted">
            SalesWolf keeps the code in memory only, never in its database or logs, and forgets it
            when it runs out. Please don&apos;t share it in Slack.
          </small>
          <div className="lw-form-actions">
            <button type="submit" className="lw-btn" disabled={busy || !token.trim()}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
            <button
              type="button"
              className="lw-btn lw-btn--ghost"
              onClick={() => {
                setToken('');
                setOpen(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Pull billing's AI credits from Metronome with one click, over the
 * server's connection (MetronomeConnection); nobody here sees Metronome.
 * The server reads the environment's usage in the background and the card
 * says which step of three it is on, then what came back or what to do
 * next. Needs the customer's Metronome ids, set in Edit details.
 */
function MetronomePull({ row, metronome, onImported }) {
  const toast = useToast();
  const [pull, setPull] = useState(null);
  const timer = useRef(null);

  const poll = useCallback(async () => {
    try {
      const { pull: status } = await fetchMetronomePull(row.workspaceId);
      setPull(status);
      if (status.state === 'running') {
        timer.current = setTimeout(poll, PULL_POLL_MS);
      } else if (status.state === 'done') {
        toast.success(`${row.name}'s AI credits are in.`);
        onImported();
      }
    } catch (err) {
      setPull({ state: 'failed', error: err?.message || 'Lost track of the pull.' });
    }
  }, [row.workspaceId, row.name, toast, onImported]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const start = async () => {
    try {
      const { pull: status } = await startMetronomePull(row.workspaceId, row.environmentId);
      setPull(status);
      timer.current = setTimeout(poll, PULL_POLL_MS);
    } catch (err) {
      if (err?.body?.code) setPull({ state: 'failed', errorCode: err.body.code });
      else toast.error(err?.message || 'The pull could not start.');
    }
  };

  if (!row.environmentId) return null;
  if (!row.metronomeAliases) {
    return (
      <span className="lw-muted lw-small">
        To bring in AI credits, add {row.name}&apos;s Metronome ids in Edit details first (Fahd or
        Henry can tell you what they are).
      </span>
    );
  }
  if (!metronome?.connected && pull?.state !== 'running') {
    return (
      <span className="lw-muted lw-small">
        AI credits can&apos;t be pulled right now: SalesWolf isn&apos;t connected to Metronome. Ask
        an admin to connect it at the top of this page.
      </span>
    );
  }
  const running = pull?.state === 'running';
  const progress = pullProgress(pull);
  const summary = pullSummary(pull);
  const failure = pullFailure(pull);
  return (
    <div className="lw-pull">
      <button
        type="button"
        className="lw-btn lw-btn--quiet"
        onClick={start}
        disabled={running}
        title={`Copies ${row.name}'s AI credits and test-building time from billing, week by week since kickoff`}
      >
        {running ? 'Getting AI credits…' : 'Get AI credits'}
      </button>
      {progress ? (
        <p className="lw-muted lw-small" role="status">
          {progress}. This usually takes a minute or two; you can leave this page open.
        </p>
      ) : null}
      {summary ? (
        <p className="lw-small" role="status">
          {summary}
        </p>
      ) : null}
      {failure ? (
        <div className="lw-warning lw-small" role="alert">
          <strong>{failure.title}</strong> {failure.next}
        </div>
      ) : null}
    </div>
  );
}

const oneDecimal = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US');

/** The old price's parts, for the cell's tooltip. */
function oldPriceTitle(week) {
  const parts = week.prices?.old?.parts;
  if (!parts) return 'Runner minutes only; no AI credits imported for this week.';
  return `Suite min ${formatMoney(parts.suite)} + building min ${formatMoney(parts.interactive)} + AI credits ${formatMoney(parts.ai)}`;
}

/** Where a week's minutes come from, for the Min cell's tooltip. */
function minutesTitle(week) {
  return week.metered
    ? `Billing's suite minutes (run records: ${oneDecimal(week.recordedMinutes)})`
    : 'Run records: suite runs, retries included';
}

function UsageSection({ row, pricing, onPickPricing, canPrice, canEdit, metronome, onImported }) {
  const toast = useToast();
  const usage = row.usage;
  if (!usage) return null;
  if (usage.error) {
    return (
      <div className="lw-card-section">
        <h3>Usage</h3>
        <p className="lw-muted">Could not be counted: {usage.error}</p>
      </div>
    );
  }
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
  const priced = pricing !== 'none';
  const weekLabel = (index) => (index === 0 ? 'This week' : index === 1 ? 'Last week' : null);
  const total = usage.total;
  // AI credits and test-building minutes only show once billing's numbers
  // were imported, and not on new pricing, which bills neither.
  const showMetered = pricing !== 'new' && (total?.meteredWeeks || 0) > 0;
  // Whether building minutes are billed on old pricing is unconfirmed, so
  // the old price also shows without them.
  const showWithoutBuilding = pricing === 'old' && showMetered;
  const meteredCell = (week, key) => (
    <td className="lw-num">{week.metered ? oneDecimal(week.metered[key]) : '—'}</td>
  );
  const withoutBuildingCell = (week) => {
    const amount = week.prices?.old?.withoutBuilding;
    return <td className="lw-num">{amount == null ? '—' : formatMoney(amount)}</td>;
  };
  const lastImport = (usage.weeks || [])
    .map((w) => w.metered?.importedAt)
    .filter(Boolean)
    .sort()
    .pop();
  return (
    <div className="lw-card-section">
      <div className="lw-usage-head">
        <h3>Usage{row.environmentName ? ` · ${row.environmentName}` : ''}</h3>
        {canPrice ? (
          <PricingToggle
            pricing={pricing}
            onPick={onPickPricing}
            label={`Pricing for ${row.name}`}
          />
        ) : (
          <span className="lw-readonly">
            {PRICINGS.find((p) => p.id === pricing)?.label || 'Old pricing'}
          </span>
        )}
      </div>
      <div className="lw-scroll">
        <table className="lw-usage-table">
          <thead>
            <tr>
              <th scope="col">Week of</th>
              <th scope="col" className="lw-num" title="Test runs">
                Tests
              </th>
              <th scope="col" className="lw-num">
                Min
              </th>
              <th scope="col" className="lw-num">
                Credits
              </th>
              {showMetered ? (
                <>
                  <th scope="col" className="lw-num" title="Runner minutes building tests">
                    Build min
                  </th>
                  <th scope="col" className="lw-num">
                    AI cr
                  </th>
                </>
              ) : null}
              {priced ? (
                <th scope="col" className="lw-num">
                  {pricing === 'old' ? 'Old $' : 'New $'}
                </th>
              ) : null}
              {showWithoutBuilding ? (
                <th
                  scope="col"
                  className="lw-num"
                  title="Old price leaving building minutes out (not yet confirmed whether they are billed)"
                >
                  Old $ no build
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {(usage.weeks || []).map((week, index) => (
              <tr key={week.weekStart}>
                <th scope="row">
                  {formatDay(week.weekStart)}
                  {weekLabel(index) ? (
                    <span className="lw-muted lw-week-label">{weekLabel(index)}</span>
                  ) : null}
                  {week.unfinished ? (
                    <span className="lw-muted" title={`${week.unfinished} attempts still running`}>
                      {' '}
                      …
                    </span>
                  ) : null}
                </th>
                <td className="lw-num">{week.flowRuns}</td>
                <td className="lw-num" title={minutesTitle(week)}>
                  {week.runnerMinutes}
                </td>
                <td className="lw-num">{week.credits}</td>
                {showMetered ? (
                  <>
                    {meteredCell(week, 'interactiveMinutes')}
                    {meteredCell(week, 'aiCredits')}
                  </>
                ) : null}
                {priced ? (
                  <td
                    className="lw-num"
                    title={pricing === 'old' ? oldPriceTitle(week) : undefined}
                  >
                    {formatMoney(week.prices[pricing].amount)}
                  </td>
                ) : null}
                {showWithoutBuilding ? withoutBuildingCell(week) : null}
              </tr>
            ))}
          </tbody>
          {total ? (
            <tfoot>
              <tr>
                <th scope="row">
                  {total.sinceKickoff ? 'Since kickoff' : `Last ${total.weekCount} weeks`}
                </th>
                <td className="lw-num">{total.flowRuns}</td>
                <td
                  className="lw-num"
                  title={total.metered ? "Billing's suite minutes where imported" : undefined}
                >
                  {total.runnerMinutes}
                </td>
                <td className="lw-num">{total.credits}</td>
                {showMetered ? (
                  <>
                    {meteredCell(total, 'interactiveMinutes')}
                    {meteredCell(total, 'aiCredits')}
                  </>
                ) : null}
                {priced ? (
                  <td
                    className="lw-num"
                    title={pricing === 'old' ? oldPriceTitle(total) : undefined}
                  >
                    {formatMoney(total.prices[pricing].amount)}
                  </td>
                ) : null}
                {showWithoutBuilding ? withoutBuildingCell(total) : null}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <p className="lw-muted lw-small">
        Weeks run Monday to Sunday (UTC).
        {pricing === 'old' && !showMetered
          ? ' Old pricing is $0.15 a runner minute; AI credits not included.'
          : ''}
        {pricing === 'old' && showMetered
          ? ' Old pricing is $0.15 a runner minute (running and building tests) plus $0.01 an AI credit.'
          : ''}
        {pricing === 'new' ? ' New pricing is $1 a run credit.' : ''}
        {showMetered
          ? ` Minutes, building minutes and AI credits are billing's numbers (QA Wolf staff not billed), imported for ${total.meteredWeeks} of ${total.weekCount} weeks${lastImport ? ` (last on ${formatDay(lastImport)})` : ''}; other weeks show run records' minutes and — for the rest.`
          : ''}
        {showWithoutBuilding
          ? ' Whether building minutes are billed on old pricing is not confirmed yet, so "Old $ no build" leaves them out.'
          : ''}
      </p>
      <div className="lw-card-actions">
        {usage.lastWeek ? (
          <button type="button" className="lw-btn lw-btn--ghost" onClick={copy}>
            Copy last week's usage
          </button>
        ) : null}
        {canEdit ? <MeteredImport row={row} onImported={onImported} /> : null}
      </div>
      {canPrice ? <MetronomePull row={row} metronome={metronome} onImported={onImported} /> : null}
    </div>
  );
}

/**
 * One workspace's own page: everything the list row leaves out, with room to
 * read it -- the scan's numbers, the first 30 days, usage week by week with
 * the AI-credit pull, and the details editors keep.
 */
function ClientPage({
  row,
  connection,
  onSaved,
  onHidden,
  pricing,
  onPickPricing,
  canEdit,
  canPrice,
  metronome,
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => formFor(row));
  const [saving, setSaving] = useState(false);
  // The CSM accounts, for the CSM picker; read once, when editing starts.
  const [csms, setCsms] = useState(null);

  useEffect(() => {
    setForm(formFor(row));
    setEditing(false);
  }, [row]);

  useEffect(() => {
    if (!editing || !canEdit || csms) return;
    fetchLoneWolvesCsms()
      .then((data) => setCsms(data.csms || []))
      .catch(() => setCsms([]));
  }, [editing, canEdit, csms]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      // The environment and kickoff are sent only when they changed: either
      // starts a rescan (usage is counted per environment, over the weeks
      // since kickoff), which an edit to the next step should not.
      const { environmentId, kickoffOn, ...rest } = form;
      await saveLoneWolvesDetails(row.workspaceId, {
        ...rest,
        ...(environmentId !== (row.environmentId || '') ? { environmentId } : {}),
        ...(kickoffOn !== (row.kickoffOn ? row.kickoffOn.slice(0, 10) : '') ? { kickoffOn } : {}),
        clientBuildingTests:
          form.clientBuildingTests === 'yes'
            ? true
            : form.clientBuildingTests === 'no'
              ? false
              : null,
      });
      toast.success(`Saved ${row.name}.`);
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(err?.message || 'The details could not be saved.');
    } finally {
      setSaving(false);
    }
  };
  const hide = async () => {
    if (!window.confirm(`Take ${row.name} off the page? Its recorded details are kept.`)) return;
    try {
      await saveLoneWolvesDetails(row.workspaceId, { hidden: true });
      toast.success(`${row.name} is off the page.`);
      onHidden();
    } catch (err) {
      toast.error(err?.message || 'It could not be hidden.');
    }
  };
  const ticket = linearUrl(row.linearIssue);
  const kickoff = row.kickoffOn
    ? `Kicked off ${formatDay(row.kickoffOn)}${row.pilotDays ? ` · ${row.pilotDays}-day pilot` : ''}`
    : 'No kickoff date recorded';
  const check = triggerCheck(row.triggers);

  return (
    <div className="lw-client-page">
      <header className="lw-header">
        <div>
          <Link className="lw-back" to={LIST_PATH}>
            ← All workspaces
          </Link>
          <div className="lw-overline">{segmentLabel(row.segment)}</div>
          <h1>{row.name}</h1>
          <p>
            {kickoff}
            {row.environmentName ? ` · counting the ${row.environmentName} environment` : ''}
          </p>
          <div className="lw-status">
            <span className={`lw-pill lw-status--${row.status.replace(/\s/g, '').toLowerCase()}`}>
              {row.status}
            </span>
            {ticket ? (
              <a className="lw-link" href={ticket} target="_blank" rel="noreferrer">
                {row.linearIssue}
              </a>
            ) : null}
          </div>
        </div>
        <div className="lw-actions">
          {canEdit && !editing ? (
            <button type="button" className="lw-btn" onClick={() => setEditing(true)}>
              Edit details
            </button>
          ) : null}
          {row.slug ? (
            <a
              className="lw-btn lw-btn--ghost"
              href={`https://app.qawolf.com/${encodeURIComponent(row.slug)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in QA Wolf
            </a>
          ) : null}
          {canEdit ? (
            <button type="button" className="lw-btn lw-btn--quiet" onClick={hide}>
              Hide
            </button>
          ) : null}
        </div>
      </header>

      <section className="lw-tiles lw-tiles--client" aria-label={`${row.name} today`}>
        <Tile
          label="Day"
          value={row.day == null ? '—' : row.day}
          sub={`${doneCount(row.activation)} of 6 steps done${row.pilotDays ? ` · ${row.pilotDays}-day pilot` : ''}`}
        />
        <Tile
          label="Flows active / draft"
          value={row.flows ? `${row.flows.active} / ${row.flows.draft}` : '—'}
        />
        <Tile label="Runs (24h)" value={row.runs?.total ?? '—'} sub={describeRuns(row.runs)} />
        <Tile
          label="Triggers"
          value={row.triggers?.count ?? '—'}
          sub={check.text}
          tone={check.tone === 'bad' ? 'bad' : undefined}
        />
        <Tile
          label="Open bugs"
          value={row.bugs?.open ?? '—'}
          sub={
            row.bugs
              ? `${row.bugs.unprioritized} unprioritized${row.bugs.spike ? ` · +${row.bugs.newToday} in a day` : ''}`
              : null
          }
          tone={row.bugs?.spike ? 'bad' : undefined}
        />
        <Tile
          label="Environment"
          value={environmentLabel(row.environment?.status)}
          sub={row.environmentName}
          tone={row.environment?.status === 'blocked' ? 'bad' : undefined}
        />
      </section>

      {row.reason ? (
        <div className="lw-card-flag">
          <h3>What the scan found</h3>
          <p>{row.reason}</p>
        </div>
      ) : null}

      {editing ? (
        <section className="lw-card">
          <h2>Edit {row.name}</h2>
          <form className="lw-form lw-form--page" onSubmit={save}>
            {row.environments?.length ? (
              <label className="lw-form-wide">
                Environment to count
                <select value={form.environmentId} onChange={set('environmentId')}>
                  {row.environments.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name}
                      {env.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              Type
              <select value={form.segment} onChange={set('segment')}>
                {Object.entries(SEGMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Kickoff
              <input type="date" value={form.kickoffOn} onChange={set('kickoffOn')} />
            </label>
            <label>
              Pilot length (days)
              <input
                type="number"
                min="1"
                max="365"
                value={form.pilotDays}
                onChange={set('pilotDays')}
              />
            </label>
            <label>
              Linear ticket
              <input
                placeholder="AXO-1275"
                value={form.linearIssue}
                onChange={set('linearIssue')}
              />
            </label>
            <label>
              AE
              <input value={form.ae} onChange={set('ae')} />
            </label>
            <label>
              CSM
              <select value={form.csm} onChange={set('csm')}>
                <option value="">Not assigned</option>
                {(csms || []).map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
                {/* A name typed before the picker existed stays selectable. */}
                {form.csm && !(csms || []).some((c) => c.name === form.csm) ? (
                  <option value={form.csm}>{form.csm}</option>
                ) : null}
              </select>
            </label>
            <label>
              Failure owner
              <input
                placeholder="Who reviews failures"
                value={form.failureOwner}
                onChange={set('failureOwner')}
              />
            </label>
            <label>
              Client building tests
              <select value={form.clientBuildingTests} onChange={set('clientBuildingTests')}>
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">Not yet</option>
              </select>
            </label>
            <label className="lw-form-wide">
              Next step
              <textarea rows={3} value={form.nextStep} onChange={set('nextStep')} />
            </label>
            <label className="lw-form-wide">
              Metronome ids
              <input
                value={form.metronomeAliases}
                onChange={set('metronomeAliases')}
                placeholder="org_…, …org, Metronome customer id"
              />
              <small className="lw-muted">
                The ids on the customer&apos;s Metronome page, comma-separated. Needed to pull AI
                credits.
              </small>
            </label>
            <div className="lw-form-actions">
              <button type="submit" className="lw-btn" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="lw-btn lw-btn--ghost"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {/* An admin's Metronome connection, which Get AI credits below uses. */}
      {connection}

      <div className="lw-client-grid">
        <div className="lw-client-side">
          <section className="lw-card">
            <h3>First 30 days</h3>
            <div>
              {activationList(row.activation).map((step) => (
                <div key={step.label} className="lw-step">
                  <span aria-hidden="true" className={`lw-dot lw-dot--${step.flag}`} />
                  <span className="lw-step-label">{step.label}</span>
                  <span className="lw-muted lw-small">{step.word}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="lw-card">
            <h3>People</h3>
            <dl className="lw-people">
              <div>
                <dt>AE</dt>
                <dd>{row.ae || '—'}</dd>
              </div>
              <div>
                <dt>CSM</dt>
                <dd>{row.csm || '—'}</dd>
              </div>
              <div>
                <dt>Failure owner</dt>
                <dd>{row.failureOwner || '—'}</dd>
              </div>
              <div>
                <dt>Listed by</dt>
                <dd>{row.source === 'manual' ? 'Added by hand' : 'SelfService team'}</dd>
              </div>
            </dl>
          </section>
          {row.nextStep ? (
            <section className="lw-card">
              <h3>Next step</h3>
              <p>{row.nextStep}</p>
            </section>
          ) : null}
          {!canEdit ? (
            <p className="lw-readonly">
              {canPrice
                ? 'You can switch the pricing; Becca and Kyla change the other details.'
                : 'View only. Becca and Kyla can change these details.'}
            </p>
          ) : null}
        </div>
        <section className="lw-card lw-client-usage">
          <UsageSection
            row={row}
            pricing={pricing}
            onPickPricing={onPickPricing}
            canPrice={canPrice}
            canEdit={canEdit}
            metronome={metronome}
            onImported={onSaved}
          />
          {!row.usage ? <p className="lw-muted">No usage counted yet.</p> : null}
        </section>
      </div>

      <section className="lw-panel" aria-labelledby="lw-client-cal-title">
        <div className="lw-panel-head">
          <div className="lw-panel-title">
            <h2 id="lw-client-cal-title">Milestones from kickoff</h2>
          </div>
          <Legend />
        </div>
        {row.milestones ? (
          <>
            <Timeline row={row} />
            <Calendar rows={[row]} />
            <p className="lw-footnote">
              Targets from kickoff: first flow day 1 · customer-started run and daily run day 3 ·
              first bug day 7 · failure owner and client-built tests day 14 · decision at pilot end
              (day 30 when no length is recorded; none for hybrid workspaces). Missed means the
              target date passed without the step.
            </p>
          </>
        ) : (
          <p className="lw-hint">
            No kickoff date recorded. Set one with Edit to put its milestones on the timeline.
          </p>
        )}
      </section>
    </div>
  );
}

const EMPTY_ADD = { workspaceId: '', workspaceName: '', segment: 'pilot', environmentId: '' };

/**
 * Add a workspace by id. Once the id is entered, its environments are read
 * live from QA Wolf so the one to count can be picked now; it starts on the
 * workspace's default.
 */
function AddWorkspace({ onAdded }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_ADD);
  const [environments, setEnvironments] = useState(null);
  const [loadingEnvs, setLoadingEnvs] = useState(false);
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const loadEnvironments = async () => {
    const id = form.workspaceId.trim();
    if (!id) return;
    setLoadingEnvs(true);
    try {
      const data = await fetchLoneWolvesEnvironments(id);
      setEnvironments(data.environments);
      setForm((f) => ({
        ...f,
        environmentId: data.defaultEnvironmentId || data.environments[0]?.id || '',
      }));
    } catch (err) {
      setEnvironments(null);
      toast.error(err?.message || 'That workspace’s environments could not be read.');
    } finally {
      setLoadingEnvs(false);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    try {
      await addLoneWolvesWorkspace({ ...form, workspaceId: form.workspaceId.trim() });
      toast.success(`Added ${form.workspaceName || form.workspaceId}; it is being scanned.`);
      setOpen(false);
      setForm(EMPTY_ADD);
      setEnvironments(null);
      onAdded();
    } catch (err) {
      toast.error(err?.message || 'The workspace could not be added.');
    }
  };
  if (!open) {
    return (
      <button type="button" className="lw-btn lw-btn--ghost" onClick={() => setOpen(true)}>
        Add workspace
      </button>
    );
  }
  return (
    <form className="lw-add" onSubmit={submit}>
      <label>
        Workspace id
        <input
          required
          value={form.workspaceId}
          onChange={set('workspaceId')}
          onBlur={loadEnvironments}
          placeholder="clsizdlgk0ikr7w013qfl02ib"
        />
      </label>
      <label>
        Environment to count
        <select
          value={form.environmentId}
          onChange={set('environmentId')}
          disabled={!environments?.length}
        >
          {environments?.length ? (
            environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
                {env.isDefault ? ' (default)' : ''}
              </option>
            ))
          ) : (
            <option value="">{loadingEnvs ? 'Reading…' : 'Enter the id first'}</option>
          )}
        </select>
      </label>
      <label>
        Name
        <input
          value={form.workspaceName}
          onChange={set('workspaceName')}
          placeholder="Panorama Education"
        />
      </label>
      <label>
        Type
        <select value={form.segment} onChange={set('segment')}>
          {Object.entries(SEGMENT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="lw-btn">
        Add
      </button>
      <button type="button" className="lw-btn lw-btn--ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

export default function LoneWolves() {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  // On /projects/lone-wolves/:workspaceId the page is that workspace's own.
  const { workspaceId } = useParams();
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const stopped = useRef(false);

  const load = useCallback(async (options) => {
    try {
      const data = await fetchLoneWolves(options);
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
      // A failed read retries every half minute rather than hammering the server.
      const busy = data && (data.status === 'building' || data.refreshing);
      timer = setTimeout(tick, busy ? POLL_MS : data ? IDLE_POLL_MS : ERROR_POLL_MS);
    };
    tick();
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [load]);

  const rows = useMemo(() => payload?.rows || [], [payload]);
  // Editors (admins and the CSM lead) change things; CSMs switch pricing
  // too; everyone else reads. The server says which and enforces it.
  const canEdit = Boolean(payload?.canEdit);
  const canPrice = Boolean(payload?.canPrice);
  const metronome = payload?.metronome || null;
  const canConnectMetronome = Boolean(payload?.canConnectMetronome);
  const visible = useMemo(() => filterRows(rows, filter), [rows, filter]);
  const counts = useMemo(() => filterCounts(rows), [rows]);
  const open = (id) => navigate(clientPath(id));

  // A pricing pick shows at once and is saved behind it; a failed save
  // puts the row back and says so.
  const [pricingPicks, setPricingPicks] = useState({});
  const pricingFor = (row) => pricingPicks[row.workspaceId] || row.pricing || 'old';
  const pickPricing = async (row, pricing) => {
    const before = pricingFor(row);
    if (pricing === before) return;
    setPricingPicks((picks) => ({ ...picks, [row.workspaceId]: pricing }));
    try {
      await saveLoneWolvesDetails(row.workspaceId, { pricing });
      await load();
    } catch (err) {
      setPricingPicks((picks) => ({ ...picks, [row.workspaceId]: before }));
      toast.error(err?.message || `${row.name}'s pricing could not be saved.`);
    }
  };

  // Older links (the CSM dashboard's, before workspaces had pages) name the
  // workspace in ?workspace=; they open its page.
  const linked = new URLSearchParams(location.search).get('workspace');
  if (!workspaceId && linked) return <Navigate to={clientPath(linked)} replace />;

  const connection =
    canConnectMetronome && payload?.status === 'ready' ? (
      <MetronomeConnection metronome={metronome} onChanged={() => load()} />
    ) : null;

  const rescan = async () => {
    try {
      await rescanLoneWolves();
      toast.info('Rescanning every workspace.');
      load();
    } catch (err) {
      const wait = err?.body?.retryAfterMs;
      toast.info(
        wait ? `A scan ran moments ago; try again in ${Math.ceil(wait / 1000)}s.` : err.message,
      );
    }
  };
  const copyPulse = async () => {
    try {
      await navigator.clipboard.writeText(slackPulse(rows, payload.summary, payload.builtAt));
      toast.success('Slack pulse copied.');
    } catch {
      toast.error('Could not copy to the clipboard.');
    }
  };
  const exportCsv = () =>
    downloadText(`lone-wolves-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(rows));

  if (workspaceId) {
    const row = rows.find((r) => r.workspaceId === workspaceId);
    if (!row) {
      return (
        <div className="lone-wolves">
          <Link className="lw-back" to={LIST_PATH}>
            ← All workspaces
          </Link>
          {error ? (
            <div className="lw-warning">{error.message}</div>
          ) : !payload || payload.status === 'building' ? (
            <div className="lw-hint">Scanning the onboarding workspaces… this takes a minute.</div>
          ) : (
            <div className="lw-hint">
              That workspace isn&apos;t on Lone Wolves. It may have been hidden or taken off the
              SelfService team.
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="lone-wolves">
        <ClientPage
          row={row}
          connection={connection}
          onSaved={() => load()}
          onHidden={() => {
            load();
            navigate(LIST_PATH);
          }}
          pricing={pricingFor(row)}
          onPickPricing={(pricing) => pickPricing(row, pricing)}
          canEdit={canEdit}
          canPrice={canPrice}
          metronome={metronome}
        />
      </div>
    );
  }

  const header = (
    <header className="lw-header">
      <div>
        <div className="lw-overline">Self-serve onboarding</div>
        <h1>Lone Wolves</h1>
        <p>
          Every self-serve, custom-contract and pilot workspace, and how far each is from its first
          real win. Stalled workspaces sort to the top.
        </p>
        {payload?.status === 'ready' ? (
          <div className="lw-status">
            <span className="lw-status-live">
              ● Scanned {new Date(payload.builtAt).toLocaleString()}
              {payload.refreshing ? ' · rescanning…' : ''}
            </span>
            <span>{payload.summary.total} workspaces</span>
            <span>{payload.taskWolf ? 'Task Wolf connected' : 'Task Wolf not connected'}</span>
          </div>
        ) : null}
        {connection}
      </div>
      <div className="lw-actions">
        {canEdit ? <AddWorkspace onAdded={() => load()} /> : null}
        <button
          type="button"
          className="lw-btn lw-btn--ghost"
          onClick={copyPulse}
          disabled={!rows.length}
        >
          Copy Slack pulse
        </button>
        <button
          type="button"
          className="lw-btn lw-btn--ghost"
          onClick={exportCsv}
          disabled={!rows.length}
        >
          Export CSV
        </button>
        {canEdit ? (
          <button type="button" className="lw-btn" onClick={rescan}>
            Rescan
          </button>
        ) : null}
      </div>
    </header>
  );

  if (!payload || payload.status === 'building') {
    return (
      <div className="lone-wolves">
        {header}
        {error ? (
          <div className="lw-warning">{error.message}</div>
        ) : (
          <div className="lw-hint">Scanning the onboarding workspaces… this takes a minute.</div>
        )}
      </div>
    );
  }

  const { summary } = payload;
  const mix = Object.entries(summary.bySegment)
    .filter(([, n]) => n > 0)
    .map(([segment, n]) => `${n} ${segmentLabel(segment).toLowerCase()}`)
    .join(' · ');

  return (
    <div className="lone-wolves">
      {header}
      {payload.refreshError ? (
        <div className="lw-warning">The last rescan failed: {payload.refreshError}</div>
      ) : null}
      {(payload.warnings || []).map((warning) => (
        <div key={warning} className="lw-hint">
          {warning}
        </div>
      ))}

      <section className="lw-tiles" aria-label="Summary">
        <Tile label="Workspaces onboarding" value={summary.total} sub={mix} />
        <Tile
          label="Stalled"
          value={summary.stalled}
          sub="no flows, or no runs for a week"
          tone="bad"
        />
        <Tile
          label="Runs all failing (24h)"
          value={summary.dailyBad}
          sub={summary.dailyBadNames.join(', ') || 'none'}
        />
        <Tile
          label="Environments blocked"
          value={summary.blocked}
          sub="nobody can run against them"
        />
      </section>

      <div className="lw-filters" role="group" aria-label="Filter workspaces">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            className="lw-filter"
            onClick={() => setFilter(f.id)}
          >
            {f.label} <span>{counts[f.id]}</span>
          </button>
        ))}
      </div>

      <section className="lw-panel lw-health">
        <div className="lw-panel-head">
          <h2>Onboarding health</h2>
          <span className="lw-muted lw-small">
            Open a workspace for its flows, triggers, bugs, usage and details
          </span>
        </div>
        <div className="lw-scroll">
          <table className="lw-table lw-table--rows">
            <thead>
              <tr>
                <th scope="col">Workspace</th>
                <th scope="col">Day</th>
                <th scope="col">Activation</th>
                <th scope="col">Runs 24h</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="lw-sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.workspaceId}
                  className="lw-row-link"
                  onClick={() => open(row.workspaceId)}
                >
                  <td>
                    <Link
                      className="lw-name"
                      to={clientPath(row.workspaceId)}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {row.name}
                    </Link>
                    <div className="lw-muted lw-small">
                      {segmentLabel(row.segment)}
                      {row.csm ? ` · ${row.csm}` : ''}
                    </div>
                  </td>
                  <td className="lw-nowrap">{dayLabel(row)}</td>
                  <td>
                    <StepDots activation={row.activation} />
                    <div className="lw-muted lw-small">{doneCount(row.activation)} of 6</div>
                  </td>
                  <td className="lw-nowrap">{describeRuns(row.runs)}</td>
                  <td>
                    <span
                      className={`lw-pill lw-status--${row.status.replace(/\s/g, '').toLowerCase()}`}
                      title={row.reason || undefined}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="lw-chevron" aria-hidden="true">
                    ›
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="lw-panel-foot lw-muted lw-small">
          Showing {visible.length} of {rows.length} · QA Wolf (flows, runs, environments, triggers,
          bugs) + Task Wolf (SelfService team, customer runs)
        </div>
      </section>
    </div>
  );
}
