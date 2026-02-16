/**
 * Teams Page
 *
 * Lists all NHL teams with links to individual team profiles
 */

import { Link } from 'react-router-dom';
import { NHL_TEAMS } from '../constants/teams';
import './Teams.css';

interface Team {
  teamAbbrev: string;
  teamName: string;
  conference: string;
  division: string;
}

// Map canonical team data to the shape used by this page
const ALL_TEAMS: Team[] = NHL_TEAMS.map(t => ({
  teamAbbrev: t.abbrev,
  teamName: t.name,
  conference: t.conference,
  division: t.division,
}));

// Sort teams alphabetically by name
const sortedByName = (teams: Team[]) => [...teams].sort((a, b) => a.teamName.localeCompare(b.teamName));

// Group teams by conference
const EASTERN_TEAMS = sortedByName(ALL_TEAMS.filter(t => t.conference === 'Eastern'));
const WESTERN_TEAMS = sortedByName(ALL_TEAMS.filter(t => t.conference === 'Western'));

function Teams() {
  return (
    <div className="teams-page">
      <div className="teams-header">
        <h1>NHL Teams</h1>
        <p>Select a team to view detailed analytics and roster information</p>
      </div>

      <div className="conferences-container">
        {/* Eastern Conference */}
        <div className="conference-section">
          <div className="conference-header eastern">
            <h2 className="conference-title">Eastern Conference</h2>
            <span className="team-count">{EASTERN_TEAMS.length} Teams</span>
          </div>
          <div className="teams-list">
            {EASTERN_TEAMS.map(team => (
              <Link
                key={team.teamAbbrev}
                to={`/team/${team.teamAbbrev}`}
                className="team-row"
              >
                <span className="team-abbrev">{team.teamAbbrev}</span>
                <span className="team-name">{team.teamName}</span>
                <span className="team-division">{team.division}</span>
                <span className="team-arrow">&rarr;</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Western Conference */}
        <div className="conference-section">
          <div className="conference-header western">
            <h2 className="conference-title">Western Conference</h2>
            <span className="team-count">{WESTERN_TEAMS.length} Teams</span>
          </div>
          <div className="teams-list">
            {WESTERN_TEAMS.map(team => (
              <Link
                key={team.teamAbbrev}
                to={`/team/${team.teamAbbrev}`}
                className="team-row"
              >
                <span className="team-abbrev">{team.teamAbbrev}</span>
                <span className="team-name">{team.teamName}</span>
                <span className="team-division">{team.division}</span>
                <span className="team-arrow">&rarr;</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Teams;
