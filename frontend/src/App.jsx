import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './styles/App.less';
import './styles/themes.less';
import Header from './components/Header';
import Sidebar from './components/layout/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import ProtectedRoute from './components/ProtectedRoute';
import Dashboard from './pages/Dashboard';
import ProjectView from './pages/ProjectView';
import LoginPage from './pages/LoginPage';
import PasswordChangePage from './pages/PasswordChangePage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';

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
  const isAuthPage = location.pathname === '/login' || location.pathname === '/change-password' || location.pathname === '/forgot-password';

  return (
    <div className="app">
      <Header toggleSidebar={toggleSidebar} />
      
      <div className="app-layout">
        {!isAuthPage && <Sidebar isSidebarOpen={isSidebarOpen} />}
        <main className={`main-content ${isAuthPage ? 'auth-page' : ''} ${!isAuthPage && !isSidebarOpen ? 'sidebar-closed' : ''}`}>
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