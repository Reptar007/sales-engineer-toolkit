import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.less';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthProvider.jsx';
import { ToastProvider } from './contexts/ToastProvider.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
