import { Link } from 'react-router-dom';
import type { PlayerLandingResponse } from '../types/api';
import { formatDate, formatHeight, formatWeight, formatPosition } from '../utils/formatters';

export interface EdgeBadge {
  label: string;
  color: string;
}

interface ProfileHeroProps {
  player: PlayerLandingResponse;
  age: number | null;
  edgeBadges: EdgeBadge[];
  onCompare: () => void;
}

/**
 * Hero header for the Player Profile page — avatar, identity, bio,
 * and cross-link quick actions (Compare, View Team, Attack DNA).
 *
 * Extracted from PlayerProfile.tsx to keep that page file from
 * dominating the entire module and to make the hero reusable if
 * we later ship a player card modal or sharable preview.
 */
export default function ProfileHero({ player, age, edgeBadges, onCompare }: ProfileHeroProps) {
  return (
    <div className="profile-header">
      <div className="profile-header-content">
        <div className="profile-hero">
          <div className="profile-image-container">
            {player.headshot ? (
              <img
                src={player.headshot}
                alt={`${player.firstName.default} ${player.lastName.default}`}
                className="profile-image"
              />
            ) : (
              <div className="profile-image-placeholder" aria-hidden="true">
                {player.firstName.default[0]}
                {player.lastName.default[0]}
              </div>
            )}
            {player.teamLogo && (
              <img
                src={player.teamLogo}
                alt={`${player.fullTeamName?.default || player.currentTeamAbbrev} logo`}
                className="profile-team-logo"
              />
            )}
          </div>

          <div className="profile-info">
            <div className="profile-name-section">
              <h1 className="profile-name">
                {player.firstName.default} {player.lastName.default}
              </h1>
              {player.sweaterNumber && (
                <span className="profile-number">#{player.sweaterNumber}</span>
              )}
            </div>

            <div className="profile-meta">
              <span className={`profile-position position-${player.position}`}>
                {formatPosition(player.position)}
              </span>
              {player.fullTeamName && (
                <>
                  <span className="meta-divider">•</span>
                  {player.currentTeamAbbrev ? (
                    <Link
                      to={`/team/${player.currentTeamAbbrev}`}
                      className="profile-team profile-team--link"
                    >
                      {player.fullTeamName.default}
                    </Link>
                  ) : (
                    <span className="profile-team">{player.fullTeamName.default}</span>
                  )}
                </>
              )}
              {!player.isActive && (
                <>
                  <span className="meta-divider">•</span>
                  <span className="inactive-badge">Inactive</span>
                </>
              )}
              {edgeBadges.map((badge, idx) => (
                <span
                  key={`${badge.label}-${idx}`}
                  className="edge-badge"
                  style={{
                    backgroundColor: badge.color,
                    marginLeft: idx === 0 ? '0.5rem' : '0.25rem',
                  }}
                >
                  {badge.label}
                </span>
              ))}
            </div>

            <div className="profile-bio-stats">
              {age && <div className="bio-stat">Age: {age}</div>}
              {player.heightInInches && (
                <div className="bio-stat">Height: {formatHeight(player.heightInInches)}</div>
              )}
              {player.weightInPounds && (
                <div className="bio-stat">Weight: {formatWeight(player.weightInPounds)}</div>
              )}
              {player.shootsCatches && (
                <div className="bio-stat">Shoots: {player.shootsCatches}</div>
              )}
              {player.birthCity && (
                <div className="bio-stat">
                  Born: {player.birthCity.default}, {player.birthCountry} (
                  {formatDate(player.birthDate)})
                </div>
              )}
              {player.draftDetails && (
                <div className="bio-stat">
                  Draft: {player.draftDetails.year} - Round {player.draftDetails.round}, Pick{' '}
                  {player.draftDetails.overallPick} ({player.draftDetails.teamAbbrev})
                </div>
              )}
            </div>

            {/* Quick cross-links so users aren't forced to scroll to the
                bottom of the page to compare, dive deeper, or jump to
                the player's team. */}
            <div className="profile-quick-actions">
              <button type="button" className="profile-quick-btn" onClick={onCompare}>
                Compare This Player
              </button>
              {player.currentTeamAbbrev && (
                <Link to={`/team/${player.currentTeamAbbrev}`} className="profile-quick-btn">
                  View Team
                </Link>
              )}
              <Link
                to={`/attack-dna/player/${player.playerId}`}
                className="profile-quick-btn"
              >
                Attack DNA
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
