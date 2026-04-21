import React, { useCallback, useEffect, useState } from 'react';
import {
  getLinearProfile,
  saveLinearProfile,
  disconnectLinearProfile,
} from '../services/api';
import './ProfilePage.less';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function classifyIdentifier(raw) {
  const value = (raw || '').trim();
  if (!value) return { kind: 'empty', value };
  if (value.includes('@')) return { kind: 'email', value };
  if (UUID_RE.test(value)) return { kind: 'id', value };
  return { kind: 'unknown', value };
}

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

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

  useEffect(() => {
    load();
  }, [load]);

  const handleAutoConnect = async () => {
    if (!profile?.appEmail) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const next = await saveLinearProfile({ linearEmail: profile.appEmail });
      setProfile(next);
      setMessage(`Connected as ${next.linearUser?.name || 'your Linear account'}.`);
    } catch (err) {
      setError(err?.message || 'Could not connect your Linear account');
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
      setMessage(`Connected as ${next.linearUser?.name || 'your Linear account'}.`);
    } catch (err) {
      setError(err?.message || 'Could not save your Linear account');
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
    } catch (err) {
      setError(err?.message || 'Could not disconnect');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-page">
      <header className="profile-page__header">
        <h1>Profile</h1>
        <p className="profile-page__subtitle">
          Integrations and account preferences.
        </p>
      </header>

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
              Your account is not set up as a Sales Engineer. Ask an admin to assign you
              to a team before connecting Linear.
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

        {!loading &&
          profile &&
          profile.hasSalesEngineer &&
          !profile.linearUserId && (
            <div className="profile-card__body">
              {profile.autoResolvable ? (
                <>
                  <p>
                    We found a Linear user matching your app email (
                    <code>{profile.appEmail}</code>). Click connect to link them.
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
                  We could not auto-match your app email (<code>{profile.appEmail}</code>)
                  to a Linear user. Paste your Linear email (or user UUID) below.
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
    </div>
  );
}
