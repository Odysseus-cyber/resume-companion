import React from 'react';
import ReactDOM from 'react-dom/client';
import { Dashboard } from '../../src/ui/Dashboard';
import '../../src/ui/styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>,
);
