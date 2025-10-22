import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './styles/App.less';
import './styles/themes.less';
import { useTheme } from './hooks/useTheme';
import Header from './components/Header';
import ErrorBoundary from './components/ErrorBoundary';
import Dashboard from './pages/Dashboard';
import ProjectView from './pages/ProjectView';

/**
 * Main App Component with Routing
 * Handles project navigation without authentication
 */
function App() {
  const { theme, artistMode, toggleTheme, toggleArtistMode } = useTheme();

  // Main app with routing - no authentication required
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