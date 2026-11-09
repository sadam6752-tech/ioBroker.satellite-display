// Entry of the Vite build only: the admin loads the component through module federation
// (customComponents.js, exposes ./Components), not through this page.
import React from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(<div>Tile editor of ioBroker.satellite-display: open it in the instance settings.</div>);
}
