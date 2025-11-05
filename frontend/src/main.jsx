import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.less';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthProvider.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
