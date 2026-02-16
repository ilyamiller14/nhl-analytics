/**
 * Hot/Cold Zone Conversion Map Component
 *
 * Shows shooting efficiency (conversion rate) by ice zone, not just volume:
 * - Divides offensive zone into 6 strategic zones
 * - Color-coded by shooting% (hot zones = red, cold zones = blue)
 * - Bubble size proportional to shot volume
 * - Overlaid on NHL rink for spatial context
 */

import { useMemo } from 'react';
import NHLRink from './NHLRink';

interface ConversionZoneChartProps {
  shots: Array<{
    x: number; // NHL coordinates: -100 to 100
    y: number; // NHL coordinates: -42.5 to 42.5
    result: 'goal' | 'shot' | 'save' | 'miss' | 'block';
  }>;
  playerName?: string;
}

interface ZoneStats {
  zoneId: string;
  zoneName: string;
  centerX: number; // SVG coordinates
  centerY: number; // SVG coordinates
  shots: number;
  goals: number;
  shootingPct: number;
  color: string;
}

// Define zones in offensive zone (NHL coordinates for classification)
const ZONES = [
  {
    id: 'high-slot',
    name: 'High Slot',
    minX: 25,
    maxX: 69,
    minY: -10,
    maxY: 10,
    centerX: 147, // SVG (47 + 100)
    centerY: 42.5, // SVG
  },
  {
    id: 'low-slot',
    name: 'Low Slot / Crease',
    minX: 69,
    maxX: 89,
    minY: -10,
    maxY: 10,
    centerX: 179, // SVG (79 + 100)
    centerY: 42.5,
  },
  {
    id: 'left-circle',
    name: 'Left Circle',
    minX: 40,
    maxX: 89,
    minY: -42.5,
    maxY: -10,
    centerX: 164.5, // SVG (64.5 + 100)
    centerY: 16.25, // SVG (-26.25 + 42.5)
  },
  {
    id: 'right-circle',
    name: 'Right Circle',
    minX: 40,
    maxX: 89,
    minY: 10,
    maxY: 42.5,
    centerX: 164.5,
    centerY: 68.75, // SVG (26.25 + 42.5)
  },
  {
    id: 'point',
    name: 'Point',
    minX: 25,
    maxX: 40,
    minY: -42.5,
    maxY: 42.5,
    centerX: 132.5, // SVG (32.5 + 100)
    centerY: 42.5,
  },
  {
    id: 'behind-net',
    name: 'Behind Net',
    minX: 89,
    maxX: 100,
    minY: -42.5,
    maxY: 42.5,
    centerX: 194.5, // SVG (94.5 + 100)
    centerY: 42.5,
  },
];

/**
 * Classify shot into a zone
 */
function classifyShot(x: number, y: number): string | null {
  // Only consider offensive zone shots (x > 25 in NHL coords)
  if (x <= 25) return null;

  for (const zone of ZONES) {
    if (x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY) {
      return zone.id;
    }
  }

  return null;
}

/**
 * Get color based on shooting percentage
 */
function getColorForShootingPct(pct: number): string {
  // League average shooting% is around 10%
  // Red (hot) = 15%+, Blue (cold) = <7%
  if (pct >= 15) return '#dc2626'; // Hot red
  if (pct >= 12) return '#f97316'; // Warm orange
  if (pct >= 10) return '#fbbf24'; // Average yellow
  if (pct >= 7) return '#60a5fa'; // Cool blue
  return '#3b82f6'; // Cold blue
}

/**
 * Calculate bubble radius based on shot volume
 * More shots = bigger bubble
 */
function getBubbleRadius(shotCount: number, maxShots: number): number {
  const minRadius = 3;
  const maxRadius = 12;
  const ratio = shotCount / maxShots;
  return minRadius + ratio * (maxRadius - minRadius);
}

export default function ConversionZoneChart({ shots, playerName }: ConversionZoneChartProps) {
  const zoneStats: ZoneStats[] = useMemo(() => {
    // Initialize zone stats
    const stats = ZONES.map((zone) => ({
      zoneId: zone.id,
      zoneName: zone.name,
      centerX: zone.centerX,
      centerY: zone.centerY,
      shots: 0,
      goals: 0,
      shootingPct: 0,
      color: '#9ca3af',
    }));

    // Count shots and goals per zone
    const statMap = new Map<string, { shots: number; goals: number }>();
    ZONES.forEach((z) => statMap.set(z.id, { shots: 0, goals: 0 }));

    shots.forEach((shot) => {
      const zoneId = classifyShot(shot.x, shot.y);
      if (!zoneId) return;

      const zoneStat = statMap.get(zoneId);
      if (zoneStat) {
        zoneStat.shots++;
        if (shot.result === 'goal') {
          zoneStat.goals++;
        }
      }
    });

    // Calculate shooting% and assign colors
    statMap.forEach((stat, zoneId) => {
      const zoneIndex = stats.findIndex((s) => s.zoneId === zoneId);
      if (zoneIndex >= 0) {
        stats[zoneIndex].shots = stat.shots;
        stats[zoneIndex].goals = stat.goals;
        stats[zoneIndex].shootingPct =
          stat.shots > 0 ? (stat.goals / stat.shots) * 100 : 0;
        stats[zoneIndex].color = getColorForShootingPct(stats[zoneIndex].shootingPct);
      }
    });

    return stats;
  }, [shots]);

  const maxShots = Math.max(...zoneStats.map((z) => z.shots), 1);

  // Calculate overall shooting%
  const totalShots = zoneStats.reduce((sum, z) => sum + z.shots, 0);
  const totalGoals = zoneStats.reduce((sum, z) => sum + z.goals, 0);
  const overallShootingPct = totalShots > 0 ? (totalGoals / totalShots) * 100 : 0;

  if (totalShots === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
        <p>No shot data available for zone conversion analysis.</p>
      </div>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          Hot/Cold Zone Conversion Map {playerName && `— ${playerName}`}
        </h3>
        <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>
          Shows shooting efficiency (conversion rate) by ice zone. Bubble size = shot volume, color = conversion rate.
        </p>
      </div>

      {/* Overall Stats */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.5rem',
          padding: '1rem',
          background: '#f9fafb',
          borderRadius: '8px',
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>
            Total Shots
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>
            {totalShots}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>
            Goals
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>
            {totalGoals}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>
            Overall Shooting%
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 600, color: getColorForShootingPct(overallShootingPct) }}>
            {overallShootingPct.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Rink with Zone Overlay */}
      <div style={{ position: 'relative', maxWidth: '700px', margin: '0 auto' }}>
        <svg width="100%" height="auto" viewBox="100 0 100 85" style={{ border: '1px solid #e5e7eb', borderRadius: '8px' }}>
          {/* Rink background using asGroup mode */}
          <g>
            <NHLRink halfRink={true} asGroup={true} />
          </g>

          {/* Zone bubbles overlay */}
          {zoneStats.map((zone) => {
            if (zone.shots === 0) return null;

            const radius = getBubbleRadius(zone.shots, maxShots);

            return (
              <g key={zone.zoneId}>
                {/* Bubble circle */}
                <circle
                  cx={zone.centerX}
                  cy={zone.centerY}
                  r={radius}
                  fill={zone.color}
                  fillOpacity={0.7}
                  stroke="white"
                  strokeWidth={1.5}
                  style={{ cursor: 'pointer' }}
                >
                  <title>
                    {zone.zoneName}: {zone.shots} shots, {zone.goals} goals ({zone.shootingPct.toFixed(1)}%)
                  </title>
                </circle>

                {/* Shooting % label */}
                <text
                  x={zone.centerX}
                  y={zone.centerY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontSize: '6px',
                    fontWeight: 600,
                    fill: 'white',
                    pointerEvents: 'none',
                  }}
                >
                  {zone.shootingPct.toFixed(0)}%
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Zone Breakdown Table */}
      <div style={{ marginTop: '1.5rem' }}>
        <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem' }}>
          Zone Breakdown
        </h4>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>Zone</th>
                <th style={{ padding: '0.75rem', textAlign: 'right' }}>Shots</th>
                <th style={{ padding: '0.75rem', textAlign: 'right' }}>Goals</th>
                <th style={{ padding: '0.75rem', textAlign: 'right' }}>Shooting%</th>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>Efficiency</th>
              </tr>
            </thead>
            <tbody>
              {zoneStats
                .filter((z) => z.shots > 0)
                .sort((a, b) => b.shootingPct - a.shootingPct)
                .map((zone) => (
                  <tr key={zone.zoneId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '0.75rem' }}>{zone.zoneName}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'right' }}>{zone.shots}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'right' }}>{zone.goals}</td>
                    <td
                      style={{
                        padding: '0.75rem',
                        textAlign: 'right',
                        fontWeight: 600,
                        color: zone.color,
                      }}
                    >
                      {zone.shootingPct.toFixed(1)}%
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <div
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '50%',
                          background: zone.color,
                          display: 'inline-block',
                        }}
                      />
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.8125rem', color: '#6b7280' }}>
                        {zone.shootingPct >= 15
                          ? 'Hot'
                          : zone.shootingPct >= 10
                          ? 'Average'
                          : 'Cold'}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Color Legend */}
      <div
        style={{
          marginTop: '1rem',
          padding: '1rem',
          background: '#f0f9ff',
          borderLeft: '4px solid #3b82f6',
          borderRadius: '4px',
        }}
      >
        <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          Color Guide:
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.8125rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#dc2626' }} />
            <span>Hot Zone (15%+)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#f97316' }} />
            <span>Warm (12-15%)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#fbbf24' }} />
            <span>Average (10-12%)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#60a5fa' }} />
            <span>Cool (7-10%)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#3b82f6' }} />
            <span>Cold (&lt;7%)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
