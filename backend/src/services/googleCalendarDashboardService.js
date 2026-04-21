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

function eventMeta(event) {
  const conf = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
  if (conf?.uri) {
    if (/zoom/i.test(conf.uri)) return 'Zoom';
    if (/meet\.google|google\.com\/meet/i.test(conf.uri)) return 'Google Meet';
    if (/teams\.microsoft/i.test(conf.uri)) return 'Microsoft Teams';
    return 'Video call';
  }
  if (event.hangoutLink) {
    return 'Google Meet';
  }
  if (event.location) {
    return event.location.length > 48 ? `${event.location.slice(0, 45)}…` : event.location;
  }
  return 'Calendar';
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
    const startIso = event.start?.dateTime || event.start?.date;
    const time = formatTime(startIso, allDay, timeZone);
    let meta = eventMeta(event);
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
 * @returns {Promise<{ configured: boolean, events: Array<{id: string, time: string, title: string, meta: string, color: string}> }>}
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
