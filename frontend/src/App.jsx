import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './styles/App.less';
import './styles/themes.less';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './hooks/useTheme';
import Header from './components/Header';
import ErrorBoundary from './components/ErrorBoundary';
import Dashboard from './pages/Dashboard';
import ProjectView from './pages/ProjectView';
import LoginForm from './components/common/LoginForm';

/**
 * Main App Component with Routing
 * Handles authentication and project navigation
 */
function App() {
  const { user, isLoading } = useAuth();
  const { theme, artistMode, toggleTheme, toggleArtistMode } = useTheme();

  // Show loading spinner while checking auth
  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner">Loading...</div>
      </div>
    );
  }

  // Show login form if not authenticated
  if (!user) {
    return (
      <div className="app">
        <Header
          theme={theme}
          toggleTheme={toggleTheme}
          artistMode={artistMode}
          toggleArtistMode={toggleArtistMode}
        />
        <main className="auth-main">
          <LoginForm />
        </main>
      </div>
    );
  }

  // Main app with routing
  return (
    <ErrorBoundary>
      <div className="app">
        <Router>
          <Header
            theme={theme}
            toggleTheme={toggleTheme}
            artistMode={artistMode}
            toggleArtistMode={toggleArtistMode}
          />
          
          <main>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/projects/:projectId" element={<ProjectView />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>

          <footer>
            <p>SalesWolf - Sales Engineer Toolkit</p>
          </footer>
        </Router>
      </div>
    </ErrorBoundary>
  );
}

export default App;