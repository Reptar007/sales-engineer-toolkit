import React, { useCallback, useEffect, useState } from 'react';
import {
  getLinearProfile,
  saveLinearProfile,
  disconnectLinearProfile,
  fetchDashboardCalendar,
  startGoogleCalendarOAuth,
  disconnectGoogleCalendar,
} from '../services/api';
import { useToast } from '../contexts/ToastContext';
import './ProfilePage.less';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function classifyIdentifier(raw) {
  const value = (raw || '').trim();
  if (!value) return { kind: 'empty', value };
  if (value.includes('@')) return { kind: 'email', value };
  if (UUID_RE.test(value)) return { kind: 'id', value };
  return { kind: 'unknown', value };
}

// Initial state for the Google Calendar integration card. Mirrors the
// shape we expect from `fetchDashboardCalendar` plus a few UI flags.
const GOOGLE_CAL_INITIAL = {
  loading: true,
  configured: false,
  // 'oauth'  → user-connected via OAuth (we can disconnect from here)
  // 'service_account' → shared env-level calendar (NOT user-controllable)
  // null     → not connected
  source: null,
  busy: false,
  message: null,
  error: null,
};

export default function ProfilePage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const [googleCal, setGoogleCal] = useState(GOOGLE_CAL_INITIAL);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getLinearProfile();
      setProfile(data);
    } catch (err) {
      setError(err?.message || 'Failed to load your profile');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGoogleCal = useCallback(async () => {
    setGoogleCal((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await fetchDashboardCalendar();
      setGoogleCal((prev) => ({
        ...prev,
        loading: false,
        configured: Boolean(data?.configured),
        source: data?.source ?? null,
      }));
    } catch (err) {
      setGoogleCal((prev) => ({
        ...prev,
        loading: false,
        configured: false,
        source: null,
        error: err?.message || 'Failed to load Google Calendar status',
      }));
    }
  }, []);

  useEffect(() => {
    load();
    loadGoogleCal();
  }, [load, loadGoogleCal]);

  const handleAutoConnect = async () => {
    if (!profile?.appEmail) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const next = await saveLinearProfile({ linearEmail: profile.appEmail });
      setProfile(next);
      const ok = `Connected as ${next.linearUser?.name || 'your Linear account'}.`;
      setMessage(ok);
      toast.success(ok);
    } catch (err) {
      const msg = err?.message || 'Could not connect your Linear account';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const classified = classifyIdentifier(input);

    if (classified.kind === 'empty') {
      setError('Enter a Linear email or user ID.');
      return;
    }
    if (classified.kind === 'unknown') {
      setError('That does not look like an email or a UUID.');
      return;
    }

    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const body =
        classified.kind === 'email'
          ? { linearEmail: classified.value }
          : { linearUserId: classified.value };
      const next = await saveLinearProfile(body);
      setProfile(next);
      setInput('');
      const ok = `Connected as ${next.linearUser?.name || 'your Linear account'}.`;
      setMessage(ok);
      toast.success(ok);
    } catch (err) {
      const msg = err?.message || 'Could not save your Linear account';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await disconnectLinearProfile();
      await load();
      setMessage('Disconnected.');
      toast.success('Linear disconnected.');
    } catch (err) {
      const msg = err?.message || 'Could not disconnect';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleConnectGoogleCal = async () => {
    setGoogleCal((prev) => ({ ...prev, busy: true, message: null, error: null }));
    try {
      const data = await startGoogleCalendarOAuth();
      if (data?.authorizationUrl) {
        // Redirect to Google's consent screen. On return, the dashboard
        // route handles the `?google_calendar=…` callback and refreshes.
        window.location.href = data.authorizationUrl;
        return;
      }
      const msg = 'Could not start Google Calendar connection';
      setGoogleCal((prev) => ({ ...prev, busy: false, error: msg }));
      toast.error(msg);
    } catch (err) {
      const msg = err?.message || 'Could not start Google Calendar connection';
      setGoogleCal((prev) => ({ ...prev, busy: false, error: msg }));
      toast.error(msg);
    }
  };

  const handleDisconnectGoogleCal = async () => {
    setGoogleCal((prev) => ({ ...prev, busy: true, message: null, error: null }));
    try {
      await disconnectGoogleCalendar();
      await loadGoogleCal();
      setGoogleCal((prev) => ({ ...prev, busy: false, message: 'Disconnected.' }));
      toast.success('Google Calendar disconnected.');
    } catch (err) {
      const msg = err?.message || 'Could not disconnect Google Calendar';
      setGoogleCal((prev) => ({ ...prev, busy: false, error: msg }));
      toast.error(msg);
    }
  };

  // Once a user is OAuth-connected, we expose a Disconnect control.
  // For service-account-backed calendars there's nothing for them to
  // disconnect (it's an env-level setup), so we just label it as such.
  const googleConnectedViaOauth = googleCal.configured && googleCal.source === 'oauth';
  const googleConnectedViaServiceAccount =
    googleCal.configured && googleCal.source === 'service_account';

  return (
    <div className="profile-page">
      <header className="profile-page__header">
        <h1>Profile</h1>
        <p className="profile-page__subtitle">Integrations and account preferences.</p>
      </header>

      <div className="profile-page__sections">
        <section className="profile-card" aria-labelledby="linear-heading">
          <div className="profile-card__head">
            <h2 id="linear-heading">Linear</h2>
            <span className="profile-card__meta">
              Link your Linear account so your dashboard shows only issues assigned to you.
            </span>
          </div>

          {loading && <p className="profile-card__status">Loading…</p>}

          {!loading && error && (
            <p className="profile-card__status profile-card__status--error" role="alert">
              {error}
            </p>
          )}

          {!loading && message && (
            <p className="profile-card__status profile-card__status--ok" role="status">
              {message}
            </p>
          )}

          {!loading && profile && !profile.hasSalesEngineer && (
            <div className="profile-card__body">
              <p>
                Your account is not set up as a Sales Engineer. Ask an admin to assign you to a team
                before connecting Linear.
              </p>
            </div>
          )}

          {!loading && profile && profile.hasSalesEngineer && profile.linearUserId && (
            <div className="profile-card__body">
              <p>
                <strong>Connected as</strong>{' '}
                {profile.linearUser
                  ? `${profile.linearUser.name} <${profile.linearUser.email}>`
                  : profile.linearUserId}
              </p>
              <div className="profile-card__actions">
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={handleDisconnect}
                  disabled={busy}
                >
                  {busy ? 'Working…' : 'Disconnect Linear'}
                </button>
              </div>
            </div>
          )}

          {!loading && profile && profile.hasSalesEngineer && !profile.linearUserId && (
            <div className="profile-card__body">
              {profile.autoResolvable ? (
                <>
                  <p>
                    We found a Linear user matching your app email (<code>{profile.appEmail}</code>
                    ). Click connect to link them.
                  </p>
                  <div className="profile-card__actions">
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={handleAutoConnect}
                      disabled={busy}
                    >
                      {busy ? 'Connecting…' : 'Connect Linear'}
                    </button>
                  </div>
                </>
              ) : (
                <p>
                  We could not auto-match your app email (<code>{profile.appEmail}</code>) to a
                  Linear user. Paste your Linear email (or user UUID) below.
                </p>
              )}

              <form onSubmit={handleSave} className="profile-card__form">
                <label htmlFor="linear-identifier">Linear email or user ID</label>
                <input
                  id="linear-identifier"
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="jane@company.com or UUID"
                  autoComplete="off"
                  disabled={busy}
                />
                <div className="profile-card__actions">
                  <button type="submit" className="btn btn--primary" disabled={busy}>
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </section>

        <section className="profile-card" aria-labelledby="google-cal-heading">
          <div className="profile-card__head">
            <h2 id="google-cal-heading">Google Calendar</h2>
            <span className="profile-card__meta">
              Connect your Google account so today&apos;s meetings appear on your dashboard.
            </span>
          </div>

          {googleCal.loading && <p className="profile-card__status">Loading…</p>}

          {!googleCal.loading && googleCal.error && (
            <p className="profile-card__status profile-card__status--error" role="alert">
              {googleCal.error}
            </p>
          )}

          {!googleCal.loading && googleCal.message && (
            <p className="profile-card__status profile-card__status--ok" role="status">
              {googleCal.message}
            </p>
          )}

          {!googleCal.loading && googleConnectedViaOauth && (
            <div className="profile-card__body">
              <p>
                <strong>Connected.</strong> Today&apos;s events from your primary Google Calendar
                will appear on your dashboard.
              </p>
              <div className="profile-card__actions">
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={handleDisconnectGoogleCal}
                  disabled={googleCal.busy}
                >
                  {googleCal.busy ? 'Working…' : 'Disconnect Google Calendar'}
                </button>
              </div>
            </div>
          )}

          {!googleCal.loading && googleConnectedViaServiceAccount && (
            <div className="profile-card__body">
              <p>
                Calendar events are loaded via a shared, admin-configured service account.
                There&apos;s nothing to disconnect here — reach out to your admin to change the
                calendar source.
              </p>
            </div>
          )}

          {!googleCal.loading && !googleCal.configured && (
            <div className="profile-card__body">
              <p>
                You haven&apos;t connected Google Calendar yet. Connect to surface today&apos;s
                meetings (with Zoom / Meet / Teams join links) on your dashboard.
              </p>
              <div className="profile-card__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleConnectGoogleCal}
                  disabled={googleCal.busy}
                >
                  {googleCal.busy ? 'Redirecting…' : 'Connect Google Calendar'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
