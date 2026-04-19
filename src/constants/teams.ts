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

/**
 * Each team's primary brand color, used for accent bars on the share
 * card and any team-themed UI element. These are observable brand
 * facts (jersey/logo primary), not analytics values — kept here so
 * there's a single source of truth and no per-component hex sprawl.
 *
 * Falls back to NHL navy when an abbreviation isn't recognized.
 */
const TEAM_PRIMARY_COLORS: Record<string, string> = {
  ANA: '#F47A38', // Orange
  BOS: '#FFB81C', // Gold (iconic vs. black)
  BUF: '#002654', // Navy
  CAR: '#CC0000', // Red
  CBJ: '#002654', // Union Blue
  CGY: '#C8102E', // Flames Red
  CHI: '#CF0A2C', // Red
  COL: '#6F263D', // Burgundy
  DAL: '#006847', // Victory Green
  DET: '#CE1126', // Red
  EDM: '#FF4C00', // Oilers Orange
  FLA: '#C8102E', // Red
  LAK: '#111111', // Black
  MIN: '#154734', // Forest Green
  MTL: '#AF1E2D', // Habs Red
  NJD: '#CE1126', // Red
  NSH: '#FFB81C', // Predators Gold
  NYI: '#00539B', // Royal Blue
  NYR: '#0038A8', // Rangers Blue
  OTT: '#C52032', // Red
  PHI: '#F74902', // Flyers Orange
  PIT: '#FCB514', // Vegas Gold
  SEA: '#99D9D9', // Boundless Blue (teal)
  SJS: '#006D75', // Pacific Teal
  STL: '#002F87', // Blue Note Blue
  TBL: '#002868', // Bolts Blue
  TOR: '#00205B', // Leafs Blue
  UTA: '#71AFE5', // Salt Lake Sky
  VAN: '#00205B', // Canucks Blue
  VGK: '#B4975A', // Vegas Gold
  WPG: '#041E42', // Aviator Blue
  WSH: '#C8102E', // Capitals Red
};

/** NHL navy fallback — same value as `--primary-blue` in index.css. */
const DEFAULT_TEAM_COLOR = '#003087';

/**
 * Look up a team's primary brand color by its 3-letter abbrev.
 * Case-insensitive; returns NHL navy when unrecognized so the UI
 * never breaks on a missing or misspelled code.
 */
export function getTeamPrimaryColor(abbrev?: string | null): string {
  if (!abbrev) return DEFAULT_TEAM_COLOR;
  return TEAM_PRIMARY_COLORS[abbrev.toUpperCase()] ?? DEFAULT_TEAM_COLOR;
}
