import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './styles/App.less';
import './styles/themes.less';
import Sidebar from './components/layout/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import ProtectedRoute from './components/ProtectedRoute';
import BootstrapGate from './components/BootstrapGate';
import Dashboard from './pages/Dashboard';
import ProjectView from './pages/ProjectView';
import LoginPage from './pages/LoginPage';
import PasswordChangePage from './pages/PasswordChangePage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ProfilePage from './pages/ProfilePage';
import Admin from './projects/admin';
import SalesforceCalculator from './projects/salesforce/calculator';
import SalesforceLookup from './projects/salesforce/lookup';
import SalesforceMetrics from './projects/salesforce-metrics';
import TeamPage from './projects/team';

/**
 * Main App Component with Routing
 * Handles authentication and protected routes
 */
function AppContent() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const location = useLocation();

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  // Hide sidebar on authentication pages
  const isAuthPage =
    location.pathname === '/login' ||
    location.pathname === '/change-password' ||
    location.pathname === '/forgot-password';

  const isCollapsed = !isAuthPage && !isSidebarOpen;

  return (
    <div className={`app ${isCollapsed ? 'app--sidebar-collapsed' : ''}`}>
      <div className="app-layout">
        {!isAuthPage && <Sidebar isSidebarOpen={isSidebarOpen} toggleSidebar={toggleSidebar} />}
        <main
          className={`main-content ${isAuthPage ? 'auth-page' : ''} ${!isAuthPage && !isSidebarOpen ? 'sidebar-closed' : ''}`}
        >
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />

            {/* Protected routes - password change requires auth but allows mustChangePassword */}
            <Route
              path="/change-password"
              element={
                <ProtectedRoute>
                  <PasswordChangePage />
                </ProtectedRoute>
              }
            />

            {/* Protected routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/teams/:slug"
              element={
                <ProtectedRoute>
                  <TeamPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/projects/salesforce-metrics"
              element={
                <ProtectedRoute>
                  <SalesforceMetrics />
                </ProtectedRoute>
              }
            />
            <Route
              path="/projects/salesforce/calculator"
              element={
                <ProtectedRoute>
                  <SalesforceCalculator />
                </ProtectedRoute>
              }
            />
            <Route
              path="/projects/salesforce/lookup"
              element={
                <ProtectedRoute>
                  <SalesforceLookup />
                </ProtectedRoute>
              }
            />

            <Route
              path="/projects/:projectId"
              element={
                <ProtectedRoute>
                  <ProjectView />
                </ProtectedRoute>
              }
            />

            {/* Catch all - redirect to home */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      <footer>
        <p>SalesWolf - Sales Engineer Toolkit</p>
      </footer>

      {/*
        Session-level post-login splash. Lives at the app shell so it
        plays once per login regardless of which route the user lands
        on (e.g. coming back to /alpha-pack after re-auth still gets
        the splash + dashboard prewarm).
      */}
      <BootstrapGate />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <AppContent />
      </Router>
    </ErrorBoundary>
  );
}

export default App;
