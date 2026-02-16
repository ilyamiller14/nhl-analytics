import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchLeagueLeaders, fetchGoalieLeaders, type LeagueLeader } from '../services/statsService';
import './LeagueLeaders.css';

const STAT_OPTIONS = [
  { key: 'points', label: 'Points' },
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'plusMinus', label: '+/-' },
  { key: 'wins', label: 'Wins (Goalies)' },
];

function LeagueLeaders() {
  const [selectedStat, setSelectedStat] = useState('points');
  const [displayCount, setDisplayCount] = useState(10);
  const [leaders, setLeaders] = useState<LeagueLeader[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadLeaders() {
      setIsLoading(true);
      try {
        const data = selectedStat === 'wins'
          ? await fetchGoalieLeaders('wins', 50)
          : await fetchLeagueLeaders(selectedStat, 50);
        setLeaders(data);
      } catch (error) {
        console.error('Failed to load leaders:', error);
        setLeaders([]);
      } finally {
        setIsLoading(false);
      }
    }
    loadLeaders();
  }, [selectedStat]);

  const displayedLeaders = leaders.slice(0, displayCount);

  if (isLoading) {
    return (
      <div className="league-leaders">
        <div className="league-leaders-header">
          <h2>League Leaders</h2>
        </div>
        <div className="loading-message" role="status" aria-live="polite">
          <p>Loading real-time NHL leaders...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="league-leaders">
      <div className="league-leaders-header">
        <h2>League Leaders</h2>
        <div className="leaders-controls">
          <select
            value={selectedStat}
            onChange={(e) => setSelectedStat(e.target.value)}
            className="stat-select"
            aria-label="Select statistic category"
          >
            {STAT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={displayCount}
            onChange={(e) => setDisplayCount(parseInt(e.target.value))}
            className="count-select"
            aria-label="Number of leaders to display"
          >
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
            <option value={50}>Top 50</option>
          </select>
        </div>
      </div>

      <div className="leaders-table-container">
        <table className="leaders-table">
          <thead>
            <tr>
              <th className="rank-col">Rank</th>
              <th className="player-col">Player</th>
              <th className="team-col">Team</th>
              <th className="pos-col">Pos</th>
              <th className="stat-col">{STAT_OPTIONS.find((s) => s.key === selectedStat)?.label}</th>
            </tr>
          </thead>
          <tbody>
            {displayedLeaders.map((leader: LeagueLeader, index: number) => (
              <tr key={leader.playerId} className="leader-row">
                <td className="rank-col">
                  <span className={`rank-badge rank-${index + 1}`}>{index + 1}</span>
                </td>
                <td className="player-col">
                  <Link to={`/player/${leader.playerId}`} className="player-link">
                    {leader.name}
                  </Link>
                </td>
                <td className="team-col">{leader.team}</td>
                <td className="pos-col">
                  <span className="position-tag">{leader.position}</span>
                </td>
                <td className="stat-col">
                  <span className="stat-value">{leader.value}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default LeagueLeaders;
