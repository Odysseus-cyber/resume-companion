import React from 'react';
import ReactDOM from 'react-dom/client';
import { Panel } from '../../src/ui/Panel';
import '../../src/ui/styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>,
);
