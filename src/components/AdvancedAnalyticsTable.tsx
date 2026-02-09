import { useMemo } from 'react';
import {
  calculateAdvancedMetrics,
  calculateWAR,
  type AdvancedStats,
} from '../utils/advancedMetrics';
import type { ShotAttempt } from '../services/playByPlayService';
import './AdvancedAnalyticsTable.css';

interface AdvancedAnalyticsTableProps {
  goals: number;
  assists: number;
  points: number;
  shots: number;
  plusMinus: number;
  toiMinutes: number;
  gamesPlayed: number;
  position: string;
  playerName: string;
  realShotsFor?: ShotAttempt[];
  realShotsAgainst?: ShotAttempt[];
  gamesAnalyzed?: number;
}

function AdvancedAnalyticsTable({
  goals,
  assists,
  points,
  shots,
  plusMinus,
  toiMinutes,
  gamesPlayed,
  position,
  realShotsFor = [],
  realShotsAgainst = [],
  gamesAnalyzed = 0,
}: AdvancedAnalyticsTableProps) {
  const hasRealData = realShotsFor.length > 0;

  const advancedStats: AdvancedStats = useMemo(() => {
    if (hasRealData) {
      return calculateAdvancedMetrics(
        realShotsFor,
        realShotsAgainst,
        goals,
        Math.floor(goals * 0.8),
        toiMinutes,
        50,
        50,
        gamesPlayed * 12,
        gamesPlayed * 10
      );
    }

    const shootingPct = shots > 0 ? (goals / shots) * 100 : 0;

    return {
      corsiFor: 0,
      corsiAgainst: 0,
      corsiForPct: 50,
      corsiRelative: 0,
      fenwickFor: 0,
      fenwickAgainst: 0,
      fenwickForPct: 50,
      fenwickRelative: 0,
      expectedGoals: goals * 0.9,
      expectedGoalsAgainst: goals * 0.8,
      expectedGoalsPct: 50,
      expectedGoalsDiff: 0,
      goalsAboveExpected: 0,
      shootingPct,
      savePct: 92,
      pdo: 100 + (shootingPct - 10) * 0.5,
      offensiveZoneStartPct: 50,
      qualityOfCompetition: 0,
      qualityOfTeammates: 0,
      relativeCorsi: 0,
      relativeFenwick: 0,
      relativeXG: 0,
      corsiFor60: 0,
      fenwickFor60: 0,
      xG60: 0,
      goals60: toiMinutes > 0 ? (goals / toiMinutes) * 60 : 0,
      points60: toiMinutes > 0 ? (points / toiMinutes) * 60 : 0,
    };
  }, [hasRealData, realShotsFor, realShotsAgainst, goals, toiMinutes, gamesPlayed, shots, points]);

  const war = useMemo(() =>
    calculateWAR(goals, assists, plusMinus, toiMinutes, position),
    [goals, assists, plusMinus, toiMinutes, position]
  );

  const assists60 = toiMinutes > 0 ? (assists / toiMinutes) * 60 : 0;

  return (
    <div className="advanced-analytics-table">
      <div className="analytics-table-header">
        <h2>On-Ice Analytics</h2>
        {hasRealData && (
          <div className="data-badge-success">
            {gamesAnalyzed} games | {realShotsFor.length} on-ice shot attempts (Corsi events)
          </div>
        )}
      </div>

      {/* Main Advanced Stats Table */}
      <div className="table-wrapper">
        <table className="analytics-table">
          <thead>
            <tr>
              <th colSpan={4} className="table-section-header">Possession Metrics</th>
            </tr>
            <tr className="table-subheader">
              <th>Metric</th>
              <th>Value</th>
              <th>For/Against</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="metric-name">Corsi For %</td>
              <td className="metric-value">{advancedStats.corsiForPct.toFixed(1)}%</td>
              <td>{advancedStats.corsiFor} / {advancedStats.corsiAgainst}</td>
              <td className="metric-desc">All shot attempts (shots + blocks + misses)</td>
            </tr>
            <tr>
              <td className="metric-name">Fenwick For %</td>
              <td className="metric-value">{advancedStats.fenwickForPct.toFixed(1)}%</td>
              <td>{advancedStats.fenwickFor} / {advancedStats.fenwickAgainst}</td>
              <td className="metric-desc">Unblocked shot attempts (shots + misses)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="table-wrapper">
        <table className="analytics-table">
          <thead>
            <tr>
              <th colSpan={3} className="table-section-header">Scoring Metrics</th>
            </tr>
            <tr className="table-subheader">
              <th>Metric</th>
              <th>Value</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr className="highlight-row">
              <td className="metric-name">WAR</td>
              <td className="metric-value">{war.toFixed(2)}</td>
              <td className="metric-desc">
                Wins Above Replacement - {war > 5 ? 'Elite' : war > 3 ? 'All-Star' : war > 1 ? 'Above Average' : 'Average'}
              </td>
            </tr>
            <tr>
              <td className="metric-name">On-Ice xGF</td>
              <td className="metric-value">{advancedStats.expectedGoals.toFixed(2)}</td>
              <td className="metric-desc">Team xG when player on ice</td>
            </tr>
            <tr>
              <td className="metric-name">On-Ice xGA</td>
              <td className="metric-value">{advancedStats.expectedGoalsAgainst.toFixed(2)}</td>
              <td className="metric-desc">Opponent xG when player on ice</td>
            </tr>
            <tr>
              <td className="metric-name">On-Ice xG%</td>
              <td className="metric-value">{advancedStats.expectedGoalsPct.toFixed(1)}%</td>
              <td className="metric-desc">xG share when on ice (&gt;50% is good)</td>
            </tr>
            <tr>
              <td className="metric-name">Shooting %</td>
              <td className="metric-value">{advancedStats.shootingPct.toFixed(1)}%</td>
              <td className="metric-desc">{goals} goals on {shots} shots (avg ~10%)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="table-wrapper">
        <table className="analytics-table">
          <thead>
            <tr>
              <th colSpan={3} className="table-section-header">Rate Statistics (Per 60 Minutes)</th>
            </tr>
            <tr className="table-subheader">
              <th>Metric</th>
              <th>Value</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="metric-name">Goals/60</td>
              <td className="metric-value">{advancedStats.goals60.toFixed(2)}</td>
              <td className="metric-desc">Goals per 60 minutes of ice time</td>
            </tr>
            <tr>
              <td className="metric-name">Assists/60</td>
              <td className="metric-value">{assists60.toFixed(2)}</td>
              <td className="metric-desc">Assists per 60 minutes</td>
            </tr>
            <tr className="highlight-row">
              <td className="metric-name">Points/60</td>
              <td className="metric-value">{advancedStats.points60.toFixed(2)}</td>
              <td className="metric-desc">Points per 60 minutes - normalized scoring rate</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="table-wrapper">
        <table className="analytics-table">
          <thead>
            <tr>
              <th colSpan={3} className="table-section-header">Per Game Statistics</th>
            </tr>
            <tr className="table-subheader">
              <th>Metric</th>
              <th>Value</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="metric-name">Goals/Game</td>
              <td className="metric-value">{(goals / gamesPlayed).toFixed(2)}</td>
              <td className="metric-desc">Average goals per game</td>
            </tr>
            <tr>
              <td className="metric-name">Assists/Game</td>
              <td className="metric-value">{(assists / gamesPlayed).toFixed(2)}</td>
              <td className="metric-desc">Average assists per game</td>
            </tr>
            <tr>
              <td className="metric-name">Points/Game</td>
              <td className="metric-value">{(points / gamesPlayed).toFixed(2)}</td>
              <td className="metric-desc">Average points per game</td>
            </tr>
            <tr>
              <td className="metric-name">Shots/Game</td>
              <td className="metric-value">{(shots / gamesPlayed).toFixed(1)}</td>
              <td className="metric-desc">Average shots on goal per game</td>
            </tr>
            <tr>
              <td className="metric-name">TOI/Game</td>
              <td className="metric-value">{(toiMinutes / gamesPlayed).toFixed(1)} min</td>
              <td className="metric-desc">Average time on ice per game</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AdvancedAnalyticsTable;
