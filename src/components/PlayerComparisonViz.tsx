/**
 * Player Comparison Visualization Component
 *
 * Side-by-side comparison of two players with:
 * - Radar charts for stat comparison
 * - Side-by-side ice charts
 * - Head-to-head stat tables
 */

import { useState } from 'react';
import ShotChart, { type Shot } from './charts/ShotChart';
import type { AdvancedPlayerMetrics } from '../services/advancedMetrics';
import './PlayerComparisonViz.css';

interface PlayerComparisonVizProps {
  player1: {
    name: string;
    stats: AdvancedPlayerMetrics;
    shots?: Shot[];
    photoUrl?: string;
  };
  player2: {
    name: string;
    stats: AdvancedPlayerMetrics;
    shots?: Shot[];
    photoUrl?: string;
  };
}

export default function PlayerComparisonViz({
  player1,
  player2,
}: PlayerComparisonVizProps) {
  const [activeView, setActiveView] = useState<'stats' | 'charts' | 'advanced'>('stats');

  // Calculate comparison stats
  const compareValue = (val1: number, val2: number): 'better' | 'worse' | 'equal' => {
    if (Math.abs(val1 - val2) < 0.01) return 'equal';
    return val1 > val2 ? 'better' : 'worse';
  };

  // Key stats to compare
  const keyStats = [
    { key: 'gamesPlayed', label: 'Games Played', format: (v: number) => v.toString() },
    { key: 'goals', label: 'Goals', format: (v: number) => v.toString() },
    { key: 'assists', label: 'Assists', format: (v: number) => v.toString() },
    { key: 'points', label: 'Points', format: (v: number) => v.toString() },
    { key: 'pointsPerGame', label: 'Points/Game', format: (v: number) => v.toFixed(2) },
    { key: 'pointsPer60', label: 'Points/60', format: (v: number) => v.toFixed(2) },
    { key: 'goalsPer60', label: 'Goals/60', format: (v: number) => v.toFixed(2) },
    { key: 'shootingPct', label: 'Shooting %', format: (v: number) => v.toFixed(1) + '%' },
    { key: 'shots', label: 'Shots', format: (v: number) => v.toString() },
    { key: 'plusMinus', label: '+/-', format: (v: number) => (v > 0 ? '+' : '') + v },
  ];

  // Advanced stats to compare
  const advancedStats = [
    { key: 'pointsPer60', label: 'Points/60', format: (v: number) => v.toFixed(2) },
    { key: 'clutchFactor', label: 'Clutch Factor', format: (v: number) => v.toFixed(0) },
    { key: 'powerPlayGoals', label: 'PP Goals', format: (v: number) => v.toString() },
    { key: 'gameWinningGoals', label: 'GWG', format: (v: number) => v.toString() },
    { key: 'primaryPointsEstimate', label: 'Primary Pts', format: (v: number) => v.toFixed(1) },
    { key: 'pointsPerShift', label: 'Pts/Shift', format: (v: number) => v.toFixed(3) },
  ];

  return (
    <div className="player-comparison-viz">
      <div className="comparison-header">
        <h2>Player Comparison</h2>
      </div>

      {/* Player cards */}
      <div className="players-cards">
        <div className="player-card player-1">
          {player1.photoUrl && (
            <img src={player1.photoUrl} alt={player1.name} className="player-photo" />
          )}
          <h3>{player1.name}</h3>
          <div className="player-position">{player1.stats.position}</div>
        </div>

        <div className="vs-badge">VS</div>

        <div className="player-card player-2">
          {player2.photoUrl && (
            <img src={player2.photoUrl} alt={player2.name} className="player-photo" />
          )}
          <h3>{player2.name}</h3>
          <div className="player-position">{player2.stats.position}</div>
        </div>
      </div>

      {/* View tabs */}
      <div className="comparison-tabs">
        <button
          className={`tab ${activeView === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveView('stats')}
        >
          Basic Stats
        </button>
        <button
          className={`tab ${activeView === 'advanced' ? 'active' : ''}`}
          onClick={() => setActiveView('advanced')}
        >
          Advanced Metrics
        </button>
        <button
          className={`tab ${activeView === 'charts' ? 'active' : ''}`}
          onClick={() => setActiveView('charts')}
        >
          Shot Charts
        </button>
      </div>

      {/* Content */}
      <div className="comparison-content">
        {/* Basic Stats Table */}
        {activeView === 'stats' && (
          <div className="stats-comparison-table">
            <table>
              <thead>
                <tr>
                  <th>{player1.name}</th>
                  <th>Stat</th>
                  <th>{player2.name}</th>
                </tr>
              </thead>
              <tbody>
                {keyStats.map((stat) => {
                  const val1 = (player1.stats as any)[stat.key] || 0;
                  const val2 = (player2.stats as any)[stat.key] || 0;
                  const comparison = compareValue(val1, val2);

                  return (
                    <tr key={stat.key}>
                      <td className={comparison === 'better' ? 'winner' : comparison === 'worse' ? 'loser' : ''}>
                        {stat.format(val1)}
                        {comparison === 'better' && ' ✓'}
                      </td>
                      <td className="stat-label">{stat.label}</td>
                      <td className={comparison === 'worse' ? 'winner' : comparison === 'better' ? 'loser' : ''}>
                        {stat.format(val2)}
                        {comparison === 'worse' && ' ✓'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Advanced Stats */}
        {activeView === 'advanced' && (
          <div className="stats-comparison-table">
            <table>
              <thead>
                <tr>
                  <th>{player1.name}</th>
                  <th>Advanced Metric</th>
                  <th>{player2.name}</th>
                </tr>
              </thead>
              <tbody>
                {advancedStats.map((stat) => {
                  const val1 = (player1.stats as any)[stat.key] || 0;
                  const val2 = (player2.stats as any)[stat.key] || 0;
                  const comparison = compareValue(val1, val2);

                  return (
                    <tr key={stat.key}>
                      <td className={comparison === 'better' ? 'winner' : comparison === 'worse' ? 'loser' : ''}>
                        {stat.format(val1)}
                        {comparison === 'better' && ' ✓'}
                      </td>
                      <td className="stat-label">{stat.label}</td>
                      <td className={comparison === 'worse' ? 'winner' : comparison === 'better' ? 'loser' : ''}>
                        {stat.format(val2)}
                        {comparison === 'worse' && ' ✓'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Shot Charts */}
        {activeView === 'charts' && (
          <div className="charts-comparison">
            <div className="chart-column">
              <h4>{player1.name}</h4>
              {player1.shots && player1.shots.length > 0 ? (
                <ShotChart shots={player1.shots} showDangerZones={true} />
              ) : (
                <div className="no-data">No shot data available</div>
              )}
            </div>

            <div className="chart-column">
              <h4>{player2.name}</h4>
              {player2.shots && player2.shots.length > 0 ? (
                <ShotChart shots={player2.shots} showDangerZones={true} />
              ) : (
                <div className="no-data">No shot data available</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Quick comparison summary */}
      <div className="comparison-summary">
        <h4>Quick Summary</h4>
        <div className="summary-grid">
          <div className="summary-item">
            <strong>Scoring:</strong>
            {player1.stats.goals > player2.stats.goals
              ? `${player1.name} leads with ${player1.stats.goals} goals`
              : `${player2.name} leads with ${player2.stats.goals} goals`}
          </div>
          <div className="summary-item">
            <strong>Playmaking:</strong>
            {player1.stats.assists > player2.stats.assists
              ? `${player1.name} leads with ${player1.stats.assists} assists`
              : `${player2.name} leads with ${player2.stats.assists} assists`}
          </div>
          <div className="summary-item">
            <strong>Production:</strong>
            {player1.stats.pointsPerGame > player2.stats.pointsPerGame
              ? `${player1.name} (${player1.stats.pointsPerGame.toFixed(2)} P/GP)`
              : `${player2.name} (${player2.stats.pointsPerGame.toFixed(2)} P/GP)`}
          </div>
        </div>
      </div>
    </div>
  );
}
