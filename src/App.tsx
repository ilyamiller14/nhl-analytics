import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ComparisonProvider } from './context/ComparisonContext';
import Navigation from './components/Navigation';
import Home from './pages/Home';
import PlayerSearchPage from './pages/PlayerSearchPage';
import PlayerProfile from './pages/PlayerProfile';
import Compare from './pages/Compare';
import Trends from './pages/Trends';
import Teams from './pages/Teams';
import TeamProfile from './pages/TeamProfile';
import AttackDNAPage from './pages/AttackDNAPage';
import CoachingDashboard from './pages/CoachingDashboard';
import ManagementDashboard from './pages/ManagementDashboard';
import MovementAnalysis from './pages/MovementAnalysis';
import './App.css';

function App() {
  return (
    <Router>
      <ComparisonProvider>
        <div className="app">
          <Navigation />
          <main className="main-content">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/search" element={<PlayerSearchPage />} />
              <Route path="/player/:playerId" element={<PlayerProfile />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/trends" element={<Trends />} />
              <Route path="/teams" element={<Teams />} />
              <Route path="/team/:teamAbbrev" element={<TeamProfile />} />
              <Route path="/attack-dna/player/:playerId" element={<AttackDNAPage />} />
              <Route path="/attack-dna/team/:teamAbbrev" element={<AttackDNAPage />} />
              <Route path="/coaching" element={<CoachingDashboard />} />
              <Route path="/coaching/:teamAbbrev" element={<CoachingDashboard />} />
              <Route path="/management" element={<ManagementDashboard />} />
              <Route path="/management/:teamAbbrev" element={<ManagementDashboard />} />
              <Route path="/movement/:playerId" element={<MovementAnalysis />} />
              <Route path="/movement/team/:teamAbbrev" element={<MovementAnalysis />} />
            </Routes>
          </main>
        </div>
      </ComparisonProvider>
    </Router>
  );
}

export default App;
