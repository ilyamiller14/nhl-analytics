/**
 * Roster Balance Chart
 *
 * Displays roster construction analysis:
 * - Age distribution pyramid by position
 * - Production concentration pie chart
 * - Depth alerts
 *
 * Used in: ManagementDashboard
 */

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import type { RosterBalanceData } from '../../services/rosterBalanceAnalytics';

interface RosterBalanceChartProps {
  data: RosterBalanceData;
}

const POSITION_COLORS = {
  forwards: '#3b82f6',
  defensemen: '#10b981',
  goalies: '#f59e0b',
};

const TIER_COLORS = ['#003087', '#3b82f6', '#93c5fd', '#10b981', '#6ee7b7'];

function AgePyramid({ data }: { data: RosterBalanceData }) {
  const chartData = useMemo(() =>
    data.ageDistribution
      .filter(d => d.total > 0)
      .map(d => ({
        bracket: d.bracket.label.split(' ')[0], // Short label
        fullLabel: d.bracket.label,
        Forwards: d.forwards,
        Defensemen: d.defensemen,
        Goalies: d.goalies,
      })),
    [data]
  );

  if (chartData.length === 0) {
    return <div style={{ padding: '1rem', textAlign: 'center', color: '#6b7280' }}>No age data available.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis
          type="category"
          dataKey="bracket"
          width={65}
          tick={{ fontSize: 10 }}
        />
        <Tooltip
          formatter={((value: any, name: any) => [value ?? 0, name ?? '']) as any}
          labelFormatter={(label: any) => {
            const full = chartData.find(d => d.bracket === String(label));
            return full?.fullLabel || String(label);
          }}
        />
        <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
        <Bar dataKey="Forwards" stackId="a" fill={POSITION_COLORS.forwards} radius={[0, 0, 0, 0]} />
        <Bar dataKey="Defensemen" stackId="a" fill={POSITION_COLORS.defensemen} />
        <Bar dataKey="Goalies" stackId="a" fill={POSITION_COLORS.goalies} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ProductionPie({ data }: { data: RosterBalanceData }) {
  const pieData = useMemo(() =>
    data.productionTiers
      .filter(t => t.totalPoints > 0)
      .map(t => ({
        name: t.tier,
        value: t.totalPoints,
        share: t.pointShare,
      })),
    [data]
  );

  if (pieData.length === 0) {
    return <div style={{ padding: '1rem', textAlign: 'center', color: '#6b7280' }}>No production data available.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie
          data={pieData}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={90}
          paddingAngle={2}
          dataKey="value"
          label={({ name, payload }: any) => `${(name || '').split(' ')[0]} ${payload?.share ?? 0}%`}
          labelLine={false}
        >
          {pieData.map((_entry, idx) => (
            <Cell key={idx} fill={TIER_COLORS[idx % TIER_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={((value: any, _name: any, entry: any) => [`${value ?? 0} pts (${entry?.payload?.share ?? 0}%)`, entry?.payload?.name ?? '']) as any} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export default function RosterBalanceChart({ data }: RosterBalanceChartProps) {
  return (
    <div style={{ width: '100%' }}>
      {/* Summary Stats */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Avg Age', value: data.averageAge.toFixed(1), sub: 'All skaters' },
          { label: 'Fwd Avg', value: data.averageAgeByPosition.forwards.toFixed(1), sub: 'Forwards' },
          { label: 'Def Avg', value: data.averageAgeByPosition.defensemen.toFixed(1), sub: 'Defensemen' },
          { label: 'Top-3 Share', value: `${data.scoringConcentration}%`, sub: 'of team points' },
        ].map((card) => (
          <div key={card.label} style={{
            flex: '1 1 100px', padding: '0.75rem', background: '#f9fafb',
            borderRadius: '8px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '0.7rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {card.label}
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1f2937' }}>
              {card.value}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Age Distribution */}
        <div style={{ background: 'white', borderRadius: '8px', padding: '1rem', border: '1px solid #e5e7eb' }}>
          <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1f2937', marginBottom: '0.75rem' }}>
            Age Distribution
          </h4>
          <AgePyramid data={data} />
        </div>

        {/* Production Concentration */}
        <div style={{ background: 'white', borderRadius: '8px', padding: '1rem', border: '1px solid #e5e7eb' }}>
          <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1f2937', marginBottom: '0.75rem' }}>
            Scoring Depth
          </h4>
          <ProductionPie data={data} />
        </div>
      </div>

      {/* Production Breakdown Table */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1f2937', marginBottom: '0.75rem' }}>
          Production by Tier
        </h4>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Tier</th>
                <th style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Players</th>
                <th style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Points</th>
                <th style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Share</th>
                <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Top Contributor</th>
              </tr>
            </thead>
            <tbody>
              {data.productionTiers.map((tier, idx) => (
                <tr key={tier.tier} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.5rem', fontWeight: 600 }}>
                    <span style={{
                      display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px',
                      background: TIER_COLORS[idx % TIER_COLORS.length], marginRight: '0.5rem',
                    }} />
                    {tier.tier}
                  </td>
                  <td style={{ padding: '0.5rem', textAlign: 'center', color: '#6b7280' }}>
                    {tier.players.length}
                  </td>
                  <td style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600 }}>
                    {tier.totalPoints}
                  </td>
                  <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                      <div style={{
                        width: '40px', height: '6px', borderRadius: '3px', background: '#e5e7eb',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${tier.pointShare}%`, height: '100%', borderRadius: '3px',
                          background: TIER_COLORS[idx % TIER_COLORS.length],
                        }} />
                      </div>
                      <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{tier.pointShare}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '0.5rem', fontSize: '0.8rem', color: '#6b7280' }}>
                    {tier.players[0]
                      ? `${tier.players[0].name} (${tier.players[0].points} pts)`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alerts */}
      {data.alerts.length > 0 && (
        <div>
          <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1f2937', marginBottom: '0.75rem' }}>
            Roster Insights
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {data.alerts.map((alert, idx) => (
              <div key={idx} style={{
                padding: '0.75rem 1rem', borderRadius: '6px',
                background: alert.type === 'warning' ? '#fef3c7' : '#dbeafe',
                borderLeft: `3px solid ${alert.type === 'warning' ? '#f59e0b' : '#3b82f6'}`,
                fontSize: '0.85rem',
              }}>
                <span style={{ fontWeight: 600, color: alert.type === 'warning' ? '#92400e' : '#1e40af' }}>
                  {alert.category}:
                </span>{' '}
                <span style={{ color: alert.type === 'warning' ? '#78350f' : '#1e3a8a' }}>
                  {alert.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
