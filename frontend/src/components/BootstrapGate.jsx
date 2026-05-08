import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import DashboardLoadingScreen from './dashboard/DashboardLoadingScreen';
import useDashboardBootstrap from '../hooks/useDashboardBootstrap';
import { useAuth } from '../contexts/AuthContext';

// Routes where the splash should NOT render. We don't want to cover
// the change-password form or the login screen itself, so the splash
// is deferred until the user navigates into the authenticated app.
const AUTH_ROUTES = new Set(['/login', '/change-password', '/forgot-password']);

// Must match the .dashboard-loading transition duration in
// DashboardLoadingScreen.less so the overlay stays mounted long enough
// for the fade-out to play before we yank it from the DOM.
const LOADER_FADE_MS = 500;

/**
 * BootstrapGate
 *
 * Session-level "post-login splash" that warms the dashboard's data
 * sources and shows the underwater loading screen on top of the entire
 * app shell. Lives in <AppContent /> rather than inside <Dashboard />
 * so it plays once per session — after every successful login or fresh
 * page reload — regardless of which route the user is redirected to.
 *
 * Behavior:
 *   - Reads `needsBootstrap` from auth context (set on login + initial
 *     token check, cleared on logout).
 *   - When true, mounts the loading overlay and kicks off
 *     useDashboardBootstrap to prefetch calendar + Linear + Salesforce.
 *   - When the bootstrap settles, plays a fade-out then calls
 *     `markBootstrapped()` so subsequent navigations don't replay it.
 *   - Renders nothing when no bootstrap is in flight.
 */
function BootstrapGate() {
  const { needsBootstrap, markBootstrapped } = useAuth();
  const location = useLocation();

  // Defer the splash on auth-only routes so it doesn't cover the
  // login / change-password / forgot-password forms. The flag stays
  // armed and will fire as soon as the user lands inside the app.
  const isAuthRoute = AUTH_ROUTES.has(location.pathname);

  if (!needsBootstrap || isAuthRoute) return null;

  return <ActiveBootstrap onComplete={markBootstrapped} fadeMs={LOADER_FADE_MS} />;
}

// Split into a child component so the bootstrap hook is only mounted
// (and its fetches only fired) while a splash is actually active.
function ActiveBootstrap({ onComplete, fadeMs }) {
  const { ready } = useDashboardBootstrap();
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    if (!ready || hiding) return;
    setHiding(true);
    const t = setTimeout(() => {
      onComplete();
    }, fadeMs);
    return () => clearTimeout(t);
  }, [ready, hiding, onComplete, fadeMs]);

  return <DashboardLoadingScreen hiding={hiding} />;
}

export default BootstrapGate;
