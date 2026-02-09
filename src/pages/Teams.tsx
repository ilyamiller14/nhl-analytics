/**
 * Teams Page
 *
 * Lists all NHL teams with links to individual team profiles
 */

import { Link } from 'react-router-dom';
import './Teams.css';

interface Team {
  teamAbbrev: string;
  teamName: string;
  conference: string;
  division: string;
  logo?: string;
}

// All 32 NHL teams organized by division
const NHL_TEAMS: Team[] = [
  // Atlantic Division
  { teamAbbrev: 'BOS', teamName: 'Boston Bruins', conference: 'Eastern', division: 'Atlantic' },
  { teamAbbrev: 'BUF', teamName: 'Buffalo Sabres', conference: 'Eastern', division: 'Atlantic' },
  { teamAbbrev: 'DET', teamName: 'Detroit Red Wings', conference: 'Eastern', division: 'Atlantic' },
  { teamAbbrev: 'FLA', teamName: 'Florida Panthers', conference: 'Eastern', division: 'Atlantic' },
  { teamAbbrev: 'MTL', teamName: 'Montreal Canadiens', conference: 'Eastern', division: 'Atlantic' },
  { teamAbbrev: 'OTT', teamName: 'Ottawa Senators', conference: 'Eastern', division: 'Atlantic' },
  { teamAbbrev: 'TBL', teamName: 'Tampa Bay Lightning', conference: 'Eastern', division: 'Atlantic' },
  { teamAbbrev: 'TOR', teamName: 'Toronto Maple Leafs', conference: 'Eastern', division: 'Atlantic' },

  // Metropolitan Division
  { teamAbbrev: 'CAR', teamName: 'Carolina Hurricanes', conference: 'Eastern', division: 'Metropolitan' },
  { teamAbbrev: 'CBJ', teamName: 'Columbus Blue Jackets', conference: 'Eastern', division: 'Metropolitan' },
  { teamAbbrev: 'NJD', teamName: 'New Jersey Devils', conference: 'Eastern', division: 'Metropolitan' },
  { teamAbbrev: 'NYI', teamName: 'New York Islanders', conference: 'Eastern', division: 'Metropolitan' },
  { teamAbbrev: 'NYR', teamName: 'New York Rangers', conference: 'Eastern', division: 'Metropolitan' },
  { teamAbbrev: 'PHI', teamName: 'Philadelphia Flyers', conference: 'Eastern', division: 'Metropolitan' },
  { teamAbbrev: 'PIT', teamName: 'Pittsburgh Penguins', conference: 'Eastern', division: 'Metropolitan' },
  { teamAbbrev: 'WSH', teamName: 'Washington Capitals', conference: 'Eastern', division: 'Metropolitan' },

  // Central Division
  { teamAbbrev: 'UTA', teamName: 'Utah Hockey Club', conference: 'Western', division: 'Central' },
  { teamAbbrev: 'CHI', teamName: 'Chicago Blackhawks', conference: 'Western', division: 'Central' },
  { teamAbbrev: 'COL', teamName: 'Colorado Avalanche', conference: 'Western', division: 'Central' },
  { teamAbbrev: 'DAL', teamName: 'Dallas Stars', conference: 'Western', division: 'Central' },
  { teamAbbrev: 'MIN', teamName: 'Minnesota Wild', conference: 'Western', division: 'Central' },
  { teamAbbrev: 'NSH', teamName: 'Nashville Predators', conference: 'Western', division: 'Central' },
  { teamAbbrev: 'STL', teamName: 'St. Louis Blues', conference: 'Western', division: 'Central' },
  { teamAbbrev: 'WPG', teamName: 'Winnipeg Jets', conference: 'Western', division: 'Central' },

  // Pacific Division
  { teamAbbrev: 'ANA', teamName: 'Anaheim Ducks', conference: 'Western', division: 'Pacific' },
  { teamAbbrev: 'CGY', teamName: 'Calgary Flames', conference: 'Western', division: 'Pacific' },
  { teamAbbrev: 'EDM', teamName: 'Edmonton Oilers', conference: 'Western', division: 'Pacific' },
  { teamAbbrev: 'LAK', teamName: 'Los Angeles Kings', conference: 'Western', division: 'Pacific' },
  { teamAbbrev: 'SJS', teamName: 'San Jose Sharks', conference: 'Western', division: 'Pacific' },
  { teamAbbrev: 'SEA', teamName: 'Seattle Kraken', conference: 'Western', division: 'Pacific' },
  { teamAbbrev: 'VAN', teamName: 'Vancouver Canucks', conference: 'Western', division: 'Pacific' },
  { teamAbbrev: 'VGK', teamName: 'Vegas Golden Knights', conference: 'Western', division: 'Pacific' },
];

// Sort teams alphabetically by name
const sortedByName = (teams: Team[]) => [...teams].sort((a, b) => a.teamName.localeCompare(b.teamName));

// Group teams by conference
const EASTERN_TEAMS = sortedByName(NHL_TEAMS.filter(t => t.conference === 'Eastern'));
const WESTERN_TEAMS = sortedByName(NHL_TEAMS.filter(t => t.conference === 'Western'));

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
