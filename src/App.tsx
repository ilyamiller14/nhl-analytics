import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
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
const CoachingDashboard = lazy(() => import('./pages/CoachingDashboard'));
const ManagementDashboard = lazy(() => import('./pages/ManagementDashboard'));

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
              <Route path="/coaching" element={<LazyRoute><CoachingDashboard /></LazyRoute>} />
              <Route path="/coaching/:teamAbbrev" element={<LazyRoute><CoachingDashboard /></LazyRoute>} />
              <Route path="/management" element={<LazyRoute><ManagementDashboard /></LazyRoute>} />
              <Route path="/management/:teamAbbrev" element={<LazyRoute><ManagementDashboard /></LazyRoute>} />
              <Route path="*" element={
                <LazyRoute>
                  <div className="page-container" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
                    <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>404</h1>
                    <h2 style={{ marginBottom: '1rem' }}>Page Not Found</h2>
                    <p style={{ marginBottom: '2rem', color: '#6b7280' }}>
                      The page you're looking for doesn't exist or has been moved.
                    </p>
                    <a href="/" className="btn btn-primary">Go Home</a>
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
