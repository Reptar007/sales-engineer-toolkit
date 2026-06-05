/**
 * Notion handoff sync.
 *
 * One SE-initiated POST per closed-won Opp creates a fully-populated page
 * in the configured "Hunt Board" database. The page is the artifact the
 * SE shares with their Lead.
 *
 * The mapper is intentionally defensive: it inspects the target database's
 * actual property schema on first call, caches it for the process, and only
 * emits values for properties that (a) exist by name (case-insensitive) and
 * (b) have a type we know how to write. That lets the SE team evolve the
 * Notion schema without code changes -- add a column, it lights up; drop a
 * column, it silently stops being written.
 *
 * Recommended Notion DB schema (every column is optional except `Name`):
 *   Name           -- Title       (required by Notion)
 *   SE             -- Person
 *   AE             -- Person
 *   CSM            -- Person
 *   QA Lead        -- Person
 *   QA Manager     -- Person
 *   CARR           -- Number (dollar format)
 *   Product        -- Text
 *   QAE Team       -- Select
 *
 * People columns auto-resolve names to Notion user ids via a one-time
 * `users.list` call (cached per process). The integration token must have
 * "Read user information (without email addresses)" enabled or the lookup
 * silently fails for those columns -- the page still creates fine.
 */
import { Client } from '@notionhq/client';

let _client = null;
let _dbCache = null; // { propsByLower: Map<lowername, { name, type }>, dataSourceId }
let _usersCache = null; // { byLower: Map<lowername, userId> }

function getClient() {
  if (_client) return _client;
  const auth = process.env.NOTION_API_KEY;
  if (!auth) return null;
  _client = new Client({ auth });
  return _client;
}

export function isConfigured() {
  return !!(process.env.NOTION_API_KEY && process.env.NOTION_HUNT_BOARD_DATABASE_ID);
}

// ---------------------------------------------------------------------------
// Schema discovery -- cached so repeat sends don't pay the round-trip.
//
// Notion split "database" and "data source" in 2025: a Database is the
// container shell; the actual property schema lives on one (or more) Data
// Sources that belong to it. `databases.retrieve` no longer returns
// `properties` -- it returns `data_sources: [{ id, name }]`, and we have
// to call `dataSources.retrieve(id)` on the first one to get the schema.
//
// For our purposes the Hunt Board DB has a single inline data source, so
// we just use the first entry. Multi-source databases would need a config
// knob to pick which one to write to.
// ---------------------------------------------------------------------------
async function getDatabaseSchema() {
  if (_dbCache) return _dbCache;
  const client = getClient();
  if (!client) return null;
  const databaseId = process.env.NOTION_HUNT_BOARD_DATABASE_ID;

  const db = await client.databases.retrieve({ database_id: databaseId });
  const sources = db.data_sources || [];
  if (sources.length === 0) {
    console.warn(
      `notionService: database ${databaseId} has no data_sources -- cannot read schema.`,
    );
    _dbCache = { propsByLower: new Map(), dataSourceId: null };
    return _dbCache;
  }
  const dataSourceId = sources[0].id;
  const ds = await client.dataSources.retrieve({ data_source_id: dataSourceId });

  const propsByLower = new Map();
  for (const [name, def] of Object.entries(ds.properties || {})) {
    propsByLower.set(name.toLowerCase(), { name, type: def.type });
  }
  _dbCache = { propsByLower, dataSourceId };
  return _dbCache;
}

// ---------------------------------------------------------------------------
// User directory -- cached. Used by the Person property mapper.
// ---------------------------------------------------------------------------
// Aggressive normalization so display-name variants ("Sebastian (he/him)
// Antonucci", "Sébastien Antonucci", "Sebastian Antonucci  ") all collapse
// to the same key. We:
//   1. lowercase
//   2. strip parentheticals -- pronouns, role tags, etc.
//   3. strip diacritics (NFD + remove combining marks)
//   4. drop punctuation, collapse whitespace
function normalizeNameKey(value) {
  if (!value || typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract first/last tokens from a normalized name so "Sebastian Charles
// Antonucci" still matches a Notion user listed as just "Sebastian
// Antonucci". We pick the first and the last token (ignoring middle
// names) -- not perfect for multi-word last names like "Van Buren", but
// good enough for the QAW roster and recoverable by full-name matching.
function firstLastKey(normalized) {
  if (!normalized) return '';
  const parts = normalized.split(' ').filter(Boolean);
  if (parts.length < 2) return '';
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

async function getUserDirectory() {
  if (_usersCache) return _usersCache;
  const client = getClient();
  if (!client) return { byKey: new Map(), byFirstLast: new Map(), byEmail: new Map() };
  // Three indexes so resolveUserId can fall back from exact -> first+last
  // -> email without rescanning the directory. First write wins in each
  // index so collisions are deterministic; we log the dupes so the deployer
  // can rename in Notion if needed.
  const byKey = new Map();
  const byFirstLast = new Map();
  const byEmail = new Map();
  try {
    let cursor;
    do {
       
      const page = await client.users.list({ start_cursor: cursor, page_size: 100 });
      for (const u of page.results || []) {
        if (!u || u.type !== 'person') continue;
        const name = (u.name || '').trim();
        const email = (u.person?.email || '').trim().toLowerCase();
        if (!name && !email) continue;
        const key = normalizeNameKey(name);
        if (key) {
          if (!byKey.has(key)) byKey.set(key, u.id);
          else
            console.warn(
              `notionService: ambiguous Notion user name "${name}" -- using first match.`,
            );
          const fl = firstLastKey(key);
          if (fl && !byFirstLast.has(fl)) byFirstLast.set(fl, u.id);
        }
        if (email && !byEmail.has(email)) byEmail.set(email, u.id);
      }
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);
  } catch (err) {
    console.warn(
      'notionService: users.list failed, Person columns will be empty.',
      err?.message || err,
    );
  }
  _usersCache = { byKey, byFirstLast, byEmail };
  return _usersCache;
}

// Resolve a display name (and optional email) to a Notion user id.
// Tries, in order:
//   1. Exact normalized-name match
//   2. First-name + last-name match (skips middle names)
//   3. Email match (when caller supplies one)
// Returns null and logs the miss so the SE can see which name to fix.
function resolveUserId(name, directory, { email, label } = {}) {
  if (!directory) return null;
  const normalized = normalizeNameKey(name || '');
  if (normalized) {
    const exact = directory.byKey.get(normalized);
    if (exact) return exact;
    const fl = firstLastKey(normalized);
    if (fl) {
      const flHit = directory.byFirstLast.get(fl);
      if (flHit) return flHit;
    }
  }
  const emailKey = email && typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (emailKey) {
    const byEmail = directory.byEmail.get(emailKey);
    if (byEmail) return byEmail;
  }
  if (name) {
    console.warn(
      `notionService: could not resolve "${name}" to a Notion user${
        label ? ` (${label})` : ''
      }. Check that the name in QAW Toolkit matches Notion exactly (or invite them to Notion).`,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Property builders. Each returns a Notion property-value object only if
// the column exists in the target DB and matches the expected type.
// ---------------------------------------------------------------------------
function maybeTitle(schema, name, text) {
  const def = schema.propsByLower.get(name.toLowerCase());
  if (!def || def.type !== 'title') return null;
  return [
    def.name,
    { title: [{ type: 'text', text: { content: String(text || '').slice(0, 1900) } }] },
  ];
}

function maybeRichText(schema, name, text) {
  const def = schema.propsByLower.get(name.toLowerCase());
  if (!def || def.type !== 'rich_text') return null;
  const content = String(text == null ? '' : text);
  if (!content) return null;
  return [
    def.name,
    { rich_text: [{ type: 'text', text: { content: content.slice(0, 1900) } }] },
  ];
}

function maybeNumber(schema, name, value) {
  const def = schema.propsByLower.get(name.toLowerCase());
  if (!def || def.type !== 'number') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return [def.name, { number: num }];
}

function maybeSelect(schema, name, value) {
  const def = schema.propsByLower.get(name.toLowerCase());
  if (!def || def.type !== 'select') return null;
  if (!value) return null;
  return [def.name, { select: { name: String(value) } }];
}

function maybePerson(schema, name, displayName, directory, opts) {
  const def = schema.propsByLower.get(name.toLowerCase());
  if (!def || def.type !== 'people') return null;
  const id = resolveUserId(displayName, directory, { ...opts, label: name });
  if (!id) return null;
  return [def.name, { people: [{ object: 'user', id }] }];
}

async function buildProperties({ opp, sf, ownerSeName, ownerSeEmail }) {
  const schema = await getDatabaseSchema();
  if (!schema) return {};
  const directory = await getUserDirectory();

  const entries = [
    maybeTitle(schema, 'Name', `${opp.oppName} SE Handoff`),
    maybePerson(schema, 'SE', ownerSeName, directory, { email: ownerSeEmail }),
    maybePerson(schema, 'AE', opp.aeNameOverride || sf?.ownerName, directory),
    maybePerson(schema, 'CSM', opp.csmName, directory),
    maybePerson(schema, 'QA Lead', opp.qaLeadName, directory),
    maybePerson(schema, 'QA Manager', opp.qaManagerName, directory),
    maybeNumber(schema, 'CARR', sf?.carr ?? sf?.grossARR ?? sf?.amount),
    maybeRichText(schema, 'Product', sf?.product),
    // QAE Team -- write the SE-selected team to the Notion Select column.
    // Notion auto-creates new select options on write, so pre-creating the
    // option in Notion is optional (but recommended for stable tag colors).
    maybeSelect(schema, 'QAE Team', opp.qawTeam),
  ].filter(Boolean);

  return Object.fromEntries(entries);
}

// ---------------------------------------------------------------------------
// Body blocks. Order mirrors the existing Hunt Board template so a
// generated page reads identical to a hand-written one.
// ---------------------------------------------------------------------------
function richText(content) {
  // Notion caps rich_text content at 2000 chars per block. We split on
  // boundaries that hurt least (paragraph -> sentence -> brute slice).
  const str = String(content == null ? '' : content);
  if (str.length <= 1900) return [{ type: 'text', text: { content: str } }];
  const chunks = [];
  let rest = str;
  while (rest.length > 1900) {
    chunks.push(rest.slice(0, 1900));
    rest = rest.slice(1900);
  }
  if (rest) chunks.push(rest);
  return chunks.map((c) => ({ type: 'text', text: { content: c } }));
}

function paragraph(text) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: richText(text) },
  };
}

function heading2(text) {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: richText(text) },
  };
}

function heading3(text) {
  return {
    object: 'block',
    type: 'heading_3',
    heading_3: { rich_text: richText(text) },
  };
}

function bullet(text, children) {
  const block = {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: richText(text) },
  };
  if (children && children.length) {
    block.bulleted_list_item.children = children;
  }
  return block;
}

function bulletLink(label, url) {
  const text = label || url || 'Link';
  if (!url) return bullet(text);
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: text, link: { url } } },
      ],
    },
  };
}

// Horizontal rule used to separate the top-level handoff sections, so the
// generated page reads with the same visual rhythm as the SE Handoff
// template (every section divided by a rule).
function divider() {
  return { object: 'block', type: 'divider', divider: {} };
}

// "**Label:** value" bullet. The label is bolded and the value rendered
// as plain text, matching the template's key/value lists (Tech Specs, SF
// Details). Value is clamped to Notion's per-text-node limit.
function labelValueBullet(label, value) {
  const val = value == null || value === '' ? '' : String(value).slice(0, 1900);
  const rich = [
    { type: 'text', text: { content: `${label}:` }, annotations: { bold: true } },
  ];
  if (val) rich.push({ type: 'text', text: { content: ` ${val}` } });
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: rich },
  };
}

// Paragraph of the form "**Label:** <linked url>". Used for the Slack
// thread / Demo workspace lines so the label reads cleanly and the URL is
// clickable.
function labeledLinkParagraph(label, url) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        { type: 'text', text: { content: `${label}: ` }, annotations: { bold: true } },
        { type: 'text', text: { content: url, link: { url } } },
      ],
    },
  };
}

// Bullet of the form "**Label:** <linked url>" (Scoping spreadsheet /
// ratio doc) -- like labeledLinkParagraph but as a list item.
function labeledLinkBullet(label, url) {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: `${label}: ` }, annotations: { bold: true } },
        { type: 'text', text: { content: url, link: { url } } },
      ],
    },
  };
}

// Link-preview card for a Slack thread. A `bookmark` block renders as an
// unfurled preview (title/description/favicon) rather than a bare inline
// link, so the Lead sees a Slack message preview. Caption labels the card
// since a bookmark has no leading text of its own.
function slackPreview(url) {
  return {
    object: 'block',
    type: 'bookmark',
    bookmark: {
      url,
      caption: [{ type: 'text', text: { content: 'Slack thread' } }],
    },
  };
}

// Two side-by-side columns. Nesting stays within Notion's append limit:
// column_list (appended block) -> column (level 1) -> leaf blocks (level
// 2). Each column must contain at least one child, which is always true
// here since the Creation/Scoping columns lead with a heading.
function twoColumns(leftChildren, rightChildren) {
  return {
    object: 'block',
    type: 'column_list',
    column_list: {
      children: [
        { object: 'block', type: 'column', column: { children: leftChildren } },
        { object: 'block', type: 'column', column: { children: rightChildren } },
      ],
    },
  };
}

// Inner blocks for the left column of the Creation/Scoping row. Leads
// with the "Creation" heading (the column header) so the column reads as
// its own section.
function buildCreationInner(creation = {}, primaryTicket = null) {
  const blocks = [heading2('Creation')];
  // Lead-friendly: surface the AE's Slack request thread (if we have one
  // from the linked Linear creation ticket) right under the heading so
  // they can jump to the original conversation without digging through
  // Linear.
  if (primaryTicket?.slackThread) {
    blocks.push(slackPreview(primaryTicket.slackThread));
  }
  const demo = creation.demoWorkspaceUrl;
  if (demo) {
    blocks.push(labeledLinkParagraph('Demo workspace', demo));
  }
  const flows = Array.isArray(creation.flows) ? creation.flows : [];
  if (flows.length === 0) {
    blocks.push(bullet('No flows recorded yet.'));
  } else {
    for (const f of flows) {
      const label = (f.name || '').trim() || '(unnamed flow)';
      blocks.push(bulletLink(label, f.url || ''));
    }
  }
  return blocks;
}

// Inner blocks for the right column of the Creation/Scoping row. Mirrors
// the template's "Scoping" heading (was "Test Estimation").
function buildScopingInner(estimation = {}, primaryTicket = null) {
  const blocks = [heading2('Scoping')];
  if (primaryTicket?.slackThread) {
    blocks.push(slackPreview(primaryTicket.slackThread));
  }
  const type = estimation.type;
  if (type === 'ratio') {
    blocks.push(labelValueBullet('Type', 'Ratio'));
    if (estimation.ratioDocUrl) {
      blocks.push(labeledLinkBullet('Ratio document', estimation.ratioDocUrl));
    }
  } else if (type === 'exploratory') {
    blocks.push(labelValueBullet('Type', 'Exploratory'));
    if (estimation.exploratoryNotes) {
      blocks.push(labelValueBullet('Notes', estimation.exploratoryNotes));
    }
  } else {
    blocks.push(labelValueBullet('Type', '(not set)'));
  }
  if (estimation.spreadsheetUrl) {
    blocks.push(labeledLinkBullet('Spreadsheet', estimation.spreadsheetUrl));
  }
  return blocks;
}

function buildGongsBlocks(calls = []) {
  const blocks = [heading2('Gong Video')];
  if (!Array.isArray(calls) || calls.length === 0) {
    blocks.push(bullet('No Gong calls logged.'));
    return blocks;
  }
  // Each call becomes a toggle: header is the call title (linked to Gong
  // when we have a URL), body is the summary paragraph. Collapsed by
  // default, so the Gongs section reads as a scannable list of titles
  // and the Lead expands only the calls they want to dig into.
  for (const c of calls) {
    const title = c.title || c.name || 'Untitled Conversation';
    const url = c.url || '';
    const summary = typeof c.summary === 'string' ? c.summary.trim() : '';
    const headerRichText = url
      ? [{ type: 'text', text: { content: title, link: { url } } }]
      : [{ type: 'text', text: { content: title } }];
    const children = summary
      ? [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: richText(summary) },
          },
        ]
      : [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: 'No summary available.' } }],
            },
          },
        ];
    blocks.push({
      object: 'block',
      type: 'toggle',
      toggle: { rich_text: headerRichText, children },
    });
  }
  return blocks;
}

const TECH_SPEC_KEYS = [
  ['url', 'URL / APK / IPA'],
  ['vpn', 'VPN'],
  ['user', 'User(s)'],
  ['integrations', 'Integrations'],
];

function buildTechSpecsBlocks(techSpecs = {}) {
  const blocks = [heading2('Tech Specs')];
  for (const [key, label] of TECH_SPEC_KEYS) {
    const value = (techSpecs[key] || '').toString().trim();
    blocks.push(labelValueBullet(label, value));
  }
  return blocks;
}

function buildSalesforceBlocks(sf = {}) {
  const blocks = [heading2('SF Details')];
  const rows = [
    ['Account Score', sf.accountScore],
    ['Champion', sf.champion],
    ['Competitor', sf.competitor],
    ['Current QA Setup', sf.currentQASetup],
  ];
  for (const [label, value] of rows) {
    blocks.push(labelValueBullet(label, value));
  }
  return blocks;
}

// Match the SE-authored "Pain Points" custom section, which is also where
// the AI-suggestions flow writes. Promoted to its own top-level section
// to mirror the template (rather than nested under Notes).
function isPainPointsSection(section) {
  return /pain\s*points/i.test((section?.title || '').trim());
}

function buildPainPointsBlocks(customSections) {
  const blocks = [heading2('Pain Points')];
  const sections = Array.isArray(customSections) ? customSections : [];
  const pain = sections.find(isPainPointsSection);
  const body = (pain?.bodyMarkdown || '').trim();
  if (body) {
    for (const chunk of body.split(/\n{2,}/)) {
      blocks.push(paragraph(chunk));
    }
  } else {
    blocks.push(bullet('—'));
  }
  return blocks;
}

function buildNotesBlocks({ notesMarkdown, customSections }) {
  const blocks = [heading2('Notes')];
  const trimmed = (notesMarkdown || '').trim();
  if (trimmed) {
    // Notes are free-form -- preserve blank lines by splitting on \n\n so
    // each chunk becomes its own paragraph. Anything else round-trips as
    // a single paragraph with embedded newlines.
    for (const chunk of trimmed.split(/\n{2,}/)) {
      blocks.push(paragraph(chunk));
    }
  } else {
    blocks.push(paragraph('—'));
  }
  // Pain Points is promoted to its own section, so exclude it here to
  // avoid duplicating it under Notes.
  const sections = (Array.isArray(customSections) ? customSections : []).filter(
    (s) => !isPainPointsSection(s),
  );
  for (const section of sections) {
    const title = (section.title || '').trim() || 'Untitled section';
    blocks.push(heading3(title));
    const body = (section.bodyMarkdown || '').trim();
    if (body) {
      for (const chunk of body.split(/\n{2,}/)) {
        blocks.push(paragraph(chunk));
      }
    } else {
      blocks.push(paragraph('—'));
    }
  }
  return blocks;
}

// Same "first open, else first overall" rule the OppDetail FE uses to
// pick which linked ticket is the canonical representative for a section.
// Mirroring it here keeps the Notion page in sync with what the SE saw.
function pickPrimaryTicket(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.find((t) => !t.isClosed) || list[0];
}

function buildChildBlocks({ opp, sf, gongCalls, linearTickets }) {
  const creationTicket = pickPrimaryTicket(linearTickets?.creation);
  const scopeTicket = pickPrimaryTicket(linearTickets?.scope);
  // Order + dividers mirror the SE Handoff template: Tech Specs, then a
  // side-by-side Creation/Scoping row, Gong Video, Pain Points, Notes,
  // and SF Details, each separated by a horizontal rule.
  return [
    ...buildTechSpecsBlocks(opp.technicalSpecs),
    divider(),
    twoColumns(
      buildCreationInner(opp.creation, creationTicket),
      buildScopingInner(opp.estimation, scopeTicket),
    ),
    divider(),
    ...buildGongsBlocks(gongCalls),
    divider(),
    ...buildPainPointsBlocks(opp.customSections),
    divider(),
    ...buildNotesBlocks({
      notesMarkdown: opp.notesMarkdown,
      customSections: opp.customSections,
    }),
    divider(),
    ...buildSalesforceBlocks(sf),
  ];
}

// ---------------------------------------------------------------------------
// Public: createOppPage
// ---------------------------------------------------------------------------
export async function createOppPage({
  opp,
  sf,
  gongCalls,
  linearTickets,
  ownerSeName,
  ownerSeEmail,
}) {
  const client = getClient();
  if (!client) throw new Error('Notion is not configured.');
  const databaseId = process.env.NOTION_HUNT_BOARD_DATABASE_ID;
  if (!databaseId) throw new Error('NOTION_HUNT_BOARD_DATABASE_ID is not set.');

  // Triggering schema discovery here also gives us the data source id we
  // need for the parent reference (Notion's new data-source-aware page
  // create -- writing to the data source directly is more explicit than
  // routing through the database, and guarantees we write to the same
  // source we read the schema from).
  const schema = await getDatabaseSchema();
  const properties = await buildProperties({ opp, sf, ownerSeName, ownerSeEmail });
  const children = buildChildBlocks({ opp, sf, gongCalls, linearTickets });

  const parent = schema?.dataSourceId
    ? { data_source_id: schema.dataSourceId }
    : { database_id: databaseId };

  const page = await client.pages.create({
    parent,
    properties,
    children,
  });

  return {
    id: page.id,
    url: page.url,
  };
}

// ---------------------------------------------------------------------------
// Public: updateOppPage
//
// Re-syncs an EXISTING Notion page from the latest Opp data. Used by the
// "Update in Notion" flow so an SE can create the handoff page when the
// opp first lands and keep editing it as the deal progresses, rather than
// only generating it once at Closed Won.
//
// Strategy: overwrite both halves of the page.
//   1. properties  -> pages.update (Notion merges, so we re-send all)
//   2. body blocks  -> delete every existing child, then append fresh ones
//
// We replace (not append) the body because it's fully generated from app
// data -- appending would duplicate every section on each sync. The
// trade-off: free-form edits a reader made directly in Notion's body are
// lost on the next sync. Properties and the page itself (comments, etc.)
// are preserved.
// ---------------------------------------------------------------------------
export async function updateOppPage({
  pageId,
  opp,
  sf,
  gongCalls,
  linearTickets,
  ownerSeName,
  ownerSeEmail,
}) {
  const client = getClient();
  if (!client) throw new Error('Notion is not configured.');
  if (!pageId) throw new Error('updateOppPage requires a pageId.');

  // Force schema discovery (also primes the data source id cache).
  await getDatabaseSchema();
  const properties = await buildProperties({ opp, sf, ownerSeName, ownerSeEmail });
  const children = buildChildBlocks({ opp, sf, gongCalls, linearTickets });

  // 1. Properties. Notion throws 404 here if the page was deleted/archived
  //    in Notion -- the caller catches that and recreates a fresh page.
  await client.pages.update({ page_id: pageId, properties });

  // 2. Body. List + delete existing children, then append the freshly
  //    built blocks. Notion caps append at 100 blocks per call.
  await replacePageChildren(client, pageId, children);

  const page = await client.pages.retrieve({ page_id: pageId });
  return { id: page.id, url: page.url };
}

// ---------------------------------------------------------------------------
// Public: archiveOppPage
//
// Moves the handoff page to Notion's trash (Notion has no hard delete via
// the API -- `archived: true` is the documented equivalent and the page
// can still be restored from Notion's trash for 30 days). Called when an
// SE deletes the Opp from the Hunt Board so the Notion DB doesn't keep a
// stale, orphaned handoff page.
//
// Returns { ok: true } on success, { ok: false, reason } when there's
// nothing to do or the page was already gone -- callers treat all of
// these as non-fatal so a Notion hiccup never blocks deleting the Opp.
// ---------------------------------------------------------------------------
export async function archiveOppPage(pageId) {
  const client = getClient();
  if (!client) return { ok: false, reason: 'not_configured' };
  if (!pageId) return { ok: false, reason: 'no_page' };
  try {
    await client.pages.update({ page_id: pageId, archived: true });
    return { ok: true };
  } catch (err) {
    // 404 -> already deleted/archived in Notion; nothing left to do.
    if (err?.status === 404 || err?.code === 'object_not_found') {
      return { ok: false, reason: 'already_gone' };
    }
    throw err;
  }
}

// Delete every direct child of a page/block, then append the supplied
// children. Pagination + chunking keep us within Notion's API limits.
async function replacePageChildren(client, blockId, children) {
  const existingIds = [];
  let cursor;
  do {
     
    const res = await client.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const b of res.results || []) {
      if (b?.id) existingIds.push(b.id);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  for (const id of existingIds) {
     
    await client.blocks.delete({ block_id: id });
  }

  for (let i = 0; i < children.length; i += 100) {
    const chunk = children.slice(i, i + 100);
     
    await client.blocks.children.append({ block_id: blockId, children: chunk });
  }
}

// Test-only escape hatch so a hot-reload flush picks up schema changes
// (e.g. you add a column in Notion and want the next send to see it).
export function _clearCache() {
  _dbCache = null;
  _usersCache = null;
}
