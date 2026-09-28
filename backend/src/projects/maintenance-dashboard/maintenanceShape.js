/**
 * Pure shaping for the maintenance backlog: which workspaces count, how old a
 * report is, and how customers and reports rank. No I/O here, so every rule
 * that decides what an SE sees first is unit-testable.
 *
 * Vocabulary: a *workspace* is a customer's QA Wolf team; a *maintenance
 * report* is an open issue of type `maintenance` that parks one or more flows
 * out of the suite until someone repairs them; the flows it parks are its
 * *reproductions*.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Statuses that mean "still parked". Anything else is finished business. */
export const OPEN_REPORT_STATUSES = new Set(['pending', 'inProgress', 'paused']);

/**
 * Workspaces that are never customer backlog: our own sandboxes and demos.
 * Name-based on purpose -- the API carries no "demo" flag -- so the test is
 * deliberately broad and the page lets the reader flip it off.
 */
const DEMO_NAME_RE = /\b(demo|sandbox|playground|test(?:ing)?|poc|trial|template|onboarding)\b/i;
const INTERNAL_ORG_RE = /^(qa wolf|growth sandbox|test)$/i;

export function isDemoWorkspace(workspace) {
  if (!workspace) return false;
  const name = String(workspace.name || '');
  const org = String(workspace.organizationName || '');
  return DEMO_NAME_RE.test(name) || INTERNAL_ORG_RE.test(org.trim());
}

/**
 * Parse `MAINTENANCE_DASHBOARD_EXCLUDED_SLUGS` ("figma, other-slug") into a set
 * of lower-cased slugs. Figma is excluded by default because its backlog is
 * handled separately and would otherwise sit at the top of every list.
 */
export function parseExcludedSlugs(raw, fallback = 'figma') {
  const source = typeof raw === 'string' && raw.trim() ? raw : fallback;
  return new Set(
    source
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isExcludedWorkspace(workspace, excludedSlugs) {
  if (!workspace || !excludedSlugs?.size) return false;
  const slug = String(workspace.slug || '').toLowerCase();
  const name = String(workspace.name || '').toLowerCase();
  return excludedSlugs.has(slug) || excludedSlugs.has(name);
}

/** Whole days between an ISO timestamp and `now`; never negative. */
export function ageInDays(createdAt, now = Date.now()) {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((now - created) / MS_PER_DAY));
}

/** Flow ids a report is currently parking (inactive reproductions are healed). */
export function activeFlowIds(report) {
  const ids = new Set();
  for (const repro of report?.reproductions || []) {
    if (repro?.isActive === false) continue;
    if (repro?.flowId) ids.add(repro.flowId);
  }
  return ids;
}

/** Trim a description to one line for the table; the full text stays in QA Wolf. */
export function summarizeDescription(description, maxLength = 160) {
  if (!description || typeof description !== 'string') return '';
  const oneLine = description.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLength) return oneLine;
  return `${oneLine.slice(0, maxLength - 1).trimEnd()}…`;
}

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3, unprioritized: 4 };

/**
 * Shape one open report into a table row. `workspace` is the workspace it
 * belongs to (name/slug/org come from whoami, not the issue).
 */
export function shapeReport(report, workspace, now = Date.now()) {
  const flowIds = activeFlowIds(report);
  const totalFlows = new Set((report?.reproductions || []).map((r) => r?.flowId).filter(Boolean))
    .size;
  return {
    issueId: report.issueId,
    number: report.number ?? null,
    name: report.name || `Maintenance report #${report.number ?? '?'}`,
    status: report.status || 'pending',
    priority: report.priority || 'unprioritized',
    priorityRank: PRIORITY_RANK[report.priority] ?? PRIORITY_RANK.unprioritized,
    createdAt: report.createdAt || null,
    ageDays: ageInDays(report.createdAt, now),
    flowCount: flowIds.size,
    healedFlowCount: Math.max(0, totalFlows - flowIds.size),
    flowIds: [...flowIds],
    description: summarizeDescription(report.description),
    url: report.url || null,
    workspaceId: workspace?.id || null,
    workspaceName: workspace?.name || '',
    workspaceSlug: workspace?.slug || '',
    organizationName: workspace?.organizationName || '',
    isDemo: isDemoWorkspace(workspace),
  };
}

/**
 * Roll a workspace's open reports up into one customer row.
 * `flowsInMaintenance` counts distinct flows across reports, because a flow
 * that two reports both park is still one test missing from the suite.
 */
export function shapeCustomer(workspace, reports, now = Date.now()) {
  const shaped = reports.map((r) => shapeReport(r, workspace, now));
  const flowIds = new Set(shaped.flatMap((r) => r.flowIds));
  const oldest = shaped.reduce(
    (acc, r) => (acc === null || r.ageDays > acc.ageDays ? r : acc),
    null,
  );
  const ageSum = shaped.reduce((sum, r) => sum + r.ageDays, 0);
  return {
    workspaceId: workspace.id,
    name: workspace.name || workspace.slug || workspace.id,
    slug: workspace.slug || '',
    organizationName: workspace.organizationName || '',
    url: workspace.slug ? `https://app.qawolf.com/${workspace.slug}/maintenance-reports` : null,
    isDemo: isDemoWorkspace(workspace),
    openReports: shaped.length,
    flowsInMaintenance: flowIds.size,
    oldestReportAgeDays: oldest ? oldest.ageDays : 0,
    oldestReportName: oldest ? oldest.name : '',
    oldestReportNumber: oldest ? oldest.number : null,
    oldestReportUrl: oldest ? oldest.url : null,
    averageReportAgeDays: shaped.length ? Math.round(ageSum / shaped.length) : 0,
  };
}

/** Largest culprits: most flows parked first, then most reports, then oldest. */
export function rankCulprits(customers) {
  return [...customers].sort(
    (a, b) =>
      b.flowsInMaintenance - a.flowsInMaintenance ||
      b.openReports - a.openReports ||
      b.oldestReportAgeDays - a.oldestReportAgeDays ||
      a.name.localeCompare(b.name),
  );
}

/** Longest outstanding: oldest first, then most flows, then higher priority. */
export function rankOutstanding(reports) {
  return [...reports].sort(
    (a, b) =>
      b.ageDays - a.ageDays ||
      b.flowCount - a.flowCount ||
      a.priorityRank - b.priorityRank ||
      a.workspaceName.localeCompare(b.workspaceName),
  );
}

/**
 * Build the whole snapshot from the raw API answers.
 *
 * @param {object} args
 * @param {Array} args.workspaces          whoami's list
 * @param {Map<string, Array>} args.reportsByWorkspace  workspaceId -> raw open reports
 * @param {Set<string>} [args.excludedSlugs]
 * @param {Array<{workspaceId:string,message:string}>} [args.errors]
 * @param {number} [args.now]
 */
export function buildSnapshot({
  workspaces,
  reportsByWorkspace,
  excludedSlugs = parseExcludedSlugs(''),
  errors = [],
  now = Date.now(),
}) {
  const customers = [];
  const reports = [];
  let excludedCount = 0;

  for (const workspace of workspaces || []) {
    if (isExcludedWorkspace(workspace, excludedSlugs)) {
      excludedCount += 1;
      continue;
    }
    const raw = (reportsByWorkspace.get(workspace.id) || []).filter((r) =>
      OPEN_REPORT_STATUSES.has(r?.status || 'pending'),
    );
    if (raw.length === 0) continue;
    customers.push(shapeCustomer(workspace, raw, now));
    for (const report of raw) reports.push(shapeReport(report, workspace, now));
  }

  const rankedCustomers = rankCulprits(customers);
  const rankedReports = rankOutstanding(reports);
  const customerRows = rankedCustomers.filter((c) => !c.isDemo);
  const reportRows = rankedReports.filter((r) => !r.isDemo);

  return {
    generatedAt: new Date(now).toISOString(),
    totals: {
      workspacesScanned: (workspaces || []).length,
      workspacesExcluded: excludedCount,
      workspacesFailed: errors.length,
      customersWithBacklog: customerRows.length,
      openReports: reportRows.length,
      flowsInMaintenance: customerRows.reduce((sum, c) => sum + c.flowsInMaintenance, 0),
      oldestReportAgeDays: reportRows.length ? reportRows[0].ageDays : 0,
      demoWorkspacesWithBacklog: rankedCustomers.length - customerRows.length,
    },
    excludedSlugs: [...excludedSlugs],
    customers: rankedCustomers,
    reports: rankedReports,
    errors,
  };
}
