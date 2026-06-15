import '../shared/webview-src/style.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../shared/webview-src/App';
import { Sidebar } from './Sidebar';

const root = document.getElementById('root');
if (root) createRoot(root).render(<App sidebar={<Sidebar />} />);
