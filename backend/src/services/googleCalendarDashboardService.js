/**
 * Today's events for dashboard calendar card.
 *
 * Per-user OAuth: UserGoogleIntegration + primary calendar (when env + row exist).
 * Legacy: GOOGLE_CALENDAR_CREDENTIALS + GOOGLE_CALENDAR_ID (service account).
 *
 * Env:
 *   GOOGLE_CALENDAR_CREDENTIALS — optional; service account JSON
 *   GOOGLE_CALENDAR_ID — optional; shared calendar id for SA
 *   DASHBOARD_CALENDAR_TZ — optional IANA tz (default America/New_York)
 */

import { google } from 'googleapis';
import { getPrisma } from '../lib/prisma.js';
import { decryptIntegrationSecret } from '../lib/integrationEncryption.js';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

const EVENT_COLORS = ['#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#ec4899'];

function parseCredentials() {
  const raw = process.env.GOOGLE_CALENDAR_CREDENTIALS?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.error('GOOGLE_CALENDAR_CREDENTIALS is not valid JSON');
    return null;
  }
}

function formatTime(isoOrDate, allDay, timeZone) {
  if (allDay) {
    return 'All day';
  }
  if (!isoOrDate) return '';
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(d);
}

// Map a video-conference URL to the friendly provider name we want to
// display in the UI (and on the Join button).
function videoProviderFromUrl(uri) {
  if (!uri) return null;
  if (/zoom/i.test(uri)) return 'Zoom';
  if (/meet\.google|google\.com\/meet/i.test(uri)) return 'Google Meet';
  if (/teams\.microsoft/i.test(uri)) return 'Microsoft Teams';
  if (/whereby\.com/i.test(uri)) return 'Whereby';
  return 'Video call';
}

// Regex used to spot a video-conference URL in free-form fields (location,
// description) when Google didn't attach proper conferenceData. Capture
// group 1 is the URL itself so we can hand it to the Join button on the
// frontend.
const VIDEO_URL_RE =
  /(https?:\/\/[^\s]*(?:zoom\.us|meet\.google|google\.com\/meet|teams\.microsoft|whereby\.com)[^\s)>"']*)/i;

// Pull the best available video-conference URL out of an event, in
// priority order: structured conferenceData → hangoutLink → URL pasted
// into location → URL pasted into description. Returns null when no
// video link can be found.
function extractVideoConference(event) {
  const conf = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
  if (conf?.uri) {
    return { url: conf.uri, provider: videoProviderFromUrl(conf.uri) };
  }
  if (event.hangoutLink) {
    return { url: event.hangoutLink, provider: 'Google Meet' };
  }
  for (const field of [event.location, event.description]) {
    if (typeof field !== 'string') continue;
    const m = field.match(VIDEO_URL_RE);
    if (m?.[1]) {
      return { url: m[1], provider: videoProviderFromUrl(m[1]) };
    }
  }
  return null;
}

function eventMeta(event, video) {
  if (video?.provider) return video.provider;
  if (event.location) {
    return event.location.length > 48 ? `${event.location.slice(0, 45)}…` : event.location;
  }
  return 'Calendar';
}

/**
 * Decide whether an event is a real "meeting" vs a personal time block
 * (focus time, lunch, "Home", solo blocks, etc.).
 *
 * Heuristic — true if ANY of:
 *   1. Has a video conference attached (Meet / Zoom / Teams / hangoutLink).
 *   2. Has a Zoom/Meet/Teams URL in the location field.
 *   3. Has more than one human attendee (room/resource attendees ignored).
 *
 * All-day events are never meetings.
 */
function isMeetingEvent(event) {
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  if (allDay) return false;

  // 1. Proper conference data
  const hasVideoConf = Boolean(
    event.hangoutLink ||
      event.conferenceData?.entryPoints?.some((e) => e.entryPointType === 'video'),
  );
  if (hasVideoConf) return true;

  // 2. Video URL pasted into location (or, as a fallback, description)
  if (VIDEO_URL_RE.test(event.location || '')) return true;
  if (VIDEO_URL_RE.test(event.description || '')) return true;

  // 3. More than one human attendee. Google includes the organizer themselves
  // in this list, so we look for >1 non-resource attendees.
  const attendees = Array.isArray(event.attendees) ? event.attendees : [];
  const humanAttendees = attendees.filter((a) => !a.resource);
  if (humanAttendees.length > 1) return true;

  return false;
}

// Count humans (excluding rooms / resources) on the invite. Used by the
// frontend to render a "👥 N" attendee chip on each meeting.
function countHumanAttendees(event) {
  const attendees = Array.isArray(event.attendees) ? event.attendees : [];
  return attendees.filter((a) => !a.resource).length;
}

// Sanitized attendee list for the dashboard. The frontend renders this
// inside the hover popover on the attendee chip, so we strip any fields
// not needed for display and order them so organizers/self come first.
// Returns an empty array when the event has no attendees (e.g. solo
// blocks that still slipped through the meeting filter).
function buildAttendeeList(event) {
  const attendees = Array.isArray(event.attendees) ? event.attendees : [];
  const humans = attendees.filter((a) => !a.resource);
  const ranked = humans.map((a) => ({
    name: a.displayName || null,
    email: a.email || null,
    responseStatus: a.responseStatus || null,
    organizer: Boolean(a.organizer),
    self: Boolean(a.self),
    optional: Boolean(a.optional),
  }));
  ranked.sort((a, b) => {
    if (a.organizer !== b.organizer) return a.organizer ? -1 : 1;
    if (a.self !== b.self) return a.self ? -1 : 1;
    const an = (a.name || a.email || '').toLowerCase();
    const bn = (b.name || b.email || '').toLowerCase();
    return an.localeCompare(bn);
  });
  return ranked;
}

function durationMeta(event) {
  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;
  if (!start || !end || event.start?.date) return null;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  const mins = Math.round((e - s) / 60000);
  if (mins <= 0) return null;
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h} hr ${m} min` : `${h} hr`;
  }
  return `${mins} min`;
}

function mapItemsToEvents(items, timeZone) {
  return items.map((event, index) => {
    const allDay = Boolean(event.start?.date && !event.start?.dateTime);
    // Google marks Out-of-Office events with eventType === 'outOfOffice'.
    // The dashboard surfaces these even when they're all-day so the SE
    // (and viewers of the team calendar) can still see "PTO" blocks.
    const isOoo = event.eventType === 'outOfOffice';
    const startIso = event.start?.dateTime || event.start?.date;
    const time = formatTime(startIso, allDay, timeZone);
    const video = extractVideoConference(event);
    let meta = eventMeta(event, video);
    const dur = durationMeta(event);
    if (dur && meta) {
      meta = `${meta} · ${dur}`;
    } else if (dur) {
      meta = dur;
    }

    return {
      id: event.id || `cal-${index}`,
      time,
      title: event.summary || '(No title)',
      meta,
      color: EVENT_COLORS[index % EVENT_COLORS.length],
      isMeeting: isMeetingEvent(event),
      isAllDay: allDay,
      isOoo,
      attendeeCount: countHumanAttendees(event),
      attendees: buildAttendeeList(event),
      videoUrl: video?.url || null,
      videoProvider: video?.provider || null,
    };
  });
}

async function listTodayEvents(calendar, calendarId, timeZone) {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const { data } = await calendar.events.list({
    calendarId,
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 25,
  });

  const items = data.items || [];
  return { configured: true, events: mapItemsToEvents(items, timeZone) };
}

/**
 * @returns {Promise<{
 *   configured: boolean,
 *   events: Array<{
 *     id: string, time: string, title: string, meta: string, color: string,
 *     isMeeting: boolean, isAllDay: boolean, isOoo: boolean,
 *     attendeeCount: number,
 *     attendees: Array<{
 *       name: string | null, email: string | null,
 *       responseStatus: string | null,
 *       organizer: boolean, self: boolean, optional: boolean,
 *     }>,
 *     videoUrl: string | null, videoProvider: string | null,
 *   }>
 * }>}
 */
export async function getTodayCalendarEvents() {
  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim();
  const creds = parseCredentials();
  const timeZone = process.env.DASHBOARD_CALENDAR_TZ?.trim() || 'America/New_York';

  if (!creds || !calendarId) {
    return { configured: false, events: [] };
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: [CALENDAR_SCOPE],
    });

    const client = await auth.getClient();
    const calendar = google.calendar({ version: 'v3', auth: client });
    return await listTodayEvents(calendar, calendarId, timeZone);
  } catch (err) {
    console.error('getTodayCalendarEvents (service account):', err.message);
    return { configured: false, events: [] };
  }
}

/** User primary calendar via stored OAuth refresh token. */
export async function getTodayCalendarEventsForUser(userId) {
  const timeZone = process.env.DASHBOARD_CALENDAR_TZ?.trim() || 'America/New_York';
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();

  if (!clientId || !clientSecret || !redirectUri) {
    return { configured: false, events: [] };
  }

  const prisma = await getPrisma();
  const row = await prisma.userGoogleIntegration.findUnique({
    where: { userId },
  });

  if (!row) {
    return { configured: false, events: [] };
  }

  try {
    const refreshToken = decryptIntegrationSecret(row.refreshTokenEnc);
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2.setCredentials({ refresh_token: refreshToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2 });
    return await listTodayEvents(calendar, 'primary', timeZone);
  } catch (err) {
    console.error('getTodayCalendarEventsForUser:', err.message);
    return { configured: false, events: [] };
  }
}

/**
 * Prefer per-user OAuth; fall back to service account when configured.
 * `source`: oauth = user connected Google; service_account = shared env calendar; null = none.
 */
export async function getTodayCalendarForDashboard(userId) {
  const userResult = await getTodayCalendarEventsForUser(userId);
  if (userResult.configured) {
    return { ...userResult, source: 'oauth' };
  }
  const sa = await getTodayCalendarEvents();
  if (sa.configured) {
    return { ...sa, source: 'service_account' };
  }
  return { configured: false, events: [], source: null };
}

/**
 * Today's calendar for a single Sales Engineer, for the lead Pack drill-down.
 * Resolves the SE to their app user, then reads *only* that user's connected
 * Google calendar — never the shared service-account calendar, which would
 * show one identical calendar for every SE. `configured: false` means the SE
 * hasn't linked their Google account yet.
 *
 * @returns {Promise<{ seId: string, name: string, configured: boolean, source: 'oauth' | null, events: Array }>}
 */
export async function getCalendarForSE(seId) {
  const prisma = await getPrisma();
  const se = await prisma.salesEngineer.findUnique({
    where: { id: seId },
    include: { user: true },
  });
  if (!se) {
    const err = new Error('Sales Engineer not found');
    err.statusCode = 404;
    throw err;
  }

  const fullName = `${se.user?.firstName || ''} ${se.user?.lastName || ''}`.trim();
  const base = { seId: se.id, name: fullName || se.user?.email || 'Unknown SE' };

  const result = await getTodayCalendarEventsForUser(se.userId);
  return {
    ...base,
    configured: result.configured,
    source: result.configured ? 'oauth' : null,
    events: result.events,
  };
}
