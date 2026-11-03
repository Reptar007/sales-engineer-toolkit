/**
 * Lone Wolves -- the server's connection to Metronome, so CSMs can pull a
 * customer's AI credits with one click and never see Metronome.
 *
 * An admin with a Metronome login pastes the code from their Metronome
 * session once (metronomeClient.js says why it is that code and not an API
 * key: only Metronome's own UI endpoint gives the per-environment events).
 * Every pull until it expires uses it. The code lives in this process's
 * memory only: never in the database, never logged, never sent to the page,
 * and gone when the dyno restarts or the code runs out (about a day), when
 * Metronome turns it down, or when an admin disconnects.
 */
import { OnboardingError } from './workspaceStore.js';
import { TOKEN_REJECTED, cleanToken } from './metronomeClient.js';

/** How long a code is taken to last when it does not say: Metronome's are about a day. */
export const DEFAULT_LIFETIME_MS = 24 * 60 * 60 * 1000;

export const NOT_CONNECTED = 'METRONOME_NOT_CONNECTED';

let connection = null;

/** Test hook: forget the connection. */
export function resetConnection() {
  connection = null;
}

/**
 * When the code stops working, in ms: the `exp` of the JWT Metronome hands
 * its UI, else a day from now. Read only, never verified; Metronome checks it.
 */
export function tokenExpiry(token, now = Date.now()) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (Number.isFinite(payload?.exp)) return payload.exp * 1000;
  } catch {
    // Not a JWT; fall through to the default.
  }
  return now + DEFAULT_LIFETIME_MS;
}

const live = (now) => {
  if (connection && connection.expiresAt <= now) connection = null;
  return connection;
};

/** Connect with a pasted code. Refused when it is empty or has already run out. */
export function connectMetronome(pasted, viewer, now = Date.now()) {
  const token = cleanToken(pasted);
  if (!token)
    throw new OnboardingError('ONBOARDING_INVALID', 'Paste the code from Metronome first.');
  const expiresAt = tokenExpiry(token, now);
  if (expiresAt <= now) {
    throw new OnboardingError(
      TOKEN_REJECTED,
      'That code has already run out. Copy a fresh one from Metronome.',
    );
  }
  connection = { token, connectedAt: now, expiresAt, by: viewer?.email || null };
  return connectionStatus(now);
}

/** Drop the connection; with a token, only if it is still the one in use. */
export function disconnectMetronome(token = null) {
  if (!token || connection?.token === token) connection = null;
}

/** The code to pull with, or an OnboardingError the page explains when there is none. */
export function metronomeToken(now = Date.now()) {
  const current = live(now);
  if (!current) {
    throw new OnboardingError(
      NOT_CONNECTED,
      'SalesWolf is not connected to Metronome right now. An admin needs to reconnect it.',
    );
  }
  return current.token;
}

/** What the page may know: whether it is connected, since and until when, by whom. Never the code. */
export function connectionStatus(now = Date.now()) {
  const current = live(now);
  return current
    ? {
        connected: true,
        connectedAt: new Date(current.connectedAt).toISOString(),
        expiresAt: new Date(current.expiresAt).toISOString(),
        by: current.by,
      }
    : { connected: false };
}
