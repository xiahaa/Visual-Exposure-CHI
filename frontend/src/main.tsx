import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

const isWarmup = window.location.pathname === '/warmup' || window.location.pathname.startsWith('/warmup/');
const isSetup = window.location.pathname === '/setup' || window.location.pathname.startsWith('/setup/');
const RoutedExperience = isSetup
  ? lazy(() => import('./StudySetup').then((module) => ({ default: module.StudySetup })))
  : isWarmup
    ? lazy(() => import('./WarmupExperience').then((module) => ({ default: module.WarmupExperience })))
    : lazy(() => import('./App').then((module) => ({ default: module.App })));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="route-loading">Loading experience...</div>}>
      <RoutedExperience />
    </Suspense>
  </React.StrictMode>,
);
