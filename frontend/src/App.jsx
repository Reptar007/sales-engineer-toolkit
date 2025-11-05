import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './styles/App.less';
import './styles/themes.less';
import { useTheme } from './hooks/useTheme';
import Header from './components/Header';
import Sidebar from './components/layout/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import ProtectedRoute from './components/ProtectedRoute';
import Dashboard from './pages/Dashboard';
import ProjectView from './pages/ProjectView';
import LoginPage from './pages/LoginPage';
import PasswordChangePage from './pages/PasswordChangePage';

/**
 * Main App Component with Routing
 * Handles authentication and protected routes
 */
function AppContent() {
  const { theme, artistMode, toggleTheme, toggleArtistMode } = useTheme();
  const location = useLocation();
  
  // Hide sidebar on authentication pages
  const isAuthPage = location.pathname === '/login' || location.pathname === '/change-password';

  return (
    <div className="app">
      <Header
        theme={theme}
        toggleTheme={toggleTheme}
        artistMode={artistMode}
        toggleArtistMode={toggleArtistMode}
      />
      
      <div className="app-layout">
        {!isAuthPage && <Sidebar />}
        <main className="main-content">
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            
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