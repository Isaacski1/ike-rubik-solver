import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Register service worker for PWA support
const updateSW = registerSW({
  onNeedRefresh() {
    // Optionally alert user to refresh
  },
  onOfflineReady() {
    // App is ready to work offline
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
