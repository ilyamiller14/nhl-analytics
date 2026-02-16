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

  const advancedStats: AdvancedStats & { hasOnIceData: boolean } = useMemo(() => {
    if (hasRealData) {
      // Use real on-ice goals against from shot data
      const realGoalsAgainst = realShotsAgainst.filter(s => s.type === 'goal').length;
      const stats = calculateAdvancedMetrics(
        realShotsFor,
        realShotsAgainst,
        goals,
        realGoalsAgainst,
        toiMinutes,
        50,
        50,
        gamesPlayed * 12,
        gamesPlayed * 10
      );
      // Override points60 with real data since we have assists
      stats.points60 = toiMinutes > 0 ? (points / toiMinutes) * 60 : 0;
      return { ...stats, hasOnIceData: true };
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
      expectedGoals: 0,
      expectedGoalsAgainst: 0,
      expectedGoalsPct: 50,
      expectedGoalsDiff: 0,
      goalsAboveExpected: 0,
      shootingPct,
      savePct: 0,
      pdo: 0,
      offensiveZoneStartPct: 50,
      qualityOfCompetition: null,
      qualityOfTeammates: null,
      relativeCorsi: 0,
      relativeFenwick: 0,
      relativeXG: 0,
      corsiFor60: 0,
      fenwickFor60: 0,
      xG60: 0,
      goals60: toiMinutes > 0 ? (goals / toiMinutes) * 60 : 0,
      points60: toiMinutes > 0 ? (points / toiMinutes) * 60 : 0,
      hasOnIceData: false,
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
              <td className="metric-value">
                {advancedStats.hasOnIceData
                  ? `${advancedStats.corsiForPct.toFixed(1)}%`
                  : <span title="Requires play-by-play data">N/A</span>}
              </td>
              <td>
                {advancedStats.hasOnIceData
                  ? `${advancedStats.corsiFor} / ${advancedStats.corsiAgainst}`
                  : '-'}
              </td>
              <td className="metric-desc">All shot attempts (shots + blocks + misses){!advancedStats.hasOnIceData && ' — requires play-by-play data'}</td>
            </tr>
            <tr>
              <td className="metric-name">Fenwick For %</td>
              <td className="metric-value">
                {advancedStats.hasOnIceData
                  ? `${advancedStats.fenwickForPct.toFixed(1)}%`
                  : <span title="Requires play-by-play data">N/A</span>}
              </td>
              <td>
                {advancedStats.hasOnIceData
                  ? `${advancedStats.fenwickFor} / ${advancedStats.fenwickAgainst}`
                  : '-'}
              </td>
              <td className="metric-desc">Unblocked shot attempts (shots + misses){!advancedStats.hasOnIceData && ' — requires play-by-play data'}</td>
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
              <td className="metric-name">Offensive WAR</td>
              <td className="metric-value">{war.toFixed(2)}</td>
              <td className="metric-desc">
                Offensive wins above replacement (based on goals, assists, +/-, TOI) - {war > 5 ? 'Elite' : war > 3 ? 'All-Star' : war > 1 ? 'Above Average' : 'Average'}
              </td>
            </tr>
            <tr>
              <td className="metric-name">{advancedStats.hasOnIceData ? 'On-Ice xGF' : 'On-Ice xGF'}</td>
              <td className="metric-value">
                {advancedStats.hasOnIceData
                  ? advancedStats.expectedGoals.toFixed(2)
                  : <span title="Requires play-by-play data">N/A</span>}
              </td>
              <td className="metric-desc">Team xG when player on ice{!advancedStats.hasOnIceData && ' (requires play-by-play data)'}</td>
            </tr>
            <tr>
              <td className="metric-name">On-Ice xGA</td>
              <td className="metric-value">
                {advancedStats.hasOnIceData
                  ? advancedStats.expectedGoalsAgainst.toFixed(2)
                  : <span title="Requires play-by-play data">N/A</span>}
              </td>
              <td className="metric-desc">Opponent xG when player on ice{!advancedStats.hasOnIceData && ' (requires play-by-play data)'}</td>
            </tr>
            <tr>
              <td className="metric-name">On-Ice xG%</td>
              <td className="metric-value">
                {advancedStats.hasOnIceData
                  ? `${advancedStats.expectedGoalsPct.toFixed(1)}%`
                  : <span title="Requires play-by-play data">N/A</span>}
              </td>
              <td className="metric-desc">xG share when on ice (&gt;50% is good){!advancedStats.hasOnIceData && ' (requires play-by-play data)'}</td>
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
              <td className="metric-value">{gamesPlayed > 0 ? (goals / gamesPlayed).toFixed(2) : '0.00'}</td>
              <td className="metric-desc">Average goals per game</td>
            </tr>
            <tr>
              <td className="metric-name">Assists/Game</td>
              <td className="metric-value">{gamesPlayed > 0 ? (assists / gamesPlayed).toFixed(2) : '0.00'}</td>
              <td className="metric-desc">Average assists per game</td>
            </tr>
            <tr>
              <td className="metric-name">Points/Game</td>
              <td className="metric-value">{gamesPlayed > 0 ? (points / gamesPlayed).toFixed(2) : '0.00'}</td>
              <td className="metric-desc">Average points per game</td>
            </tr>
            <tr>
              <td className="metric-name">Shots/Game</td>
              <td className="metric-value">{gamesPlayed > 0 ? (shots / gamesPlayed).toFixed(1) : '0.0'}</td>
              <td className="metric-desc">Average shots on goal per game</td>
            </tr>
            <tr>
              <td className="metric-name">TOI/Game</td>
              <td className="metric-value">{gamesPlayed > 0 ? (toiMinutes / gamesPlayed).toFixed(1) : '0.0'} min</td>
              <td className="metric-desc">Average time on ice per game</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AdvancedAnalyticsTable;
