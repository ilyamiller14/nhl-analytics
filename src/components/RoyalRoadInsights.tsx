/**
 * Royal Road Pass Insights Component
 *
 * Displays analytics for royal road passes (cross-ice to slot)
 * Shows conversion rate, xG generated, and pass visualization
 */

import { useMemo } from 'react';
import type { RoyalRoadPass } from '../services/advancedPassAnalytics';
import './RoyalRoadInsights.css';

interface RoyalRoadInsightsProps {
  royalRoadPasses: RoyalRoadPass[];
  playerName?: string;
}

export default function RoyalRoadInsights({
  royalRoadPasses,
  playerName,
}: RoyalRoadInsightsProps) {
  const analytics = useMemo(() => {
    const total = royalRoadPasses.length;
    const goals = royalRoadPasses.filter((p) => p.wasGoal).length;
    const conversionRate = total > 0 ? (goals / total) * 100 : 0;
    const totalXG = royalRoadPasses.reduce((sum, p) => sum + p.shotXG, 0);
    const avgXG = total > 0 ? totalXG / total : 0;

    // Group by player
    const passerStats = new Map<string, { passes: number; goals: number; xg: number }>();
    const receiverStats = new Map<string, { passes: number; goals: number; xg: number }>();

    royalRoadPasses.forEach((pass) => {
      const passer = pass.fromPlayerName || `Player ${pass.fromPlayerId}`;
      const receiver = pass.toPlayerName || `Player ${pass.toPlayerId}`;

      // Passer stats
      if (!passerStats.has(passer)) {
        passerStats.set(passer, { passes: 0, goals: 0, xg: 0 });
      }
      const passerStat = passerStats.get(passer)!;
      passerStat.passes += 1;
      passerStat.xg += pass.shotXG;
      if (pass.wasGoal) passerStat.goals += 1;

      // Receiver stats
      if (!receiverStats.has(receiver)) {
        receiverStats.set(receiver, { passes: 0, goals: 0, xg: 0 });
      }
      const receiverStat = receiverStats.get(receiver)!;
      receiverStat.passes += 1;
      receiverStat.xg += pass.shotXG;
      if (pass.wasGoal) receiverStat.goals += 1;
    });

    // Top passers and receivers
    const topPassers = Array.from(passerStats.entries())
      .sort((a, b) => b[1].passes - a[1].passes)
      .slice(0, 5);

    const topReceivers = Array.from(receiverStats.entries())
      .sort((a, b) => b[1].passes - a[1].passes)
      .slice(0, 5);

    return {
      total,
      goals,
      conversionRate,
      totalXG,
      avgXG,
      topPassers,
      topReceivers,
    };
  }, [royalRoadPasses]);

  if (royalRoadPasses.length === 0) {
    return (
      <div className="royal-road-insights empty">
        <div className="empty-state">
          <h3>No Royal Road Passes</h3>
          <p>No cross-ice passes to the slot detected in the analyzed games.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="royal-road-insights">
      <h3 className="insights-title">
        👑 Royal Road Pass Analytics
        {playerName && ` - ${playerName}`}
      </h3>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <div className="card-value">{analytics.total}</div>
          <div className="card-label">Royal Road Passes</div>
        </div>
        <div className="summary-card">
          <div className="card-value">{analytics.goals}</div>
          <div className="card-label">Goals Scored</div>
        </div>
        <div className="summary-card">
          <div className="card-value">{analytics.conversionRate.toFixed(1)}%</div>
          <div className="card-label">Conversion Rate</div>
        </div>
        <div className="summary-card">
          <div className="card-value">{analytics.totalXG.toFixed(2)}</div>
          <div className="card-label">Total xG Generated</div>
        </div>
        <div className="summary-card">
          <div className="card-value">{analytics.avgXG.toFixed(3)}</div>
          <div className="card-label">Avg xG per Pass</div>
        </div>
      </div>

      {/* Top Players */}
      <div className="top-players-section">
        <div className="top-players-column">
          <h4>Top Passers</h4>
          <div className="player-list">
            {analytics.topPassers.map(([name, stats], index) => (
              <div key={name} className="player-item">
                <span className="player-rank">#{index + 1}</span>
                <span className="player-name">{name}</span>
                <span className="player-stat">{stats.passes} passes</span>
                <span className="player-stat-secondary">
                  {stats.xg.toFixed(2)} xG
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="top-players-column">
          <h4>Top Receivers</h4>
          <div className="player-list">
            {analytics.topReceivers.map(([name, stats], index) => (
              <div key={name} className="player-item">
                <span className="player-rank">#{index + 1}</span>
                <span className="player-name">{name}</span>
                <span className="player-stat">{stats.goals} goals</span>
                <span className="player-stat-secondary">
                  {stats.xg.toFixed(2)} xG
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="info-box">
        <strong>What is a Royal Road Pass?</strong>
        <p>
          A royal road pass is a cross-ice pass (horizontal movement {'>'} 20 feet) that
          leads to a shot from the high-danger slot area. These are among the most
          dangerous offensive plays in hockey, creating high-quality scoring chances by
          moving the puck laterally and exploiting defensive gaps.
        </p>
      </div>
    </div>
  );
}
