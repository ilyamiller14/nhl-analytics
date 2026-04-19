import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { ComparisonProvider } from './context/ComparisonContext';
import Navigation from './components/Navigation';
import LoadingFallback from './components/LoadingFallback';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';

// Lazy-loaded route components
const Home = lazy(() => import('./pages/Home'));
const PlayerSearchPage = lazy(() => import('./pages/PlayerSearchPage'));
const PlayerProfile = lazy(() => import('./pages/PlayerProfile'));
const Compare = lazy(() => import('./pages/Compare'));
const Trends = lazy(() => import('./pages/Trends'));
const Teams = lazy(() => import('./pages/Teams'));
const TeamProfile = lazy(() => import('./pages/TeamProfile'));
const AttackDNAPage = lazy(() => import('./pages/AttackDNAPage'));
const ManagementDashboard = lazy(() => import('./pages/ManagementDashboard'));
const DeepLeaderboards = lazy(() => import('./pages/DeepLeaderboards'));
const Glossary = lazy(() => import('./pages/Glossary'));

function LazyRoute({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <Router>
      <ComparisonProvider>
        <div className="app">
          <Navigation />
          <main className="main-content">
            <Routes>
              <Route path="/" element={<LazyRoute><Home /></LazyRoute>} />
              <Route path="/search" element={<LazyRoute><PlayerSearchPage /></LazyRoute>} />
              <Route path="/player/:playerId" element={<LazyRoute><PlayerProfile /></LazyRoute>} />
              <Route path="/compare" element={<LazyRoute><Compare /></LazyRoute>} />
              <Route path="/trends" element={<LazyRoute><Trends /></LazyRoute>} />
              <Route path="/teams" element={<LazyRoute><Teams /></LazyRoute>} />
              <Route path="/team/:teamAbbrev" element={<LazyRoute><TeamProfile /></LazyRoute>} />
              <Route path="/attack-dna/player/:playerId" element={<LazyRoute><AttackDNAPage /></LazyRoute>} />
              <Route path="/attack-dna/team/:teamAbbrev" element={<LazyRoute><AttackDNAPage /></LazyRoute>} />
              {/* Canonical cap/roster route. /contracts and /management
                  were two URLs pointing at the same page — collapsed
                  to /cap with redirects so existing bookmarks survive. */}
              <Route path="/cap" element={<LazyRoute><ManagementDashboard /></LazyRoute>} />
              <Route path="/cap/:teamAbbrev" element={<LazyRoute><ManagementDashboard /></LazyRoute>} />
              <Route path="/contracts" element={<Navigate to="/cap" replace />} />
              <Route path="/contracts/:teamAbbrev" element={<Navigate to="/cap" replace />} />
              <Route path="/management" element={<Navigate to="/cap" replace />} />
              <Route path="/management/:teamAbbrev" element={<Navigate to="/cap" replace />} />
              <Route path="/advanced" element={<LazyRoute><DeepLeaderboards /></LazyRoute>} />
              <Route path="/deep" element={<Navigate to="/advanced" replace />} />
              <Route path="/glossary" element={<LazyRoute><Glossary /></LazyRoute>} />
              <Route path="*" element={
                <LazyRoute>
                  <div className="page-container not-found">
                    <h1 className="not-found__code">404</h1>
                    <h2 className="not-found__title">Page Not Found</h2>
                    <p className="not-found__message">
                      The page you're looking for doesn't exist or has been moved.
                    </p>
                    <Link to="/" className="btn btn-primary">Go Home</Link>
                  </div>
                </LazyRoute>
              } />
            </Routes>
          </main>
        </div>
      </ComparisonProvider>
    </Router>
  );
}

export default App;
