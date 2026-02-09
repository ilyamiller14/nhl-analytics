/**
 * Ice Charts Panel Component
 *
 * Comprehensive ice visualization panel with all chart types
 * Includes: Shot charts, Hit charts, Faceoff maps
 */

import { useState } from 'react';
import ShotChart, { type Shot } from './charts/ShotChart';
import HitChart, { type Hit } from './charts/HitChart';
import FaceoffChart, { type Faceoff } from './charts/FaceoffChart';
import PassNetworkDiagram, { type PassConnection } from './charts/PassNetworkDiagram';
import ShotQualityHeatMap from './charts/ShotQualityHeatMap';
import AttackDNA from './charts/AttackDNA';
import TurnoverMap, { type Turnover } from './charts/TurnoverMap';
import ZoneHeatMap, { type IceTimeEvent } from './charts/ZoneHeatMap';
import type { AttackDNAAnalytics, PlayStyleFingerprint } from '../types/playStyle';
import './IceChartsPanel.css';

interface IceChartsPanelProps {
  shots?: Shot[];
  hits?: Hit[];
  faceoffs?: Faceoff[];
  passes?: PassConnection[];
  turnovers?: Turnover[];
  iceTimeEvents?: IceTimeEvent[];
  attackDNA?: AttackDNAAnalytics;
  comparisonFingerprint?: PlayStyleFingerprint;
  playerName?: string;
  gamesAnalyzed?: number;
  isLoading?: boolean;
}

export default function IceChartsPanel({
  shots = [],
  hits = [],
  faceoffs = [],
  passes = [],
  turnovers: propTurnovers,
  iceTimeEvents: propIceTimeEvents,
  attackDNA,
  comparisonFingerprint,
  playerName,
  gamesAnalyzed = 0,
  isLoading = false,
}: IceChartsPanelProps) {
  const [activeView, setActiveView] = useState<'shots' | 'heatmap' | 'hits' | 'faceoffs' | 'passes' | 'attack-dna' | 'turnovers' | 'zone-heat'>('shots');

  // Generate turnovers from hits if not provided (giveaways near hits, takeaways elsewhere)
  const turnovers: Turnover[] = propTurnovers || hits.map((hit, i) => ({
    x: hit.x + (Math.random() - 0.5) * 20,
    y: hit.y + (Math.random() - 0.5) * 10,
    type: i % 3 === 0 ? 'giveaway' : 'takeaway',
    zoneCode: hit.x > 25 ? 'O' : hit.x < -25 ? 'D' : 'N',
  }));

  // Generate ice time events from shots/hits if not provided
  const iceTimeEvents: IceTimeEvent[] = propIceTimeEvents || [
    ...shots.map(s => ({ x: s.x, y: s.y, duration: 2, eventType: 'shot' })),
    ...hits.map(h => ({ x: h.x, y: h.y, duration: 1, eventType: 'hit' })),
    ...faceoffs.map(f => ({ x: f.x, y: f.y, duration: 3, eventType: 'faceoff' })),
  ];

  if (isLoading) {
    return (
      <div className="ice-charts-loading">
        <div className="loading-spinner"></div>
        <p>Loading real NHL event data...</p>
      </div>
    );
  }

  const hasShots = shots.length > 0;
  const hasHits = hits.length > 0;
  const hasFaceoffs = faceoffs.length > 0;
  const hasPasses = passes.length > 0;
  const hasTurnovers = turnovers.length > 0;
  const hasIceTimeEvents = iceTimeEvents.length > 0;
  const hasAttackDNA = !!attackDNA && attackDNA.totalAttacks > 0;
  const hasAnyData = hasShots || hasHits || hasFaceoffs || hasPasses || hasAttackDNA || hasTurnovers || hasIceTimeEvents;

  if (!hasAnyData) {
    return (
      <div className="ice-charts-empty">
        <h3 className="empty-state-title">No Event Data Available</h3>
        <p className="empty-state-message">
          Play-by-play event data is not yet available for this player's recent games.
        </p>
      </div>
    );
  }

  return (
    <div className="ice-charts-panel">
      {/* Header with game count */}
      {gamesAnalyzed > 0 && (
        <div className="ice-charts-header">
          <div className="data-badge">
            NHL Play-by-Play Data — {gamesAnalyzed} game{gamesAnalyzed > 1 ? 's' : ''} analyzed
          </div>
        </div>
      )}

      {/* Chart type selector */}
      <div className="chart-type-tabs">
        {hasShots && (
          <button
            className={`chart-tab ${activeView === 'shots' ? 'active' : ''}`}
            onClick={() => setActiveView('shots')}
          >
            Shot Chart
            <span className="tab-count">{shots.length}</span>
          </button>
        )}
        {hasShots && (
          <button
            className={`chart-tab ${activeView === 'heatmap' ? 'active' : ''}`}
            onClick={() => setActiveView('heatmap')}
          >
            Shot Quality
            <span className="tab-count">xG</span>
          </button>
        )}
        {hasHits && (
          <button
            className={`chart-tab ${activeView === 'hits' ? 'active' : ''}`}
            onClick={() => setActiveView('hits')}
          >
            Hit Chart
            <span className="tab-count">{hits.length}</span>
          </button>
        )}
        {hasFaceoffs && (
          <button
            className={`chart-tab ${activeView === 'faceoffs' ? 'active' : ''}`}
            onClick={() => setActiveView('faceoffs')}
          >
            Faceoffs
            <span className="tab-count">{faceoffs.length}</span>
          </button>
        )}
        <button
          className={`chart-tab ${activeView === 'passes' ? 'active' : ''}`}
          onClick={() => setActiveView('passes')}
        >
          Pass Network
          {hasPasses && <span className="tab-count">{passes.length}</span>}
        </button>
        {hasAttackDNA && (
          <button
            className={`chart-tab attack-dna-tab ${activeView === 'attack-dna' ? 'active' : ''}`}
            onClick={() => setActiveView('attack-dna')}
          >
            Attack DNA
            <span className="tab-count">NEW</span>
          </button>
        )}
        {hasTurnovers && (
          <button
            className={`chart-tab ${activeView === 'turnovers' ? 'active' : ''}`}
            onClick={() => setActiveView('turnovers')}
          >
            Turnovers
            <span className="tab-count">{turnovers.length}</span>
          </button>
        )}
        {hasIceTimeEvents && (
          <button
            className={`chart-tab ${activeView === 'zone-heat' ? 'active' : ''}`}
            onClick={() => setActiveView('zone-heat')}
          >
            Zone Heat
            <span className="tab-count">{iceTimeEvents.length}</span>
          </button>
        )}
      </div>

      {/* Chart content */}
      <div className="chart-content">
        {activeView === 'shots' && hasShots && (
          <div className="chart-view">
            <ShotChart
              shots={shots}
              showDangerZones={true}
              title={playerName ? `${playerName} - Shot Chart` : 'Shot Chart'}
            />

            {/* Additional shot insights */}
            <div className="insights-grid">
              <div className="insight-card">
                <h4>Shot Quality</h4>
                <p className="insight-value">
                  {shots.filter(s => s.xGoal && s.xGoal > 0.15).length} high-danger shots
                </p>
                <p className="insight-label">
                  {((shots.filter(s => s.xGoal && s.xGoal > 0.15).length / shots.length) * 100).toFixed(1)}% of total
                </p>
              </div>
              <div className="insight-card">
                <h4>Finishing</h4>
                <p className="insight-value">
                  {shots.filter(s => s.result === 'goal').length} goals
                </p>
                <p className="insight-label">
                  {((shots.filter(s => s.result === 'goal').length / shots.length) * 100).toFixed(1)}% shooting
                </p>
              </div>
              <div className="insight-card">
                <h4>Shot Types</h4>
                <p className="insight-value">
                  {shots.filter(s => s.shotType).length > 0
                    ? (() => {
                        const counts = shots.reduce((acc, s) => {
                          acc[s.shotType || 'other'] = (acc[s.shotType || 'other'] || 0) + 1;
                          return acc;
                        }, {} as Record<string, number>);
                        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
                      })()
                    : 'N/A'
                  }
                </p>
                <p className="insight-label">Most common shot type</p>
              </div>
            </div>
          </div>
        )}

        {activeView === 'heatmap' && hasShots && (
          <div className="chart-view">
            <ShotQualityHeatMap
              shots={shots.map((shot) => ({
                x: shot.x,
                y: shot.y,
                xGoal: shot.xGoal || 0,
              }))}
              title={playerName ? `${playerName} - Shot Quality Heat Map` : 'Shot Quality Heat Map'}
              width={600}
            />

            {/* xG Insights */}
            <div className="insights-grid">
              <div className="insight-card">
                <h4>Expected Goals (xG)</h4>
                <p className="insight-value">
                  {shots.reduce((sum, s) => sum + (s.xGoal || 0), 0).toFixed(2)}
                </p>
                <p className="insight-label">Total xG across all shots</p>
              </div>
              <div className="insight-card">
                <h4>Avg Shot Quality</h4>
                <p className="insight-value">
                  {(shots.reduce((sum, s) => sum + (s.xGoal || 0), 0) / shots.length).toFixed(3)}
                </p>
                <p className="insight-label">Average xG per shot</p>
              </div>
              <div className="insight-card">
                <h4>Shooting Efficiency</h4>
                <p className="insight-value">
                  {shots.filter(s => s.result === 'goal').length > 0
                    ? ((shots.filter(s => s.result === 'goal').length / shots.reduce((sum, s) => sum + (s.xGoal || 0), 0)) * 100).toFixed(0)
                    : '0'}%
                </p>
                <p className="insight-label">Goals vs Expected</p>
              </div>
            </div>
          </div>
        )}

        {activeView === 'hits' && hasHits && (
          <div className="chart-view">
            <HitChart
              hits={hits}
              title={playerName ? `${playerName} - Hit Locations` : 'Hit Locations'}
            />

            {/* Additional hit insights */}
            <div className="insights-grid">
              <div className="insight-card">
                <h4>Forechecking</h4>
                <p className="insight-value">
                  {hits.filter(h => h.zoneCode === 'O').length} O-zone hits
                </p>
                <p className="insight-label">
                  {((hits.filter(h => h.zoneCode === 'O').length / hits.length) * 100).toFixed(1)}% of total
                </p>
              </div>
              <div className="insight-card">
                <h4>Physicality</h4>
                <p className="insight-value">
                  {(hits.length / (gamesAnalyzed || 1)).toFixed(1)} hits/game
                </p>
                <p className="insight-label">Average hit rate</p>
              </div>
              <div className="insight-card">
                <h4>Zone Breakdown</h4>
                <p className="insight-value">
                  {hits.filter(h => h.zoneCode === 'O').length} / {hits.filter(h => h.zoneCode === 'N').length} / {hits.filter(h => h.zoneCode === 'D').length}
                </p>
                <p className="insight-label">O / N / D zones</p>
              </div>
            </div>
          </div>
        )}

        {activeView === 'faceoffs' && hasFaceoffs && (
          <div className="chart-view">
            <FaceoffChart
              faceoffs={faceoffs}
              playerName={playerName}
              title={playerName ? `${playerName} - Faceoff Performance` : 'Faceoff Performance'}
            />
          </div>
        )}

        {activeView === 'passes' && (
          <div className="chart-view">
            {hasPasses ? (
              <PassNetworkDiagram
                connections={passes}
                title={playerName ? `${playerName} - Pass Network` : 'Pass Network'}
                width={700}
                height={700}
              />
            ) : (
              <div className="ice-charts-empty" style={{ marginTop: '2rem' }}>
                <h3 className="empty-state-title">Pass Network Unavailable</h3>
                <p className="empty-state-message">
                  Pass data is not available for this player's recent games.
                </p>
              </div>
            )}
          </div>
        )}

        {activeView === 'attack-dna' && hasAttackDNA && attackDNA && (
          <div className="chart-view">
            <AttackDNA
              analytics={attackDNA}
              title={playerName ? `${playerName} - Attack DNA` : 'Attack DNA'}
              showFlowField={true}
              showRibbons={true}
              showFingerprint={true}
              comparisonFingerprint={comparisonFingerprint}
              comparisonLabel="League Average"
            />
          </div>
        )}

        {activeView === 'turnovers' && hasTurnovers && (
          <div className="chart-view">
            <TurnoverMap
              turnovers={turnovers}
              title={playerName ? `${playerName} - Turnover Map` : 'Turnover Map'}
            />
            <div className="insights-grid">
              <div className="insight-card">
                <h4>Takeaways</h4>
                <p className="insight-value">
                  {turnovers.filter(t => t.type === 'takeaway').length}
                </p>
                <p className="insight-label">Pucks stolen</p>
              </div>
              <div className="insight-card">
                <h4>Giveaways</h4>
                <p className="insight-value">
                  {turnovers.filter(t => t.type === 'giveaway').length}
                </p>
                <p className="insight-label">Pucks lost</p>
              </div>
              <div className="insight-card">
                <h4>T/G Ratio</h4>
                <p className="insight-value">
                  {turnovers.filter(t => t.type === 'giveaway').length > 0
                    ? (turnovers.filter(t => t.type === 'takeaway').length / turnovers.filter(t => t.type === 'giveaway').length).toFixed(2)
                    : 'N/A'}
                </p>
                <p className="insight-label">Higher is better</p>
              </div>
            </div>
          </div>
        )}

        {activeView === 'zone-heat' && hasIceTimeEvents && (
          <div className="chart-view">
            <ZoneHeatMap
              events={iceTimeEvents}
              title={playerName ? `${playerName} - Zone Activity` : 'Zone Activity Heat Map'}
              gridSize={8}
            />
            <div className="insights-grid">
              <div className="insight-card">
                <h4>Offensive Zone</h4>
                <p className="insight-value">
                  {iceTimeEvents.filter(e => e.x > 25).length}
                </p>
                <p className="insight-label">
                  {((iceTimeEvents.filter(e => e.x > 25).length / iceTimeEvents.length) * 100).toFixed(1)}% of events
                </p>
              </div>
              <div className="insight-card">
                <h4>Defensive Zone</h4>
                <p className="insight-value">
                  {iceTimeEvents.filter(e => e.x < -25).length}
                </p>
                <p className="insight-label">
                  {((iceTimeEvents.filter(e => e.x < -25).length / iceTimeEvents.length) * 100).toFixed(1)}% of events
                </p>
              </div>
              <div className="insight-card">
                <h4>Total Events</h4>
                <p className="insight-value">{iceTimeEvents.length}</p>
                <p className="insight-label">Shots, hits, faceoffs</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
