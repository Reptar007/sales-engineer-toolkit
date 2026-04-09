/**
 * Today's events for dashboard calendar card.
 * Share the target calendar with the service account email, or use a public calendar ID.
 *
 * Env:
 *   GOOGLE_CALENDAR_CREDENTIALS — JSON string (service account), same pattern as sheets
 *   GOOGLE_CALENDAR_ID — calendar ID (email address or group calendar ID)
 *   DASHBOARD_CALENDAR_TZ — optional IANA tz for display (default America/New_York)
 */

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

  let google;
  try {
    const mod = await import('googleapis');
    google = mod.google;
  } catch (err) {
    console.error('googleapis not installed:', err.message);
    return { configured: false, events: [] };
  }

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [CALENDAR_SCOPE],
  });

  const client = await auth.getClient();
  const calendar = google.calendar({ version: 'v3', auth: client });

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
  const events = items.map((event, index) => {
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

  return { configured: true, events };
}
