import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from '../hooks/useApp';
import '../styles/index.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
