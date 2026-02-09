import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchTeamStandings, type TeamStanding } from '../services/statsService';
import './TeamStandings.css';

function TeamStandings() {
  const [standings, setStandings] = useState<TeamStanding[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadStandings() {
      setIsLoading(true);
      try {
        const data = await fetchTeamStandings();
        setStandings(data);
      } catch (error) {
        console.error('Failed to load standings:', error);
        setStandings([]);
      } finally {
        setIsLoading(false);
      }
    }
    loadStandings();
  }, []);

  if (isLoading) {
    return (
      <div className="team-standings">
        <div className="standings-header">
          <h2>NHL Standings</h2>
        </div>
        <div className="loading-message">
          <p>Loading real-time NHL standings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="team-standings">
      <div className="standings-header">
        <h2>NHL Standings</h2>
        <p className="standings-subtitle">2025-26 Season</p>
      </div>

      <div className="standings-table-container">
        <table className="standings-table">
          <thead>
            <tr>
              <th className="rank-col">#</th>
              <th className="team-col">Team</th>
              <th>GP</th>
              <th>W</th>
              <th>L</th>
              <th>OT</th>
              <th className="pts-col">PTS</th>
              <th>PTS%</th>
              <th>GF</th>
              <th>GA</th>
              <th className="diff-col">Diff</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((team: TeamStanding, index: number) => (
              <tr key={team.teamId || index} className="standing-row">
                <td className="rank-col">{index + 1}</td>
                <td className="team-col">
                  <Link to={`/team/${team.teamAbbrev}`} className="team-info team-link">
                    {team.teamLogo && (
                      <img
                        src={team.teamLogo}
                        alt={team.teamAbbrev}
                        className="team-logo-small"
                      />
                    )}
                    <div>
                      <div className="team-name">{team.teamName}</div>
                      <div className="team-abbrev">{team.teamAbbrev}</div>
                    </div>
                  </Link>
                </td>
                <td>{team.gamesPlayed}</td>
                <td className="wins-col">{team.wins}</td>
                <td className="losses-col">{team.losses}</td>
                <td>{team.otLosses}</td>
                <td className="pts-col">
                  <span className="points-value">{team.points}</span>
                </td>
                <td>{team.pointsPercentage.toFixed(1)}%</td>
                <td>{team.goalsFor}</td>
                <td>{team.goalsAgainst}</td>
                <td className="diff-col">
                  <span
                    className={`diff-value ${team.goalDifferential >= 0 ? 'positive' : 'negative'}`}
                  >
                    {team.goalDifferential >= 0 ? '+' : ''}
                    {team.goalDifferential}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TeamStandings;
