/**
 * Penalty Impact Analysis Component
 *
 * Displays comprehensive power play and penalty kill analytics including:
 * - PP/PK statistics side-by-side
 * - Conversion rates and shots per opportunity
 * - Shot charts for special teams situations
 * - Comparison to league averages
 * - Situation breakdown (5v4, 5v3, 4v4, etc.)
 */

import { useMemo } from 'react';
import type {
  SpecialTeamsAnalytics,
  GameSituation,
} from '../services/penaltyAnalytics';
import { compareToLeagueAverage } from '../services/penaltyAnalytics';
import IceRinkChart from './IceRinkChart';
import './PenaltyImpactAnalysis.css';

interface PenaltyImpactAnalysisProps {
  analytics: SpecialTeamsAnalytics;
  teamName?: string;
  ppShots?: Array<{
    x: number;
    y: number;
    type: 'goal' | 'shot' | 'miss' | 'block';
  }>;
  pkShots?: Array<{
    x: number;
    y: number;
    type: 'goal' | 'shot' | 'miss' | 'block';
  }>;
}

export default function PenaltyImpactAnalysis({
  analytics,
  teamName,
  ppShots = [],
  pkShots = [],
}: PenaltyImpactAnalysisProps) {
  const leagueComparison = useMemo(() => {
    return compareToLeagueAverage(analytics);
  }, [analytics]);

  const { powerPlay, penaltyKill, situationBreakdown } = analytics;

  // Convert shots to ice rink chart format
  const ppChartData = useMemo(() => {
    return ppShots.map((shot) => ({
      x: shot.x,
      y: shot.y,
      value: 1,
      type: shot.type,
    }));
  }, [ppShots]);

  const pkChartData = useMemo(() => {
    return pkShots.map((shot) => ({
      x: shot.x,
      y: shot.y,
      value: 1,
      type: shot.type,
    }));
  }, [pkShots]);

  // Calculate league average benchmarks
  const leaguePPRate = 20.0;
  const leaguePKRate = 80.0;
  const leaguePPShotsPerOpp = 3.5;
  const leaguePKShotsAllowedPerOpp = 3.2;

  // Get situation data
  const situationData = useMemo(() => {
    const situations: GameSituation[] = ['5v4', '4v5', '5v3', '3v5', '4v4', '4v3', '3v4', '3v3'];
    return situations
      .filter((sit) => situationBreakdown[sit] && situationBreakdown[sit].shots > 0)
      .map((sit) => ({
        situation: sit,
        ...situationBreakdown[sit],
      }));
  }, [situationBreakdown]);

  return (
    <div className="penalty-impact-analysis">
      <div className="analysis-header">
        <h2 className="analysis-title">
          Special Teams Analysis
          {teamName && <span className="team-name"> - {teamName}</span>}
        </h2>
        <p className="analysis-subtitle">
          Power Play and Penalty Kill Performance Breakdown
        </p>
      </div>

      {/* League Comparison Banner */}
      <div className="league-comparison-banner">
        <div className="comparison-item">
          <span className="comparison-label">PP Ranking</span>
          <span className={`comparison-badge ${leagueComparison.ppRank.toLowerCase().replace(' ', '-')}`}>
            {leagueComparison.ppRank}
          </span>
          <span className="comparison-diff">
            {leagueComparison.ppVsAverage > 0 ? '+' : ''}
            {leagueComparison.ppVsAverage}% vs League
          </span>
        </div>
        <div className="comparison-item">
          <span className="comparison-label">PK Ranking</span>
          <span className={`comparison-badge ${leagueComparison.pkRank.toLowerCase().replace(' ', '-')}`}>
            {leagueComparison.pkRank}
          </span>
          <span className="comparison-diff">
            {leagueComparison.pkVsAverage > 0 ? '+' : ''}
            {leagueComparison.pkVsAverage}% vs League
          </span>
        </div>
      </div>

      {/* Power Play and Penalty Kill Side-by-Side */}
      <div className="special-teams-grid">
        {/* Power Play Section */}
        <div className="special-team-section power-play-section">
          <div className="section-header">
            <h3 className="section-title">Power Play</h3>
            <div className="section-icon pp-icon">PP</div>
          </div>

          <div className="stats-grid">
            <div className="stat-card primary">
              <div className="stat-value">{powerPlay.powerPlayConversionRate.toFixed(1)}%</div>
              <div className="stat-label">Conversion Rate</div>
              <div className="stat-comparison">
                League Avg: {leaguePPRate.toFixed(1)}%
                <span className={powerPlay.powerPlayConversionRate > leaguePPRate ? 'positive' : 'negative'}>
                  {' '}({powerPlay.powerPlayConversionRate > leaguePPRate ? '+' : ''}
                  {(powerPlay.powerPlayConversionRate - leaguePPRate).toFixed(1)}%)
                </span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-value">{powerPlay.powerPlayGoals}</div>
              <div className="stat-label">PP Goals</div>
              <div className="stat-detail">{powerPlay.totalPowerPlays} Opportunities</div>
            </div>

            <div className="stat-card">
              <div className="stat-value">{powerPlay.shotsPerPowerPlay.toFixed(1)}</div>
              <div className="stat-label">Shots per PP</div>
              <div className="stat-comparison">
                League Avg: {leaguePPShotsPerOpp.toFixed(1)}
                <span className={powerPlay.shotsPerPowerPlay > leaguePPShotsPerOpp ? 'positive' : 'negative'}>
                  {' '}({powerPlay.shotsPerPowerPlay > leaguePPShotsPerOpp ? '+' : ''}
                  {(powerPlay.shotsPerPowerPlay - leaguePPShotsPerOpp).toFixed(1)})
                </span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-value">{powerPlay.powerPlayShots}</div>
              <div className="stat-label">Total PP Shots</div>
              <div className="stat-detail">{powerPlay.powerPlayShotsOnGoal} on goal</div>
            </div>

            <div className="stat-card">
              <div className="stat-value">{powerPlay.powerPlayXG.toFixed(2)}</div>
              <div className="stat-label">Expected Goals (xG)</div>
              <div className="stat-detail">
                {powerPlay.totalPowerPlays > 0
                  ? (powerPlay.powerPlayXG / powerPlay.totalPowerPlays).toFixed(2)
                  : '0.00'}{' '}
                per PP
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-value">{powerPlay.highDangerShotsOnPP}</div>
              <div className="stat-label">High Danger Shots</div>
              <div className="stat-detail">
                {powerPlay.powerPlayShots > 0
                  ? ((powerPlay.highDangerShotsOnPP / powerPlay.powerPlayShots) * 100).toFixed(1)
                  : '0.0'}
                % of shots
              </div>
            </div>
          </div>

          {/* PP Shot Chart */}
          {ppChartData.length > 0 && (
            <div className="shot-chart-container">
              <IceRinkChart
                data={ppChartData}
                title="Power Play Shot Map"
                type="scatter"
                colorScheme="hot"
              />
            </div>
          )}
        </div>

        {/* Penalty Kill Section */}
        <div className="special-team-section penalty-kill-section">
          <div className="section-header">
            <h3 className="section-title">Penalty Kill</h3>
            <div className="section-icon pk-icon">PK</div>
          </div>

          <div className="stats-grid">
            <div className="stat-card primary">
              <div className="stat-value">{penaltyKill.penaltyKillSuccessRate.toFixed(1)}%</div>
              <div className="stat-label">Success Rate</div>
              <div className="stat-comparison">
                League Avg: {leaguePKRate.toFixed(1)}%
                <span className={penaltyKill.penaltyKillSuccessRate > leaguePKRate ? 'positive' : 'negative'}>
                  {' '}({penaltyKill.penaltyKillSuccessRate > leaguePKRate ? '+' : ''}
                  {(penaltyKill.penaltyKillSuccessRate - leaguePKRate).toFixed(1)}%)
                </span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-value">{penaltyKill.goalsAllowed}</div>
              <div className="stat-label">Goals Allowed</div>
              <div className="stat-detail">{penaltyKill.totalPenaltyKills} Times Shorthanded</div>
            </div>

            <div className="stat-card">
              <div className="stat-value">
                {penaltyKill.totalPenaltyKills > 0
                  ? (penaltyKill.shotsAllowed / penaltyKill.totalPenaltyKills).toFixed(1)
                  : '0.0'}
              </div>
              <div className="stat-label">Shots Allowed per PK</div>
              <div className="stat-comparison">
                League Avg: {leaguePKShotsAllowedPerOpp.toFixed(1)}
                <span
                  className={
                    penaltyKill.totalPenaltyKills > 0 &&
                    penaltyKill.shotsAllowed / penaltyKill.totalPenaltyKills < leaguePKShotsAllowedPerOpp
                      ? 'positive'
                      : 'negative'
                  }
                >
                  {' '}(
                  {penaltyKill.totalPenaltyKills > 0
                    ? (penaltyKill.shotsAllowed / penaltyKill.totalPenaltyKills - leaguePKShotsAllowedPerOpp).toFixed(1)
                    : '0.0'}
                  )
                </span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-value">{penaltyKill.shotsAllowed}</div>
              <div className="stat-label">Total Shots Allowed</div>
              <div className="stat-detail">{penaltyKill.shotsOnGoalAllowed} on goal</div>
            </div>

            <div className="stat-card">
              <div className="stat-value">{penaltyKill.xGAllowed.toFixed(2)}</div>
              <div className="stat-label">xG Allowed</div>
              <div className="stat-detail">
                {penaltyKill.totalPenaltyKills > 0
                  ? (penaltyKill.xGAllowed / penaltyKill.totalPenaltyKills).toFixed(2)
                  : '0.00'}{' '}
                per PK
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-value">{penaltyKill.shotsBlockedOnPK}</div>
              <div className="stat-label">Shots Blocked</div>
              <div className="stat-detail">
                {penaltyKill.shotsAllowed > 0
                  ? ((penaltyKill.shotsBlockedOnPK / penaltyKill.shotsAllowed) * 100).toFixed(1)
                  : '0.0'}
                % block rate
              </div>
            </div>
          </div>

          {/* PK Shot Chart */}
          {pkChartData.length > 0 && (
            <div className="shot-chart-container">
              <IceRinkChart
                data={pkChartData}
                title="Penalty Kill Shots Against Map"
                type="scatter"
                colorScheme="cool"
              />
            </div>
          )}
        </div>
      </div>

      {/* Situation Breakdown */}
      {situationData.length > 0 && (
        <div className="situation-breakdown">
          <h3 className="breakdown-title">Situation Breakdown</h3>
          <div className="situation-grid">
            {situationData.map((data) => (
              <div key={data.situation} className="situation-card">
                <div className="situation-header">
                  <span className="situation-label">{data.situation}</span>
                  <span className="situation-type">
                    {data.situation.startsWith('5v4') || data.situation.startsWith('5v3') || data.situation.startsWith('4v3')
                      ? 'Power Play'
                      : data.situation.startsWith('4v5') || data.situation.startsWith('3v5') || data.situation.startsWith('3v4')
                      ? 'Penalty Kill'
                      : 'Even Strength'}
                  </span>
                </div>
                <div className="situation-stats">
                  <div className="situation-stat">
                    <span className="stat-label">Goals</span>
                    <span className="stat-value">{data.goals}</span>
                  </div>
                  <div className="situation-stat">
                    <span className="stat-label">Shots</span>
                    <span className="stat-value">{data.shots}</span>
                  </div>
                  <div className="situation-stat">
                    <span className="stat-label">xG</span>
                    <span className="stat-value">{data.xG.toFixed(2)}</span>
                  </div>
                  <div className="situation-stat">
                    <span className="stat-label">Shooting %</span>
                    <span className="stat-value">
                      {data.shots > 0 ? ((data.goals / data.shots) * 100).toFixed(1) : '0.0'}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insights Box */}
      <div className="insights-box">
        <h4>Key Insights</h4>
        <ul>
          <li>
            <strong>Power Play Efficiency:</strong> The team is converting at{' '}
            {powerPlay.powerPlayConversionRate.toFixed(1)}%, which is{' '}
            {powerPlay.powerPlayConversionRate > leaguePPRate ? 'above' : 'below'} the league average of{' '}
            {leaguePPRate}%. They are generating {powerPlay.shotsPerPowerPlay.toFixed(1)} shots per power play
            opportunity.
          </li>
          <li>
            <strong>Penalty Kill Performance:</strong> The penalty kill is operating at{' '}
            {penaltyKill.penaltyKillSuccessRate.toFixed(1)}% success rate, which ranks as{' '}
            {leagueComparison.pkRank.toLowerCase()}. They are allowing{' '}
            {penaltyKill.totalPenaltyKills > 0
              ? (penaltyKill.shotsAllowed / penaltyKill.totalPenaltyKills).toFixed(1)
              : '0.0'}{' '}
            shots per penalty kill.
          </li>
          <li>
            <strong>Shot Quality:</strong> The power play is generating {powerPlay.powerPlayXG.toFixed(2)} expected
            goals with {powerPlay.highDangerShotsOnPP} high-danger shots, while the penalty kill has allowed{' '}
            {penaltyKill.xGAllowed.toFixed(2)} xG against.
          </li>
        </ul>
      </div>
    </div>
  );
}
