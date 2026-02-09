import { useMemo } from 'react';
import {
  calculateAdvancedMetrics,
  calculateWAR,
  formatAdvancedStat,
  type AdvancedStats,
} from '../utils/advancedMetrics';
import type { ShotAttempt } from '../services/playByPlayService';
import StatChart from './StatChart';
import './AdvancedAnalytics.css';

interface AdvancedAnalyticsEnhancedProps {
  goals: number;
  assists: number;
  points: number;
  shots: number;
  plusMinus: number;
  toiMinutes: number;
  gamesPlayed: number;
  position: string;
  playerName: string;
  // Real shot data from play-by-play API
  realShotsFor?: ShotAttempt[];
  realShotsAgainst?: ShotAttempt[];
  gamesAnalyzed?: number;
}

function AdvancedAnalyticsEnhanced({
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
}: AdvancedAnalyticsEnhancedProps) {
  // Determine if we have real data
  const hasRealData = realShotsFor.length > 0;

  // Calculate advanced stats from REAL shot data
  const advancedStats: AdvancedStats = useMemo(() => {
    if (hasRealData) {
      // Use real shot data from play-by-play API
      return calculateAdvancedMetrics(
        realShotsFor,
        realShotsAgainst,
        goals,
        Math.floor(goals * 0.8), // Estimate goals against (would need real data)
        toiMinutes,
        50, // Faceoff wins (would need real data)
        50, // Faceoff losses (would need real data)
        gamesPlayed * 12, // Hits estimate
        gamesPlayed * 10  // Blocked shots estimate
      );
    }

    // Fallback: Calculate basic stats from available data
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

  // Calculate WAR from real stats
  const war = useMemo(() =>
    calculateWAR(goals, assists, plusMinus, toiMinutes, position),
    [goals, assists, plusMinus, toiMinutes, position]
  );

  // Calculate assists per 60 (not in AdvancedStats interface)
  const assists60 = toiMinutes > 0 ? (assists / toiMinutes) * 60 : 0;

  // Shot type breakdown from real data
  const shotTypeBreakdown = useMemo(() => {
    if (!hasRealData) return null;

    const breakdown: Record<string, { count: number; goals: number }> = {};
    realShotsFor.forEach(shot => {
      const type = shot.shotType || 'unknown';
      if (!breakdown[type]) {
        breakdown[type] = { count: 0, goals: 0 };
      }
      breakdown[type].count++;
      if (shot.type === 'goal') {
        breakdown[type].goals++;
      }
    });

    return Object.entries(breakdown).map(([type, data]) => ({
      shotType: type.charAt(0).toUpperCase() + type.slice(1),
      attempts: data.count,
      goals: data.goals,
      percentage: data.count > 0 ? (data.goals / data.count * 100) : 0,
    }));
  }, [hasRealData, realShotsFor]);

  // Shot result breakdown
  const shotResultBreakdown = useMemo(() => {
    if (!hasRealData) return null;

    const results = { goal: 0, shot: 0, miss: 0, block: 0 };
    realShotsFor.forEach(shot => {
      results[shot.type]++;
    });

    return [
      { result: 'Goals', count: results.goal, color: '#28a745' },
      { result: 'On Goal', count: results.shot, color: '#003087' },
      { result: 'Missed', count: results.miss, color: '#ffc107' },
      { result: 'Blocked', count: results.block, color: '#dc3545' },
    ];
  }, [hasRealData, realShotsFor]);

  // Distance breakdown
  const distanceBreakdown = useMemo(() => {
    if (!hasRealData) return null;

    const zones = {
      'Point Blank (<15ft)': { count: 0, goals: 0 },
      'Close (15-30ft)': { count: 0, goals: 0 },
      'Medium (30-45ft)': { count: 0, goals: 0 },
      'Long (>45ft)': { count: 0, goals: 0 },
    };

    realShotsFor.forEach(shot => {
      let zone: keyof typeof zones;
      if (shot.distance < 15) zone = 'Point Blank (<15ft)';
      else if (shot.distance < 30) zone = 'Close (15-30ft)';
      else if (shot.distance < 45) zone = 'Medium (30-45ft)';
      else zone = 'Long (>45ft)';

      zones[zone].count++;
      if (shot.type === 'goal') zones[zone].goals++;
    });

    return Object.entries(zones).map(([zone, data]) => ({
      zone,
      attempts: data.count,
      goals: data.goals,
      percentage: data.count > 0 ? (data.goals / data.count * 100) : 0,
    }));
  }, [hasRealData, realShotsFor]);

  return (
    <div className="advanced-analytics">
      <div className="analytics-header">
        <h2>Advanced Analytics</h2>
        {hasRealData && (
          <div className="data-badge" style={{ marginTop: '8px' }}>
            Play-by-Play Data: {gamesAnalyzed} games, {realShotsFor.length} shot attempts
          </div>
        )}
      </div>

      {/* Key Metrics Cards */}
      <div className="key-metrics-grid">
        <div className="metric-card highlight">
          <div className="metric-content">
            <div className="metric-label">WAR (Wins Above Replacement)</div>
            <div className="metric-value">{war.toFixed(2)}</div>
            <div className="metric-description">
              {war > 5 ? 'Elite' : war > 3 ? 'All-Star' : war > 1 ? 'Above Average' : 'Average'}
            </div>
          </div>
        </div>

        {hasRealData && (
          <>
            <div className="metric-card">
              <div className="metric-content">
                <div className="metric-label">Expected Goals (xG)</div>
                <div className="metric-value">{advancedStats.expectedGoals.toFixed(2)}</div>
                <div className="metric-description">
                  Goals Above Expected: {formatAdvancedStat(advancedStats.goalsAboveExpected, 'goalsAboveExpected')}
                </div>
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-content">
                <div className="metric-label">Corsi For %</div>
                <div className="metric-value">{advancedStats.corsiForPct.toFixed(1)}%</div>
                <div className="metric-description">
                  Shot Attempts: {advancedStats.corsiFor} For / {advancedStats.corsiAgainst} Against
                </div>
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-content">
                <div className="metric-label">Fenwick For %</div>
                <div className="metric-value">{advancedStats.fenwickForPct.toFixed(1)}%</div>
                <div className="metric-description">
                  Unblocked: {advancedStats.fenwickFor} For / {advancedStats.fenwickAgainst} Against
                </div>
              </div>
            </div>
          </>
        )}

        <div className="metric-card">
          <div className="metric-content">
            <div className="metric-label">Shooting %</div>
            <div className="metric-value">{advancedStats.shootingPct.toFixed(1)}%</div>
            <div className="metric-description">
              {goals} goals on {shots} shots
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-content">
            <div className="metric-label">Points/60</div>
            <div className="metric-value">{advancedStats.points60.toFixed(2)}</div>
            <div className="metric-description">
              G/60: {advancedStats.goals60.toFixed(2)} | A/60: {assists60.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Shot Analysis - Only shown with real data */}
      {hasRealData && shotTypeBreakdown && shotTypeBreakdown.length > 0 && (
        <section className="analytics-section">
          <h3 className="section-title">Shot Type Analysis (Real Data)</h3>

          <div className="charts-row">
            <div className="chart-container">
              <StatChart
                data={shotTypeBreakdown}
                type="bar"
                dataKeys={[
                  { key: 'attempts', name: 'Attempts', color: '#003087' },
                  { key: 'goals', name: 'Goals', color: '#28a745' },
                ]}
                xAxisKey="shotType"
                title="Shot Attempts by Type"
                height={300}
              />
            </div>

            <div className="chart-container">
              <StatChart
                data={shotTypeBreakdown}
                type="bar"
                dataKeys={[
                  { key: 'percentage', name: 'Shooting %', color: '#ffc107' },
                ]}
                xAxisKey="shotType"
                title="Shooting % by Shot Type"
                height={300}
              />
            </div>
          </div>
        </section>
      )}

      {/* Shot Results */}
      {hasRealData && shotResultBreakdown && (
        <section className="analytics-section">
          <h3 className="section-title">Shot Attempt Results</h3>

          <div className="chart-container">
            <StatChart
              data={shotResultBreakdown}
              type="bar"
              dataKeys={[
                { key: 'count', name: 'Count', color: '#003087' },
              ]}
              xAxisKey="result"
              title="Shot Attempt Breakdown"
              height={250}
            />
          </div>

          <div className="metrics-grid" style={{ marginTop: '16px' }}>
            <div className="metric-group">
              <h4>Corsi (All Shot Attempts)</h4>
              <div className="stat-row">
                <span className="stat-label">Total Attempts</span>
                <span className="stat-value">{realShotsFor.length}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Corsi For</span>
                <span className="stat-value">{advancedStats.corsiFor}</span>
              </div>
              <div className="stat-row highlight-stat">
                <span className="stat-label">Corsi For %</span>
                <span className="stat-value">{advancedStats.corsiForPct.toFixed(1)}%</span>
              </div>
            </div>

            <div className="metric-group">
              <h4>Fenwick (Unblocked)</h4>
              <div className="stat-row">
                <span className="stat-label">Fenwick For</span>
                <span className="stat-value">{advancedStats.fenwickFor}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Fenwick Against</span>
                <span className="stat-value">{advancedStats.fenwickAgainst}</span>
              </div>
              <div className="stat-row highlight-stat">
                <span className="stat-label">Fenwick For %</span>
                <span className="stat-value">{advancedStats.fenwickForPct.toFixed(1)}%</span>
              </div>
            </div>

            <div className="metric-group">
              <h4>Expected Goals</h4>
              <div className="stat-row">
                <span className="stat-label">xG For</span>
                <span className="stat-value">{advancedStats.expectedGoals.toFixed(2)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">xG Against</span>
                <span className="stat-value">{advancedStats.expectedGoalsAgainst.toFixed(2)}</span>
              </div>
              <div className="stat-row highlight-stat">
                <span className="stat-label">xG Diff</span>
                <span className="stat-value">{formatAdvancedStat(advancedStats.expectedGoalsDiff, 'expectedGoalsDiff')}</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Distance Analysis */}
      {hasRealData && distanceBreakdown && (
        <section className="analytics-section">
          <h3 className="section-title">Shot Distance Analysis</h3>

          <div className="chart-container">
            <StatChart
              data={distanceBreakdown}
              type="bar"
              dataKeys={[
                { key: 'attempts', name: 'Attempts', color: '#003087' },
                { key: 'goals', name: 'Goals', color: '#28a745' },
              ]}
              xAxisKey="zone"
              title="Shot Attempts by Distance"
              height={300}
            />
          </div>

          <div className="splits-table" style={{ marginTop: '16px' }}>
            <table>
              <thead>
                <tr>
                  <th>Distance Zone</th>
                  <th>Attempts</th>
                  <th>Goals</th>
                  <th>Shooting %</th>
                </tr>
              </thead>
              <tbody>
                {distanceBreakdown.map(zone => (
                  <tr key={zone.zone}>
                    <td><strong>{zone.zone}</strong></td>
                    <td>{zone.attempts}</td>
                    <td>{zone.goals}</td>
                    <td>{zone.percentage.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Basic Stats Summary - Always shown */}
      <section className="analytics-section">
        <h3 className="section-title">Rate Statistics</h3>

        <div className="metrics-grid">
          <div className="metric-group">
            <h4>Per 60 Minutes</h4>
            <div className="stat-row">
              <span className="stat-label">Goals/60</span>
              <span className="stat-value">{advancedStats.goals60.toFixed(2)}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Assists/60</span>
              <span className="stat-value">{assists60.toFixed(2)}</span>
            </div>
            <div className="stat-row highlight-stat">
              <span className="stat-label">Points/60</span>
              <span className="stat-value">{advancedStats.points60.toFixed(2)}</span>
            </div>
          </div>

          <div className="metric-group">
            <h4>Per Game</h4>
            <div className="stat-row">
              <span className="stat-label">Goals/Game</span>
              <span className="stat-value">{(goals / gamesPlayed).toFixed(2)}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Assists/Game</span>
              <span className="stat-value">{(assists / gamesPlayed).toFixed(2)}</span>
            </div>
            <div className="stat-row highlight-stat">
              <span className="stat-label">Points/Game</span>
              <span className="stat-value">{(points / gamesPlayed).toFixed(2)}</span>
            </div>
          </div>

          <div className="metric-group">
            <h4>Efficiency</h4>
            <div className="stat-row">
              <span className="stat-label">Shooting %</span>
              <span className="stat-value">{advancedStats.shootingPct.toFixed(1)}%</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Shots/Game</span>
              <span className="stat-value">{(shots / gamesPlayed).toFixed(1)}</span>
            </div>
            <div className="stat-row highlight-stat">
              <span className="stat-label">TOI/Game</span>
              <span className="stat-value">{(toiMinutes / gamesPlayed).toFixed(1)} min</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default AdvancedAnalyticsEnhanced;
