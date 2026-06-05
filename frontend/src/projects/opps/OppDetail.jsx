import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  getOpp,
  updateOpp,
  deleteOpp,
  searchOpportunities,
  fetchGongConversations,
  sendOppToNotion,
} from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import EditableTextArea from './components/EditableTextArea';
import EditableField from './components/EditableField';
import LinearTicketsCard from './components/LinearTicketsCard';
import OppSalesforceCard from './components/OppSalesforceCard';
import OppGongCard from './components/OppGongCard';
import SalesEngineerPicker from './components/SalesEngineerPicker';
import GongInsightsModal from './components/GongInsightsModal';
import '../salesforce/lookup/SalesforceLookup.css';
import './opps.less';

/**
 * Opp handoff page.
 *
 * Three visual columns once everything is loaded:
 *   - Hero: opp name + owning SE + read-only pill (non-owners)
 *   - Left: properties (CSM / QA Lead / etc.), Technical Specs, Notes,
 *     Pain Points + any custom sections, all editable for owners only.
 *   - Right: linked Linear tickets, then the Salesforce + Gong card.
 *
 * SF data is hydrated client-side via the existing searchOpportunities
 * endpoint -- we re-use the same payload the Lookup page renders so the
 * two views stay byte-identical.
 */

// QAE team roster as it appears in the internal QAW tracker. Kept in
// the FE because it changes infrequently and we want the dropdown to be
// usable even when offline from Notion. Order matches the QAW UI.
const QAW_TEAMS = [
  'Alpacas',
  'Badgers',
  'Cats',
  'Eagles',
  'Frogs',
  'Gnus',
  'Hammerheads',
  'Koalas',
  'Lemurs',
  'Mustangs',
  'Narwhals',
  'Ocelots',
  'Penguins',
  'Quokkas',
  'Raccoons',
  'Salamanders',
  'Tigers',
  'Unicorns',
  'Vicunas',
  'Whales',
];

// QA Managers the SE can assign on the handoff. Kept inline (like
// QAW_TEAMS) since the roster is tiny and changes rarely; if it grows or
// needs to vary per environment we can move it behind an endpoint.
const QA_MANAGERS = ['Sam Lalli', 'Jordan Teander'];

function fullSeName(se) {
  if (!se) return 'Unowned';
  const parts = [se.firstName, se.lastName].filter(Boolean);
  return parts.length ? parts.join(' ') : se.email || 'Unknown SE';
}

// Try to find the SF opportunity record for this Opp. We prefer the stored
// salesforceOpportunityId match; if that's missing or stale we fall back to
// the first search result whose id matches, then to the first record at all
// (best-effort -- the SE can re-link via the SF lookup if it's wrong).
function pickSalesforceMatch(records, salesforceOpportunityId) {
  if (!Array.isArray(records) || records.length === 0) return null;
  if (salesforceOpportunityId) {
    const exact = records.find((r) => r.id === salesforceOpportunityId);
    if (exact) return exact;
  }
  return records[0];
}

function OppDetail() {
  const { oppId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [sfData, setSfData] = useState(null);
  const [sfLoading, setSfLoading] = useState(false);
  // Notion send state. Idle by default; flips to 'sending' while the
  // backend POST is in flight, then back to idle on success/failure with
  // an inline message so the SE knows what happened without a toast.
  const [notionStatus, setNotionStatus] = useState('idle');
  const [notionMessage, setNotionMessage] = useState('');
  // "Suggest from calls" review panel.
  const [insightsOpen, setInsightsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getOpp(oppId);
      setData(res);
    } catch (err) {
      setError(err.message || 'Failed to load Opp');
    } finally {
      setLoading(false);
    }
  }, [oppId]);

  useEffect(() => {
    load();
  }, [load]);

  // Hydrate SF data once we know the opp name. Failures are silent so the
  // handoff page still renders when SF is down or the opp name doesn't
  // match anything in SF (e.g. fresh prospect that hasn't been logged).
  useEffect(() => {
    if (!data?.opp?.oppName) return;
    let cancelled = false;
    const run = async () => {
      setSfLoading(true);
      try {
        const res = await searchOpportunities(data.opp.oppName);
        if (cancelled) return;
        if (res.success) {
          setSfData(pickSalesforceMatch(res.data || [], data.opp.salesforceOpportunityId));
        }
      } catch {
        // Silently degrade -- SF outage shouldn't block the handoff page.
      } finally {
        if (!cancelled) setSfLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [data?.opp?.oppName, data?.opp?.salesforceOpportunityId]);

  // Snapshot the SF stage back to our DB so the Hunt Board directory can
  // render a stage pill without doing per-row SF queries. Fires once SF
  // hydrates and only when the snapshot is stale, so it's effectively a
  // no-op for repeat visits.
  useEffect(() => {
    const opp = data?.opp;
    if (!opp || !sfData) return;
    const sfStage = sfData.stage || null;
    if (sfStage === (opp.currentStage || null)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await updateOpp(opp.id, { currentStage: sfStage });
        if (!cancelled && res?.opp) {
          // Merge just the stage fields back -- avoid clobbering any
          // other in-flight edits the SE might be making.
          setData((d) =>
            d
              ? {
                  ...d,
                  opp: {
                    ...d.opp,
                    currentStage: res.opp.currentStage,
                    stageSyncedAt: res.opp.stageSyncedAt,
                  },
                }
              : d,
          );
        }
      } catch {
        // Best-effort cache refresh; the SF card still shows the live stage.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data?.opp, sfData]);

  // PATCH helper. Optimistically applies the patch to local state so the
  // UI feels instant; rolls back + surfaces an error on failure. Returns
  // a promise so EditableTextArea/Field can chain "saved" status off it.
  const patch = useCallback(
    async (delta) => {
      if (!data?.opp) return;
      const previous = data.opp;
      const next = { ...previous, ...delta };
      setData((d) => ({ ...d, opp: next }));
      try {
        const res = await updateOpp(previous.id, delta);
        setData((d) => ({ ...d, opp: res.opp }));
      } catch (err) {
        setData((d) => ({ ...d, opp: previous }));
        throw err;
      }
    },
    [data?.opp],
  );

  // Status text rolls onto the header after each save attempt. We share
  // one slot across every editable section because two saves in flight
  // simultaneously would race anyway; sequencing is enforced by debounce.
  const onSaveStatus = useCallback((status, message) => {
    if (status === 'saving') setSaveStatus('Saving…');
    else if (status === 'saved') setSaveStatus('All changes saved');
    else if (status === 'typing') setSaveStatus('Editing…');
    else if (status === 'error') setSaveStatus(`Error: ${message || 'save failed'}`);
  }, []);

  const opp = data?.opp;
  const linearTickets = data?.linearTickets;
  const canEdit = !!opp?.canEdit;

  // Memoize technical-specs editor wiring -- it's a structured object, not
  // a string, and patch() needs to send the full updated blob each time.
  // Memoizing techSpecs itself avoids invalidating patchTechSpecs on every
  // render (lint requires the dependency to be a stable identity).
  const techSpecs = useMemo(() => opp?.technicalSpecs || {}, [opp?.technicalSpecs]);
  const patchTechSpecs = useCallback(
    (key) => (value) => patch({ technicalSpecs: { ...techSpecs, [key]: value } }),
    [patch, techSpecs],
  );

  // Custom sections live as `[ { id, title, bodyMarkdown, order } ]` in
  // JSON. Pain Points is pre-seeded by the backend, so it's always first.
  const customSections = useMemo(() => opp?.customSections || [], [opp?.customSections]);
  const patchCustomSection = useCallback(
    (id) => async (next) => {
      const updated = customSections.map((s) => (s.id === id ? { ...s, bodyMarkdown: next } : s));
      await patch({ customSections: updated });
    },
    [customSections, patch],
  );
  const addCustomSection = useCallback(async () => {
    const id = `section-${Date.now()}`;
    const next = [
      ...customSections,
      { id, title: 'New Section', bodyMarkdown: '', order: customSections.length },
    ];
    await patch({ customSections: next });
  }, [customSections, patch]);
  const renameCustomSection = useCallback(
    (id) => async (next) => {
      const updated = customSections.map((s) => (s.id === id ? { ...s, title: next } : s));
      await patch({ customSections: updated });
    },
    [customSections, patch],
  );
  const removeCustomSection = useCallback(
    async (id) => {
      const updated = customSections.filter((s) => s.id !== id);
      await patch({ customSections: updated });
    },
    [customSections, patch],
  );

  // The most-relevant linked Linear ticket for each handoff section.
  // We prefer open over closed (sort order from the backend) and pick the
  // top of each category bucket. Used to surface the AE's Slack request
  // thread directly in the Creation / Estimation sections without making
  // the SE bounce out to the linked-tickets card.
  const primaryCreationTicket = useMemo(() => {
    const list = linearTickets?.creation || [];
    return list.find((t) => !t.isClosed) || list[0] || null;
  }, [linearTickets?.creation]);
  const primaryScopeTicket = useMemo(() => {
    const list = linearTickets?.scope || [];
    return list.find((t) => !t.isClosed) || list[0] || null;
  }, [linearTickets?.scope]);

  // Creation handoff (demo workspace + flows). Same JSON-blob pattern as
  // technicalSpecs / customSections so PATCH sends the full updated shape.
  const creation = useMemo(
    () => opp?.creation || { demoWorkspaceUrl: '', flows: [] },
    [opp?.creation],
  );
  const patchCreation = useCallback(
    (delta) => patch({ creation: { ...creation, ...delta } }),
    [creation, patch],
  );
  const patchFlow = useCallback(
    (id, delta) =>
      patchCreation({
        flows: (creation.flows || []).map((f) => (f.id === id ? { ...f, ...delta } : f)),
      }),
    [creation.flows, patchCreation],
  );
  const addFlow = useCallback(() => {
    const next = [...(creation.flows || []), { id: `flow-${Date.now()}`, name: '', url: '' }];
    return patchCreation({ flows: next });
  }, [creation.flows, patchCreation]);
  const removeFlow = useCallback(
    (id) =>
      patchCreation({
        flows: (creation.flows || []).filter((f) => f.id !== id),
      }),
    [creation.flows, patchCreation],
  );

  // Estimation handoff. `type` switches between ratio (gets a doc URL)
  // and exploratory (gets free-form notes). Both keep `spreadsheetUrl`.
  const estimation = useMemo(
    () =>
      opp?.estimation || {
        type: null,
        ratioDocUrl: '',
        exploratoryNotes: '',
        spreadsheetUrl: '',
      },
    [opp?.estimation],
  );
  const patchEstimation = useCallback(
    (delta) => patch({ estimation: { ...estimation, ...delta } }),
    [estimation, patch],
  );

  // Apply a Claude-suggested insight from the "Suggest from calls" panel
  // into the matching handoff field. `mode` is 'append' (merge under any
  // existing content) or 'replace'. Returns a promise so the modal can
  // surface per-card saved/error state.
  const applyInsight = useCallback(
    (field, mode, value) => {
      const merge = (existing) => {
        const add = (value || '').trim();
        if (mode === 'replace') return add;
        const cur = (existing || '').trim();
        return cur ? `${cur}\n\n${add}` : add;
      };
      if (field === 'integrations') {
        return patch({
          technicalSpecs: { ...techSpecs, integrations: merge(techSpecs.integrations) },
        });
      }
      if (field === 'notes') {
        return patch({ notesMarkdown: merge(opp?.notesMarkdown) });
      }
      if (field === 'painPoints') {
        const sections = customSections;
        const idx = sections.findIndex(
          (s) => (s.title || '').trim().toLowerCase() === 'pain points',
        );
        if (idx === -1) {
          // No Pain Points section (shouldn't happen -- it's seeded on
          // create -- but be defensive): add one.
          const next = [
            ...sections,
            {
              id: `pain-points-${Date.now()}`,
              title: 'Pain Points',
              bodyMarkdown: merge(''),
              order: sections.length,
            },
          ];
          return patch({ customSections: next });
        }
        const next = sections.map((s, i) =>
          i === idx ? { ...s, bodyMarkdown: merge(s.bodyMarkdown) } : s,
        );
        return patch({ customSections: next });
      }
      return Promise.resolve();
    },
    [patch, techSpecs, opp?.notesMarkdown, customSections],
  );

  // Auto-detect the estimation type from the linked scoping ticket so the
  // SE doesn't have to re-pick something the AE already specified in
  // Linear. Title-based: "Exploratory Estimation - ..." -> exploratory;
  // "Ratio Scope/Scoping/Estimation - ..." -> ratio. Only fires when the
  // SE hasn't explicitly chosen a type yet (estimation.type is null) so
  // we never overwrite an intentional pick.
  useEffect(() => {
    if (!opp || !primaryScopeTicket) return;
    if (estimation.type) return;
    const title = (primaryScopeTicket.title || '').toLowerCase();
    let inferred = null;
    if (/(?:exploratory|exploration)\s+estimation/.test(title)) inferred = 'exploratory';
    else if (/ratio\s+(?:estimation|scoping|scope)/.test(title)) inferred = 'ratio';
    if (!inferred) return;
    patchEstimation({ type: inferred }).catch(() => {
      // Silent: this is a courtesy auto-fill, not a primary action. If
      // the PATCH fails the SE can still pick manually.
    });
    // We intentionally don't depend on patchEstimation/estimation here --
    // those identities change every render and would re-trigger this
    // effect forever. The guard on estimation.type above is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryScopeTicket?.id, opp?.id, estimation.type]);

  // Hard-delete the Opp. Gated client-side to the owning SE or admin so
  // Leads (who can edit-on-behalf) don't see the button at all; the
  // backend re-checks. After delete we navigate back to the directory
  // since the detail page no longer exists.
  const isAdmin = (user?.roles || []).includes('admin');
  const isOwner = !!(
    user?.id &&
    opp?.salesEngineer?.userId &&
    opp.salesEngineer.userId === user.id
  );
  const canDelete = isAdmin || isOwner;

  const handleDelete = useCallback(async () => {
    if (!opp) return;
    const confirmed = window.confirm(
      `Delete "${opp.oppName}"? This permanently removes the Hunt Board page and all SE-authored notes. The Notion page (if any) stays in Notion.`,
    );
    if (!confirmed) return;
    try {
      await deleteOpp(opp.id);
      navigate('/projects/opps');
    } catch (err) {
      window.alert(err?.message || 'Failed to delete Opp');
    }
  }, [opp, navigate]);

  // Send to Notion. We fetch Gong calls right here (with their summaries)
  // rather than lifting state from OppGongCard so the page-build is
  // self-contained -- click -> fetch gongs -> POST to backend -> backend
  // creates the Notion page and persists the URL on the Opp. On success
  // we surface a short "Sent" message and the button flips to
  // "Open in Notion" via the freshly-returned opp payload.
  const sendToNotion = useCallback(async () => {
    if (!opp) return;
    const wasLinked = !!opp.notionPageUrl;
    setNotionStatus('sending');
    setNotionMessage('');
    try {
      let gongConversations = [];
      if (sfData?.id) {
        try {
          const res = await fetchGongConversations(sfData.id);
          if (res?.success) gongConversations = res.data || [];
        } catch {
          // Gong unavailable -- ship the page without summaries rather
          // than blocking on a non-critical data source.
        }
      }
      const result = await sendOppToNotion(opp.id, {
        sfData,
        gongConversations,
        linearTickets,
      });
      setData((d) => ({ ...d, opp: result.opp }));
      setNotionStatus('idle');
      // Prefer the server's action label ("updated" / "recreated" /
      // "created") so the message is accurate even when our local
      // wasLinked guess is stale; fall back to the guess otherwise.
      const action = result.action || (wasLinked ? 'updated' : 'created');
      const label =
        action === 'updated'
          ? 'Updated in Notion'
          : action === 'recreated'
            ? 'Recreated in Notion'
            : 'Sent to Notion';
      setNotionMessage(label);
      setTimeout(() => setNotionMessage(''), 3000);
    } catch (err) {
      setNotionStatus('idle');
      setNotionMessage(err?.message || 'Failed to sync to Notion');
      setTimeout(() => setNotionMessage(''), 5000);
    }
  }, [opp, sfData, linearTickets]);

  if (loading) {
    return (
      <div className="opps-page">
        <p className="opp-section__placeholder">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="opps-page">
        <button className="opp-detail__back" onClick={() => navigate('/projects/opps')}>
          ← Back to Hunt Board
        </button>
        <div className="opp-detail__error">{error}</div>
      </div>
    );
  }

  if (!opp) return null;

  return (
    <div className="opps-page">
      <button className="opp-detail__back" onClick={() => navigate('/projects/opps')}>
        ← Back to Hunt Board
      </button>

      <div className="opp-detail__hero">
        <div className="opp-detail__hero-text">
          <span className="opps-page__overline">Hunt Board · Handoff</span>
          <h1 className="opp-detail__title">{opp.oppName}</h1>
          <div className="opp-detail__owner-line">
            <span>
              Owned by <strong>{fullSeName(opp.salesEngineer)}</strong>
            </span>
            {!canEdit && <span className="opp-detail__readonly-pill">Read only</span>}
          </div>
        </div>
        <div className="opps-page__actions">
          {canEdit && <span className="opp-detail__save-status">{saveStatus}</span>}
          {/*
            Notion handoff controls. The SE can create the page as soon as
            the opp lands (no stage gate) and re-sync it as the deal moves
            -- so when a page already exists we show BOTH an "Open in
            Notion" link and an "Update" button that re-pushes the latest
            Hunt Board data into the same page.
          */}
          {opp.notionPageUrl ? (
            <>
              <a
                className="opp-detail__notion-btn opp-detail__notion-btn--linked"
                href={opp.notionPageUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Notion ↗
              </a>
              {canEdit && (
                <button
                  type="button"
                  className="opp-detail__notion-btn opp-detail__notion-btn--update"
                  onClick={sendToNotion}
                  disabled={notionStatus === 'sending'}
                  title="Re-sync the latest Hunt Board data into the existing Notion page. Overwrites the page body."
                >
                  {notionStatus === 'sending' ? 'Updating…' : 'Update Notion'}
                </button>
              )}
            </>
          ) : canEdit ? (
            <button
              type="button"
              className="opp-detail__notion-btn"
              onClick={sendToNotion}
              disabled={notionStatus === 'sending'}
              title="Create the Lead handoff page in Notion. You can keep updating it as the deal progresses."
            >
              {notionStatus === 'sending' ? 'Sending…' : 'Send to Notion'}
            </button>
          ) : null}
          {notionMessage && <span className="opp-detail__copy-status">{notionMessage}</span>}
          {/*
            Delete is intentionally a ghost button -- destructive and
            irreversible, but routine enough (closed-won opps get pruned
            after the Notion handoff) that hiding it in a menu would just
            add friction. Owner-or-admin only; Leads never see it.
          */}
          {canDelete && (
            <button
              type="button"
              className="opp-detail__delete-btn"
              onClick={handleDelete}
              title="Permanently remove this Hunt Board page"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/*
        Top band: Handoff Properties (6 fields in a 3x2 grid) on the left,
        Linked Linear tickets pulled up alongside on the right. Pairing
        them here keeps the "who's involved + what's already filed" answer
        above the fold, before Tech Specs / Notes / SF push the content
        further down.
      */}
      <div className="opp-detail__top-row">
        <div className="opp-section opp-section--wide">
          <div className="opp-section__head">
            <h3 className="opp-section__title">Handoff Properties</h3>
          </div>
          <div className="opp-properties opp-properties--wide">
            {/*
            One unified SE field. Renders as a plain read-only value for
            regular SEs, or a select for admins / Leads -- the component
            picks based on the SE-list endpoint response (403 vs 200) so
            we don't have to plumb roles through the page.
          */}
            <SalesEngineerPicker
              currentSeId={opp.salesEngineer?.id}
              currentSeName={fullSeName(opp.salesEngineer)}
              onChange={(seId) => patch({ salesEngineerId: seId })}
            />
            <div className="opp-property">
              <span className="opp-property__label">AE</span>
              <EditableField
                value={opp.aeNameOverride}
                editable={canEdit}
                placeholder={sfData?.ownerName || 'AE name'}
                onSave={(v) => patch({ aeNameOverride: v })}
                onStatusChange={onSaveStatus}
              />
            </div>
            <div className="opp-property">
              <span className="opp-property__label">CSM</span>
              <EditableField
                value={opp.csmName}
                editable={canEdit}
                placeholder="CSM name"
                onSave={(v) => patch({ csmName: v })}
                onStatusChange={onSaveStatus}
              />
            </div>
            <div className="opp-property">
              <span className="opp-property__label">QA Lead</span>
              <EditableField
                value={opp.qaLeadName}
                editable={canEdit}
                placeholder="QA Lead name"
                onSave={(v) => patch({ qaLeadName: v })}
                onStatusChange={onSaveStatus}
              />
            </div>
            <div className="opp-property">
              <span className="opp-property__label">QA Manager</span>
              {canEdit ? (
                <select
                  className="opp-property__input"
                  value={opp.qaManagerName || ''}
                  onChange={(e) => patch({ qaManagerName: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {QA_MANAGERS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  {/* Preserve any legacy free-text value not in the roster
                    so converting to a dropdown never silently drops it. */}
                  {opp.qaManagerName && !QA_MANAGERS.includes(opp.qaManagerName) && (
                    <option value={opp.qaManagerName}>{opp.qaManagerName}</option>
                  )}
                </select>
              ) : (
                <span className="opp-property__value">{opp.qaManagerName || 'Unassigned'}</span>
              )}
            </div>
            <div className="opp-property">
              <span className="opp-property__label">QAW Team</span>
              {canEdit ? (
                <select
                  className="opp-property__input"
                  value={opp.qawTeam || ''}
                  onChange={(e) => patch({ qawTeam: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {QAW_TEAMS.map((team) => (
                    <option key={team} value={team}>
                      {team}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="opp-property__value">{opp.qawTeam || 'Unassigned'}</span>
              )}
            </div>
          </div>
        </div>

        <LinearTicketsCard
          linearTickets={linearTickets}
          oppId={opp.id}
          canEdit={canEdit}
          onChanged={load}
        />
      </div>

      {/*
        Tech Specs + Gong sit on their own full-width row below the
        Handoff Properties. Notes / pain points / Linear / SF get pushed
        beneath so the "configuration + recorded calls" pair reads as the
        primary technical context above everything else.
      */}
      <div className="opp-detail__tech-row">
        <div className="opp-section opp-section--flex">
          <div className="opp-section__head">
            <h3 className="opp-section__title">Technical Specs</h3>
            {canEdit && sfData?.id && (
              <button
                type="button"
                className="opp-insights-btn"
                onClick={() => setInsightsOpen(true)}
                title="Use Claude to pull Integrations / Pain Points / Notes from this opp's Gong call briefs"
              >
                <span className="opp-insights-btn__spark" aria-hidden="true">
                  ✦
                </span>
                AI suggestions from Calls
              </button>
            )}
          </div>
          <div className="opp-properties" style={{ gridTemplateColumns: '1fr' }}>
            {['url', 'vpn', 'user', 'integrations'].map((key) => {
              const labels = {
                url: 'URL / APK / IPA',
                vpn: 'Any VPN',
                user: 'User',
                integrations: 'Integrations',
              };
              return (
                <div key={key} className="opp-property">
                  <span className="opp-property__label">{labels[key]}</span>
                  <EditableTextArea
                    value={techSpecs[key]}
                    editable={canEdit}
                    placeholder={`Add ${labels[key].toLowerCase()}…`}
                    minHeight={48}
                    onSave={patchTechSpecs(key)}
                    onStatusChange={onSaveStatus}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <OppGongCard opportunityId={sfData?.id} />
      </div>

      {/*
        Creation + Estimation sit directly below Tech Specs / Gong as
        their own full-width band so the AE-handoff artifacts read as a
        peer to the technical context above (rather than getting buried
        at the bottom of the Notes column).
      */}
      <div className="opp-detail__handoff-row">
        <div className="opp-section">
          <div className="opp-section__head">
            <h3 className="opp-section__title">Creation</h3>
            {primaryCreationTicket?.slackThread && (
              <a
                className="opp-section__slack-link"
                href={primaryCreationTicket.slackThread}
                target="_blank"
                rel="noopener noreferrer"
                title={`Slack thread for ${primaryCreationTicket.id}`}
              >
                Slack thread ↗
              </a>
            )}
          </div>
          <div className="opp-properties" style={{ gridTemplateColumns: '1fr' }}>
            <div className="opp-property">
              <span className="opp-property__label">Demo Workspace URL</span>
              <EditableField
                value={creation.demoWorkspaceUrl}
                editable={canEdit}
                placeholder="https://app.qawolf.com/…"
                type="url"
                onSave={(v) => patchCreation({ demoWorkspaceUrl: v })}
                onStatusChange={onSaveStatus}
              />
            </div>
          </div>
          <div className="opp-flows">
            <div className="opp-flows__header">
              <span className="opp-property__label">Flows</span>
              {canEdit && (
                <button
                  type="button"
                  className="opps-page__btn opp-linked-link-btn"
                  onClick={addFlow}
                >
                  + Add flow
                </button>
              )}
            </div>
            {(creation.flows || []).length === 0 ? (
              <p className="opp-section__placeholder">
                No flows recorded yet
                {canEdit ? ' — click + Add flow above.' : '.'}
              </p>
            ) : (
              (creation.flows || []).map((flow) => (
                <div key={flow.id} className="opp-flow-row">
                  <EditableField
                    value={flow.name}
                    editable={canEdit}
                    placeholder="Flow name"
                    onSave={(v) => patchFlow(flow.id, { name: v })}
                    onStatusChange={onSaveStatus}
                  />
                  <EditableField
                    value={flow.url}
                    editable={canEdit}
                    placeholder="https://…"
                    type="url"
                    onSave={(v) => patchFlow(flow.id, { url: v })}
                    onStatusChange={onSaveStatus}
                  />
                  {canEdit && (
                    <button
                      type="button"
                      className="opp-flow-row__remove"
                      title="Remove flow"
                      aria-label="Remove flow"
                      onClick={() => removeFlow(flow.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="opp-section">
          <div className="opp-section__head">
            <h3 className="opp-section__title">Estimation</h3>
            {primaryScopeTicket?.slackThread && (
              <a
                className="opp-section__slack-link"
                href={primaryScopeTicket.slackThread}
                target="_blank"
                rel="noopener noreferrer"
                title={`Slack thread for ${primaryScopeTicket.id}`}
              >
                Slack thread ↗
              </a>
            )}
          </div>
          <div className="opp-property">
            <span className="opp-property__label">Estimation Type</span>
            <div className="opp-segmented" role="radiogroup" aria-label="Estimation type">
              {[
                { id: 'ratio', label: 'Ratio' },
                { id: 'exploratory', label: 'Exploratory' },
              ].map((opt) => {
                const active = estimation.type === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`opp-segmented__btn${active ? ' opp-segmented__btn--active' : ''}`}
                    disabled={!canEdit}
                    onClick={() => patchEstimation({ type: active && canEdit ? null : opt.id })}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div
            className="opp-properties"
            style={{ gridTemplateColumns: '1fr', marginTop: '0.85rem' }}
          >
            {estimation.type === 'ratio' && (
              <div className="opp-property">
                <span className="opp-property__label">Ratio Document URL</span>
                <EditableField
                  value={estimation.ratioDocUrl}
                  editable={canEdit}
                  placeholder="https://…"
                  type="url"
                  onSave={(v) => patchEstimation({ ratioDocUrl: v })}
                  onStatusChange={onSaveStatus}
                />
              </div>
            )}
            {estimation.type === 'exploratory' && (
              <div className="opp-property">
                <span className="opp-property__label">Exploratory Notes</span>
                <EditableTextArea
                  value={estimation.exploratoryNotes}
                  editable={canEdit}
                  placeholder="Anything the AE shared verbally or in the call…"
                  minHeight={100}
                  onSave={(v) => patchEstimation({ exploratoryNotes: v })}
                  onStatusChange={onSaveStatus}
                />
              </div>
            )}
            <div className="opp-property">
              <span className="opp-property__label">Spreadsheet URL</span>
              <EditableField
                value={estimation.spreadsheetUrl}
                editable={canEdit}
                placeholder="https://docs.google.com/spreadsheets/…"
                type="url"
                onSave={(v) => patchEstimation({ spreadsheetUrl: v })}
                onStatusChange={onSaveStatus}
              />
            </div>
          </div>
        </div>
      </div>

      {/*
        Salesforce on its own full-width row -- the basic-info grid inside
        auto-fits across columns so the extra width gives 4-5 fields per
        row instead of being cramped into a 1/3 sidebar.
      */}
      <div className="opp-section opp-detail__full-row">
        <div className="opp-section__head">
          <h3 className="opp-section__title">Salesforce</h3>
          {sfLoading && <span className="opp-detail__save-status">Loading…</span>}
        </div>
        {!sfLoading && !sfData && (
          <p className="opp-section__placeholder">
            No matching Salesforce opportunity found. Open the{' '}
            <Link to="/projects/salesforce/lookup">Salesforce Lookup</Link> to verify the name.
          </p>
        )}
        {sfData && <OppSalesforceCard opportunity={sfData} />}
      </div>

      {/*
        Notes + custom sections at the bottom, also full-width. This is
        where the SE writes the long-form handoff narrative, so giving it
        the full page width keeps wrapping comfortable.
      */}
      <div className="opp-detail__notes-stack">
        <div className="opp-section">
          <div className="opp-section__head">
            <h3 className="opp-section__title">Notes</h3>
          </div>
          <EditableTextArea
            value={opp.notesMarkdown}
            editable={canEdit}
            placeholder="Anything else a Lead should know — pricing, contract notes, decision criteria…"
            minHeight={140}
            onSave={(v) => patch({ notesMarkdown: v })}
            onStatusChange={onSaveStatus}
          />
        </div>

        {/* Custom sections (Pain Points seeded by backend) */}
        {customSections.map((section) => (
          <div key={section.id} className="opp-section">
            <div className="opp-section__head">
              {canEdit ? (
                <input
                  className="opp-property__input"
                  style={{ fontWeight: 600, fontSize: '1.05rem' }}
                  defaultValue={section.title || 'New Section'}
                  onBlur={(e) => {
                    if (e.target.value !== section.title) {
                      renameCustomSection(section.id)(e.target.value);
                    }
                  }}
                />
              ) : (
                <h3 className="opp-section__title">{section.title || 'Untitled'}</h3>
              )}
              {canEdit && (
                <div className="opp-section__actions">
                  <button
                    type="button"
                    className="opps-page__btn"
                    onClick={() => removeCustomSection(section.id)}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
            <EditableTextArea
              value={section.bodyMarkdown}
              editable={canEdit}
              placeholder="Add details…"
              minHeight={100}
              onSave={patchCustomSection(section.id)}
              onStatusChange={onSaveStatus}
            />
          </div>
        ))}

        {canEdit && (
          <button
            type="button"
            className="opps-page__btn"
            style={{ alignSelf: 'flex-start' }}
            onClick={addCustomSection}
          >
            + Add section
          </button>
        )}
      </div>

      {insightsOpen && (
        <GongInsightsModal
          oppId={opp.id}
          sfOpportunityId={sfData?.id}
          onApply={applyInsight}
          onClose={() => setInsightsOpen(false)}
        />
      )}
    </div>
  );
}

export default OppDetail;
