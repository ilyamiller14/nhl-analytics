import { Link } from 'react-router-dom';
import type { PlayerSearchResult } from '../types/player';
import type { PlayerLandingResponse } from '../types/api';
import { formatPosition, formatHeight, formatWeight } from '../utils/formatters';
import './PlayerCard.css';

interface PlayerCardProps {
  player: PlayerSearchResult | PlayerLandingResponse;
  showStats?: boolean;
  compact?: boolean;
}

function PlayerCard({ player, showStats = false, compact = false }: PlayerCardProps) {
  const playerId = player.playerId;

  // Type guard to check if it's PlayerLandingResponse
  const isPlayerLanding = (p: PlayerSearchResult | PlayerLandingResponse): p is PlayerLandingResponse => {
    return 'firstName' in p && typeof (p as any).firstName === 'object';
  };

  // Get player name based on type
  const getName = () => {
    if (isPlayerLanding(player)) {
      return `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
    }
    return player.name;
  };

  // Get player initials for placeholder
  const getInitials = () => {
    if (isPlayerLanding(player)) {
      return `${player.firstName?.default?.[0] || '?'}${player.lastName?.default?.[0] || '?'}`;
    }
    const parts = player.name.split(' ');
    return `${parts[0]?.[0] || '?'}${parts[parts.length - 1]?.[0] || '?'}`;
  };

  // Get stats only for PlayerLandingResponse
  const stats = isPlayerLanding(player) ? player.featuredStats?.regularSeason?.subSeason : null;
  const careerStats = isPlayerLanding(player) ? player.careerTotals?.regularSeason : null;

  // Get common properties with different names in each type
  const headshot = player.headshot;
  const teamLogo = isPlayerLanding(player) ? player.teamLogo : undefined;
  const teamAbbrev = isPlayerLanding(player) ? player.currentTeamAbbrev : player.teamAbbrev;
  const positionCode = isPlayerLanding(player) ? player.position : player.positionCode;
  const sweaterNumber = isPlayerLanding(player) ? player.sweaterNumber : undefined;
  const teamCommonName = isPlayerLanding(player) ? player.fullTeamName?.default : undefined;
  const heightInInches = isPlayerLanding(player) ? player.heightInInches : undefined;
  const weightInPounds = isPlayerLanding(player) ? player.weightInPounds : undefined;
  const shootsCatches = isPlayerLanding(player) ? player.shootsCatches : undefined;

  return (
    <Link to={`/player/${playerId}`} className={`player-card ${compact ? 'compact' : ''}`}>
      <div className="player-card-header">
        {headshot ? (
          <img src={headshot} alt={getName()} className="player-headshot" />
        ) : (
          <div className="player-headshot-placeholder">
            {getInitials()}
          </div>
        )}

        {teamLogo && (
          <img src={teamLogo} alt={teamAbbrev || 'Team'} className="team-logo" />
        )}
      </div>

      <div className="player-card-body">
        <h3 className="player-name">
          {getName()}
        </h3>

        <div className="player-meta">
          <span className={`position-badge position-${positionCode}`}>
            {formatPosition(positionCode)}
          </span>
          {sweaterNumber && (
            <span className="sweater-number">#{sweaterNumber}</span>
          )}
        </div>

        {teamAbbrev && (
          <div className="player-team">
            {teamCommonName || teamAbbrev}
          </div>
        )}

        {!compact && (
          <>
            {heightInInches && weightInPounds && (
              <div className="player-physical">
                {formatHeight(heightInInches)} • {formatWeight(weightInPounds)}
                {shootsCatches && ` • ${shootsCatches}`}
              </div>
            )}

            {showStats && stats && (
              <div className="player-stats-preview">
                <div className="stat">
                  <span className="stat-label">GP</span>
                  <span className="stat-value">{stats.gamesPlayed}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">G</span>
                  <span className="stat-value">{stats.goals}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">A</span>
                  <span className="stat-value">{stats.assists}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">P</span>
                  <span className="stat-value">{stats.points}</span>
                </div>
              </div>
            )}

            {showStats && careerStats && (
              <div className="career-stats-summary">
                Career: {careerStats.gamesPlayed} GP • {careerStats.goals} G •{' '}
                {careerStats.assists} A • {careerStats.points} P
              </div>
            )}
          </>
        )}
      </div>
    </Link>
  );
}

export default PlayerCard;
