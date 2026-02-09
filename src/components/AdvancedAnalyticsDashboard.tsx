/**
 * Advanced Analytics Dashboard
 *
 * Comprehensive display of all advanced analytics:
 * - xG metrics
 * - Zone entries/exits
 * - Rush attacks
 * - Royal road passes
 * - Defensive coverage
 */

import { useMemo } from 'react';
import type { AdvancedPlayerAnalytics } from '../hooks/useAdvancedPlayerAnalytics';
import RoyalRoadInsights from './RoyalRoadInsights';
import './AdvancedAnalyticsDashboard.css';

interface AdvancedAnalyticsDashboardProps {
  analytics: AdvancedPlayerAnalytics;
  playerName?: string;
}

export default function AdvancedAnalyticsDashboard({
  analytics,
  playerName,
}: AdvancedAnalyticsDashboardProps) {
  const {
    xGMetrics,
    individualXG,
    royalRoadPasses,
    zoneAnalytics,
    rushAnalytics,
    defensiveAnalytics,
    totalGames,
    totalShots,
    totalGoals,
  } = analytics;

  // Calculate per-game averages
  const perGameStats = useMemo(() => {
    return {
      shotsPerGame: totalGames > 0 ? (totalShots / totalGames).toFixed(1) : '0.0',
      goalsPerGame: totalGames > 0 ? (totalGoals / totalGames).toFixed(2) : '0.00',
      // Use individual xG (player's own shots) for per-game xG
      ixGPerGame: individualXG?.ixGPerGame?.toFixed(2) || '0.00',
      // On-ice xG per game (team performance when player on ice)
      onIceXGPerGame: totalGames > 0 ? (xGMetrics.xGF / totalGames).toFixed(2) : '0.00',
      rushesPerGame: totalGames > 0 ? (rushAnalytics.totalRushes / totalGames).toFixed(1) : '0.0',
    };
  }, [totalGames, totalShots, totalGoals, xGMetrics.xGF, individualXG, rushAnalytics.totalRushes]);

  return (
    <div className="advanced-analytics-dashboard">
      <h2 className="dashboard-title">
        Advanced Analytics {playerName && `— ${playerName}`}
      </h2>

      <div className="analytics-overview">
        <div className="overview-card">
          <div className="card-content">
            <div className="card-value">{totalGames}</div>
            <div className="card-label">Games Analyzed</div>
          </div>
        </div>
        <div className="overview-card">
          <div className="card-content">
            <div className="card-value">{totalShots}</div>
            <div className="card-label">Total Shots</div>
          </div>
        </div>
        <div className="overview-card">
          <div className="card-content">
            <div className="card-value">{totalGoals}</div>
            <div className="card-label">Goals</div>
          </div>
        </div>
        <div className="overview-card">
          <div className="card-content">
            <div className="card-value">{xGMetrics.xGF.toFixed(2)}</div>
            <div className="card-label">Expected Goals</div>
          </div>
        </div>
      </div>

      {/* Expected Goals Section */}
      <section className="analytics-section">
        <h3 className="section-title">Expected Goals (xG)</h3>
        <div className="metrics-grid">
          <div className="metric-card xg-for">
            <div className="metric-label">xG For</div>
            <div className="metric-value">{xGMetrics.xGF.toFixed(2)}</div>
            <div className="metric-sublabel">{perGameStats.onIceXGPerGame}/game (on-ice)</div>
          </div>
          <div className="metric-card xg-against">
            <div className="metric-label">xG Against</div>
            <div className="metric-value">{xGMetrics.xGA.toFixed(2)}</div>
            <div className="metric-sublabel">Defensive impact</div>
          </div>
          <div className="metric-card xg-diff">
            <div className="metric-label">xG Differential</div>
            <div className="metric-value" style={{ color: xGMetrics.xGDiff > 0 ? '#10b981' : '#ef4444' }}>
              {xGMetrics.xGDiff > 0 ? '+' : ''}{xGMetrics.xGDiff.toFixed(2)}
            </div>
            <div className="metric-sublabel">{xGMetrics.xGPercent.toFixed(1)}% xG share</div>
          </div>
          <div className="metric-card goals-above-expected">
            <div className="metric-label">Goals vs xG</div>
            <div className="metric-value" style={{ color: (individualXG?.goalsAboveExpected ?? 0) >= 0 ? '#10b981' : '#ef4444' }}>
              {(individualXG?.goalsAboveExpected ?? 0) >= 0 ? '+' : ''}{(individualXG?.goalsAboveExpected ?? 0).toFixed(2)}
            </div>
            <div className="metric-sublabel">
              {(individualXG?.goalsAboveExpected ?? 0) >= 0 ? 'Above' : 'Below'} expected (ixG: {(individualXG?.ixG ?? 0).toFixed(2)})
            </div>
          </div>
        </div>
      </section>

      {/* Zone Entry/Exit Section */}
      <section className="analytics-section">
        <h3 className="section-title">Zone Transitions</h3>
        <div className="metrics-grid-2col">
          <div className="zone-card entry-card">
            <h4>Offensive Zone Entries</h4>
            <div className="zone-stats">
              <div className="zone-stat">
                <span className="stat-label">Total Entries:</span>
                <span className="stat-value">{zoneAnalytics.totalEntries}</span>
              </div>
              <div className="zone-stat">
                <span className="stat-label">Controlled:</span>
                <span className="stat-value">{zoneAnalytics.controlledEntries}</span>
              </div>
              <div className="zone-stat">
                <span className="stat-label">Dump-ins:</span>
                <span className="stat-value">{zoneAnalytics.dumpIns}</span>
              </div>
              <div className="zone-stat-highlight">
                <span className="stat-label">Controlled Entry Rate:</span>
                <span className="stat-value-large">{zoneAnalytics.controlledEntryRate}%</span>
              </div>
            </div>
            <div className="zone-rating">
              {zoneAnalytics.controlledEntryRate >= 60 ? '🟢 Elite' :
               zoneAnalytics.controlledEntryRate >= 50 ? '🟡 Good' :
               zoneAnalytics.controlledEntryRate >= 40 ? '🟠 Average' : '🔴 Below Average'}
            </div>
          </div>

          <div className="zone-card exit-card">
            <h4>Defensive Zone Exits</h4>
            <div className="zone-stats">
              <div className="zone-stat">
                <span className="stat-label">Total Exits:</span>
                <span className="stat-value">{zoneAnalytics.totalExits}</span>
              </div>
              <div className="zone-stat">
                <span className="stat-label">Successful:</span>
                <span className="stat-value">{zoneAnalytics.successfulExits}</span>
              </div>
              <div className="zone-stat-highlight">
                <span className="stat-label">Exit Success Rate:</span>
                <span className="stat-value-large">{zoneAnalytics.exitSuccessRate}%</span>
              </div>
            </div>
            <div className="zone-rating">
              {zoneAnalytics.exitSuccessRate >= 75 ? '🟢 Elite' :
               zoneAnalytics.exitSuccessRate >= 65 ? '🟡 Good' :
               zoneAnalytics.exitSuccessRate >= 55 ? '🟠 Average' : '🔴 Below Average'}
            </div>
          </div>
        </div>
      </section>

      {/* Rush Attack Section */}
      <section className="analytics-section">
        <h3 className="section-title">Rush Attacks</h3>
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-label">Total Rushes</div>
            <div className="metric-value">{rushAnalytics.totalRushes}</div>
            <div className="metric-sublabel">{perGameStats.rushesPerGame}/game</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Rush Goals</div>
            <div className="metric-value">{rushAnalytics.rushGoals}</div>
            <div className="metric-sublabel">{rushAnalytics.rushConversionRate}% conversion</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Breakaways</div>
            <div className="metric-value">{rushAnalytics.breakaways}</div>
            <div className="metric-sublabel">Isolated rushes</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Odd-Man Rushes</div>
            <div className="metric-value">{rushAnalytics.oddManRushes}</div>
            <div className="metric-sublabel">Outnumbered defense</div>
          </div>
        </div>
        <div className="rush-details">
          <div className="detail-item">
            <span className="detail-label">Average Transition Time:</span>
            <span className="detail-value">{rushAnalytics.averageTransitionTime}s</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Total Rush xG:</span>
            <span className="detail-value">{rushAnalytics.totalRushXG}</span>
          </div>
        </div>
      </section>

      {/* Royal Road Passes Section */}
      {royalRoadPasses.totalRoyalRoadPasses > 0 && (
        <section className="analytics-section">
          <RoyalRoadInsights
            royalRoadPasses={royalRoadPasses.royalRoadPasses}
            playerName={playerName}
          />
        </section>
      )}

      {/* Defensive Coverage Section */}
      <section className="analytics-section">
        <h3 className="section-title">Defensive Coverage</h3>
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-label">Shots Allowed</div>
            <div className="metric-value">{defensiveAnalytics.totalShotsAllowed}</div>
            <div className="metric-sublabel">
              {(defensiveAnalytics.totalShotsAllowed / totalGames).toFixed(1)}/game
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Slot Shots Allowed</div>
            <div className="metric-value">{defensiveAnalytics.slotProtection.slotShotsAllowed}</div>
            <div className="metric-sublabel">High-danger area</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Shot Block Rate</div>
            <div className="metric-value">{defensiveAnalytics.shotBlockRate}%</div>
            <div className="metric-sublabel">{defensiveAnalytics.shotsBlockedTotal} blocks</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Suppression Rating</div>
            <div className="metric-value">{defensiveAnalytics.shotSuppressionRating}</div>
            <div className="metric-sublabel">Out of 100</div>
          </div>
        </div>

        {/* Slot Protection Details */}
        <div className="slot-protection-details">
          <h4>Slot Protection Analysis</h4>
          <div className="protection-grid">
            <div className="protection-stat">
              <span>Slot xG Allowed:</span>
              <strong>{defensiveAnalytics.slotProtection.slotXGAllowed}</strong>
            </div>
            <div className="protection-stat">
              <span>Slot Block Rate:</span>
              <strong>{defensiveAnalytics.slotProtection.slotBlockRate}%</strong>
            </div>
            <div className="protection-stat">
              <span>Danger Rating:</span>
              <strong className={`rating-${defensiveAnalytics.slotProtection.slotDangerRating}`}>
                {defensiveAnalytics.slotProtection.slotDangerRating}
              </strong>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
