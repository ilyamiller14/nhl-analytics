/**
 * Line Combination Chart
 *
 * Scatter/bubble chart showing forward line and defense pair performance:
 * - X-axis: Shots For per 60 (offensive output)
 * - Y-axis: Shots Against per 60 (defensive exposure)
 * - Bubble size: Total shots (proxy for TOI)
 * - Quadrants: Elite, Offensive, Defensive, Poor
 *
 * Used in: ManagementDashboard
 */

import { useMemo, useState } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import type { LineComboAnalysis, LineCombination } from '../../services/lineComboAnalytics';

interface LineCombinationChartProps {
  data: LineComboAnalysis;
}

const QUADRANT_COLORS: Record<string, string> = {
  elite: '#10b981',
  offensive: '#f59e0b',
  defensive: '#3b82f6',
  poor: '#ef4444',
};

const QUADRANT_LABELS: Record<string, string> = {
  elite: 'Elite',
  offensive: 'Offensive',
  defensive: 'Defensive',
  poor: 'Poor',
};

function ComboTable({ combos, title }: { combos: LineCombination[]; title: string }) {
  if (combos.length === 0) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center', color: '#6b7280', fontSize: '0.875rem' }}>
        Not enough data to identify {title.toLowerCase()}. More 5v5 shot data needed.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Players</th>
            <th style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>GP</th>
            <th style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>SF/60</th>
            <th style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>SA/60</th>
            <th style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>xGF/60</th>
            <th style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>xGA/60</th>
            <th style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Diff/60</th>
            <th style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Rating</th>
          </tr>
        </thead>
        <tbody>
          {combos.map((combo) => (
            <tr key={combo.comboId} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '0.5rem', fontSize: '0.8rem' }}>
                {combo.players.map(p => p.name.split(' ').pop()).join(' - ')}
              </td>
              <td style={{ padding: '0.5rem', textAlign: 'center', color: '#6b7280' }}>{combo.gamesAppeared}</td>
              <td style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600 }}>{combo.shotsForPer60}</td>
              <td style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600 }}>{combo.shotsAgainstPer60}</td>
              <td style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600, color: '#10b981' }}>{combo.xGForPer60}</td>
              <td style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600, color: '#ef4444' }}>{combo.xGAgainstPer60}</td>
              <td style={{
                padding: '0.5rem', textAlign: 'center', fontWeight: 700,
                color: combo.shotDifferentialPer60 > 0 ? '#10b981' : combo.shotDifferentialPer60 < 0 ? '#ef4444' : '#6b7280',
              }}>
                {combo.shotDifferentialPer60 > 0 ? '+' : ''}{combo.shotDifferentialPer60}
              </td>
              <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                <span style={{
                  display: 'inline-block', padding: '2px 8px', borderRadius: '4px',
                  fontSize: '0.7rem', fontWeight: 600,
                  background: QUADRANT_COLORS[combo.quadrant] + '20',
                  color: QUADRANT_COLORS[combo.quadrant],
                }}>
                  {QUADRANT_LABELS[combo.quadrant]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Custom tooltip for scatter chart
function ChartTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0].payload;
  return (
    <div style={{
      background: 'rgba(0,0,0,0.9)', color: 'white', padding: '0.75rem',
      borderRadius: '8px', fontSize: '0.8rem', maxWidth: '220px',
    }}>
      <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>{data.label}</div>
      <div>SF/60: {data.sf60}</div>
      <div>SA/60: {data.sa60}</div>
      <div>xG Diff/60: {data.xgDiff > 0 ? '+' : ''}{data.xgDiff}</div>
      <div>Games: {data.games}</div>
      <div style={{ marginTop: '0.25rem', color: QUADRANT_COLORS[data.quadrant] }}>
        {QUADRANT_LABELS[data.quadrant]}
      </div>
    </div>
  );
}

export default function LineCombinationChart({ data }: LineCombinationChartProps) {
  const [activeTab, setActiveTab] = useState<'chart' | 'forwards' | 'defense'>('chart');

  // Transform data for scatter chart
  const scatterData = useMemo(() => {
    const all = [...data.forwardLines, ...data.defensePairs];
    return all.map(combo => ({
      sf60: combo.shotsForPer60,
      sa60: combo.shotsAgainstPer60,
      size: Math.max(20, Math.min(80, (combo.shotsFor + combo.shotsAgainst) * 1.5)),
      label: combo.players.map(p => p.name.split(' ').pop()).join('-'),
      quadrant: combo.quadrant,
      xgDiff: combo.xGDifferentialPer60,
      games: combo.gamesAppeared,
      type: combo.lineType,
    }));
  }, [data]);

  // Compute median lines for quadrant reference
  const medianSF = useMemo(() => {
    if (scatterData.length === 0) return 14;
    const sorted = [...scatterData].sort((a, b) => a.sf60 - b.sf60);
    return sorted[Math.floor(sorted.length / 2)]?.sf60 || 14;
  }, [scatterData]);

  const medianSA = useMemo(() => {
    if (scatterData.length === 0) return 14;
    const sorted = [...scatterData].sort((a, b) => a.sa60 - b.sa60);
    return sorted[Math.floor(sorted.length / 2)]?.sa60 || 14;
  }, [scatterData]);

  return (
    <div style={{ width: '100%' }}>
      {/* Tab Buttons */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[
          { key: 'chart' as const, label: 'Scatter Chart' },
          { key: 'forwards' as const, label: `Forward Lines (${data.forwardLines.length})` },
          { key: 'defense' as const, label: `Defense Pairs (${data.defensePairs.length})` },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #e5e7eb',
              background: activeTab === tab.key ? '#003087' : 'white',
              color: activeTab === tab.key ? 'white' : '#374151',
              fontWeight: activeTab === tab.key ? 600 : 400,
              fontSize: '0.85rem', cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'chart' && scatterData.length > 0 && (
        <div>
          <ResponsiveContainer width="100%" height={350}>
            <ScatterChart margin={{ top: 20, right: 20, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                type="number"
                dataKey="sf60"
                name="Shots For/60"
                label={{ value: 'Shots For/60 →', position: 'bottom', offset: 10, fontSize: 12, fill: '#6b7280' }}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="sa60"
                name="Shots Against/60"
                label={{ value: '← Shots Against/60', angle: -90, position: 'left', offset: 0, fontSize: 12, fill: '#6b7280' }}
                tick={{ fontSize: 11 }}
                reversed
              />
              <ReferenceLine x={medianSF} stroke="#94a3b8" strokeDasharray="5 5" />
              <ReferenceLine y={medianSA} stroke="#94a3b8" strokeDasharray="5 5" />
              <Tooltip content={<ChartTooltip />} />
              <Scatter data={scatterData}>
                {scatterData.map((entry, idx) => (
                  <Cell
                    key={idx}
                    fill={QUADRANT_COLORS[entry.quadrant]}
                    fillOpacity={0.7}
                    stroke={QUADRANT_COLORS[entry.quadrant]}
                    strokeWidth={1}
                    r={entry.type === 'forward' ? 8 : 6}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>

          {/* Quadrant Legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'center', marginTop: '0.5rem' }}>
            {Object.entries(QUADRANT_LABELS).map(([key, label]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: '#6b7280' }}>
                <span style={{
                  width: '10px', height: '10px', borderRadius: '50%',
                  background: QUADRANT_COLORS[key], display: 'inline-block',
                }} />
                {label}
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: '#6b7280' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '50%', border: '1px solid #94a3b8', display: 'inline-block' }} />
              Forward
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: '#6b7280' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', border: '1px solid #94a3b8', display: 'inline-block' }} />
              Defense
            </div>
          </div>
        </div>
      )}

      {activeTab === 'chart' && scatterData.length === 0 && (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
          Not enough 5v5 shot data to chart line combinations.
        </div>
      )}

      {activeTab === 'forwards' && (
        <ComboTable combos={data.forwardLines} title="Forward Lines" />
      )}

      {activeTab === 'defense' && (
        <ComboTable combos={data.defensePairs} title="Defense Pairs" />
      )}

      {/* Info */}
      <div style={{
        marginTop: '1rem', padding: '0.75rem', background: '#f0f9ff',
        borderRadius: '6px', fontSize: '0.75rem', color: '#0369a1',
      }}>
        Based on {data.gamesAnalyzed} games. Shows 5v5 on-ice performance for identified line combinations.
        Bubble size represents total shot involvement. Y-axis inverted: lower = fewer shots against (better defensively).
      </div>
    </div>
  );
}
