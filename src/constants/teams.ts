/**
 * Single source of truth for all NHL team data.
 * Import from here instead of defining team lists inline.
 */

export interface NHLTeam {
  abbrev: string;
  name: string;
  conference: 'Eastern' | 'Western';
  division: 'Atlantic' | 'Metropolitan' | 'Central' | 'Pacific';
}

export const NHL_TEAMS: NHLTeam[] = [
  // Atlantic Division
  { abbrev: 'BOS', name: 'Boston Bruins', conference: 'Eastern', division: 'Atlantic' },
  { abbrev: 'BUF', name: 'Buffalo Sabres', conference: 'Eastern', division: 'Atlantic' },
  { abbrev: 'DET', name: 'Detroit Red Wings', conference: 'Eastern', division: 'Atlantic' },
  { abbrev: 'FLA', name: 'Florida Panthers', conference: 'Eastern', division: 'Atlantic' },
  { abbrev: 'MTL', name: 'Montreal Canadiens', conference: 'Eastern', division: 'Atlantic' },
  { abbrev: 'OTT', name: 'Ottawa Senators', conference: 'Eastern', division: 'Atlantic' },
  { abbrev: 'TBL', name: 'Tampa Bay Lightning', conference: 'Eastern', division: 'Atlantic' },
  { abbrev: 'TOR', name: 'Toronto Maple Leafs', conference: 'Eastern', division: 'Atlantic' },

  // Metropolitan Division
  { abbrev: 'CAR', name: 'Carolina Hurricanes', conference: 'Eastern', division: 'Metropolitan' },
  { abbrev: 'CBJ', name: 'Columbus Blue Jackets', conference: 'Eastern', division: 'Metropolitan' },
  { abbrev: 'NJD', name: 'New Jersey Devils', conference: 'Eastern', division: 'Metropolitan' },
  { abbrev: 'NYI', name: 'New York Islanders', conference: 'Eastern', division: 'Metropolitan' },
  { abbrev: 'NYR', name: 'New York Rangers', conference: 'Eastern', division: 'Metropolitan' },
  { abbrev: 'PHI', name: 'Philadelphia Flyers', conference: 'Eastern', division: 'Metropolitan' },
  { abbrev: 'PIT', name: 'Pittsburgh Penguins', conference: 'Eastern', division: 'Metropolitan' },
  { abbrev: 'WSH', name: 'Washington Capitals', conference: 'Eastern', division: 'Metropolitan' },

  // Central Division
  { abbrev: 'UTA', name: 'Utah Hockey Club', conference: 'Western', division: 'Central' },
  { abbrev: 'CHI', name: 'Chicago Blackhawks', conference: 'Western', division: 'Central' },
  { abbrev: 'COL', name: 'Colorado Avalanche', conference: 'Western', division: 'Central' },
  { abbrev: 'DAL', name: 'Dallas Stars', conference: 'Western', division: 'Central' },
  { abbrev: 'MIN', name: 'Minnesota Wild', conference: 'Western', division: 'Central' },
  { abbrev: 'NSH', name: 'Nashville Predators', conference: 'Western', division: 'Central' },
  { abbrev: 'STL', name: 'St. Louis Blues', conference: 'Western', division: 'Central' },
  { abbrev: 'WPG', name: 'Winnipeg Jets', conference: 'Western', division: 'Central' },

  // Pacific Division
  { abbrev: 'ANA', name: 'Anaheim Ducks', conference: 'Western', division: 'Pacific' },
  { abbrev: 'CGY', name: 'Calgary Flames', conference: 'Western', division: 'Pacific' },
  { abbrev: 'EDM', name: 'Edmonton Oilers', conference: 'Western', division: 'Pacific' },
  { abbrev: 'LAK', name: 'Los Angeles Kings', conference: 'Western', division: 'Pacific' },
  { abbrev: 'SJS', name: 'San Jose Sharks', conference: 'Western', division: 'Pacific' },
  { abbrev: 'SEA', name: 'Seattle Kraken', conference: 'Western', division: 'Pacific' },
  { abbrev: 'VAN', name: 'Vancouver Canucks', conference: 'Western', division: 'Pacific' },
  { abbrev: 'VGK', name: 'Vegas Golden Knights', conference: 'Western', division: 'Pacific' },
];

/** Just the 3-letter abbreviations */
export const NHL_TEAM_ABBREVS: string[] = NHL_TEAMS.map(t => t.abbrev);
