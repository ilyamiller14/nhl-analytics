/**
 * RAPM Two-Way Impact Scatter
 *
 * Each dot is a skater's 5v5 isolated offense (xGF/60 above RAPM baseline)
 * on the Y-axis vs defense (xGA/60 suppression) on the X-axis. Line-mate
 * and opponent effects are regressed out by the RAPM ridge, so a point in
 * the upper-right really is a two-way driver — not just a guy benefiting
 * from a good line.
 *
 * Dot size scales with 5v5 minutes. Color is the team primary (when known)
 * so the chart reads like a league-wide map, with a position-based
 * fallback. Low-sample players (gp < 40 inside the RAPM regression) are
 * dimmed. Every value comes from the artifact passed in — no hardcoded
 * baselines or percentiles.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  Label,
} from 'recharts';
import type { RAPMArtifact } from '../../services/rapmService';
import { getTeamPrimaryColor } from '../../constants/teams';

export interface RAPMScatterProps {
  artifact: RAPMArtifact;
  playerNames: Map<number, string>;
  posFilter: 'ALL' | 'F' | 'D';
  /** position code per player — used for F/D filter + fallback color */
  posByPlayerId: Map<number, string>;
  /** team abbrev per player — optional; powers team-primary color */
  teamByPlayerId: Map<number, string>;
  /** minimum 5v5 minutes to plot (below this, SE is too large to trust) */
  minMinutes: number;
}

interface PointDatum {
  playerId: number;
  name: string;
  team: string;
  pos: string;
  offense: number;
  defense: number;
  offenseSE: number;
  defenseSE: number;
  minutes: number;
  gp: number;
  lowSample: boolean;
  color: string;
  opacity: number;
}

function isForward(posCode: string): boolean {
  // Treat anything that isn't D/G as a forward (C/L/R and unknowns default F).
  return posCode !== 'D' && posCode !== 'G';
}

export default function RAPMScatter({
  artifact,
  playerNames,
  posFilter,
  posByPlayerId,
  teamByPlayerId,
  minMinutes,
}: RAPMScatterProps) {
  const navigate = useNavigate();

  const points = useMemo<PointDatum[]>(() => {
    const out: PointDatum[] = [];
    for (const [pidStr, entry] of Object.entries(artifact.players)) {
      const playerId = Number(pidStr);
      if (!Number.isFinite(playerId)) continue;
      if (entry.minutes < minMinutes) continue;

      const pos = posByPlayerId.get(playerId) || '';
      const isF = isForward(pos);
      if (posFilter === 'F' && !isF) continue;
      if (posFilter === 'D' && pos !== 'D') continue;

      const team = teamByPlayerId.get(playerId) || '';
      // Prefer team primary color so the plot reads as a league map.
      // Fall back to position tokens when team unknown.
      const teamColor = team ? getTeamPrimaryColor(team) : '';
      const posColor = pos === 'D' ? 'var(--warning)' : 'var(--info)';
      const color = teamColor || posColor;

      out.push({
        playerId,
        name: playerNames.get(playerId) || `#${playerId}`,
        team,
        pos: pos || '—',
        offense: entry.offense,
        defense: entry.defense,
        offenseSE: entry.offenseSE,
        defenseSE: entry.defenseSE,
        minutes: entry.minutes,
        gp: entry.gp,
        lowSample: entry.lowSample,
        color,
        opacity: entry.lowSample ? 0.3 : 0.85,
      });
    }
    return out;
  }, [artifact, playerNames, posFilter, posByPlayerId, teamByPlayerId, minMinutes]);

  // Compute the Z domain (minutes → dot size) from the filtered set itself
  // so dot sizing always uses the visible distribution — no assumed caps.
  const zDomain = useMemo<[number, number]>(() => {
    if (points.length === 0) return [0, 1];
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      if (p.minutes < min) min = p.minutes;
      if (p.minutes > max) max = p.minutes;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      return [Math.max(0, min || 0), (max || 1) + 1];
    }
    return [min, max];
  }, [points]);

  if (points.length < 5) {
    return (
      <div className="rapm-empty">
        Not enough players match this filter. Try widening the position
        filter or lowering the minutes threshold. (Currently {points.length}{' '}
        {points.length === 1 ? 'player' : 'players'} at {minMinutes}+ 5v5
        minutes.)
      </div>
    );
  }

  return (
    <div className="rapm-scatter-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart
          margin={{ top: 28, right: 28, bottom: 44, left: 44 }}
          onClick={(e: unknown) => {
            // Recharts click payload — guard defensively and navigate when
            // a point was hit. The Scatter itself also has onClick below,
            // but wiring both keeps click behavior consistent across the
            // small-target hit area on mobile.
            const payload = (e as { activePayload?: Array<{ payload?: PointDatum }> })?.activePayload?.[0]?.payload;
            if (payload && typeof payload.playerId === 'number') {
              navigate(`/player/${payload.playerId}`);
            }
          }}
        >
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="defense"
            name="Defense impact"
            domain={['auto', 'auto']}
            tick={{ fill: 'var(--chart-muted)', fontSize: 11 }}
            stroke="var(--chart-axis)"
            tickFormatter={(v: number) => v.toFixed(2)}
          >
            <Label
              value="Defense impact  (xGA/60 suppressed →)"
              position="bottom"
              offset={16}
              style={{ fill: 'var(--chart-text)', fontSize: 12 }}
            />
          </XAxis>
          <YAxis
            type="number"
            dataKey="offense"
            name="Offense impact"
            domain={['auto', 'auto']}
            tick={{ fill: 'var(--chart-muted)', fontSize: 11 }}
            stroke="var(--chart-axis)"
            tickFormatter={(v: number) => v.toFixed(2)}
          >
            <Label
              value="Offense impact (xGF/60 above ↑)"
              angle={-90}
              position="left"
              offset={20}
              style={{ fill: 'var(--chart-text)', fontSize: 12, textAnchor: 'middle' }}
            />
          </YAxis>
          <ZAxis
            type="number"
            dataKey="minutes"
            domain={zDomain}
            range={[30, 260]}
            name="Minutes"
          />
          <ReferenceLine x={0} stroke="var(--chart-sep)" strokeWidth={1} />
          <ReferenceLine y={0} stroke="var(--chart-sep)" strokeWidth={1} />
          {/* Quadrant corner labels — faint, never overlap the axes. */}
          <ReferenceLine
            y={0}
            stroke="transparent"
            label={{
              value: 'TWO-WAY ELITE',
              position: 'insideTopRight',
              fill: 'var(--panel-text-faint)',
              fontSize: 10,
              fontWeight: 600,
            }}
          />
          <ReferenceLine
            y={0}
            stroke="transparent"
            label={{
              value: 'OFFENSIVE SPECIALIST',
              position: 'insideTopLeft',
              fill: 'var(--panel-text-faint)',
              fontSize: 10,
              fontWeight: 600,
            }}
          />
          <ReferenceLine
            y={0}
            stroke="transparent"
            label={{
              value: 'DEFENSIVE SPECIALIST',
              position: 'insideBottomRight',
              fill: 'var(--panel-text-faint)',
              fontSize: 10,
              fontWeight: 600,
            }}
          />
          <ReferenceLine
            y={0}
            stroke="transparent"
            label={{
              value: 'REPLACEMENT-LEVEL',
              position: 'insideBottomLeft',
              fill: 'var(--panel-text-faint)',
              fontSize: 10,
              fontWeight: 600,
            }}
          />
          <Tooltip
            cursor={{ stroke: 'var(--panel-border-strong)', strokeDasharray: '3 3' }}
            contentStyle={{
              background: 'var(--panel-bg-elev-strong)',
              border: '1px solid var(--panel-border-strong)',
              borderRadius: 8,
              color: 'var(--panel-text-bright)',
              fontSize: 12,
            }}
            labelStyle={{ color: 'var(--panel-text-brighter)' }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const p = payload[0].payload as PointDatum;
              return (
                <div
                  style={{
                    background: 'var(--panel-bg-elev-strong)',
                    border: '1px solid var(--panel-border-strong)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    color: 'var(--panel-text-bright)',
                    fontSize: 12,
                    lineHeight: 1.45,
                    minWidth: 180,
                  }}
                >
                  <div style={{ fontWeight: 600, color: 'var(--panel-text-brighter)' }}>
                    {p.name}
                  </div>
                  <div style={{ color: 'var(--panel-text-muted)', fontSize: 11, marginBottom: 4 }}>
                    {p.team || '—'} · {p.pos}
                    {p.lowSample ? ' · low sample' : ''}
                  </div>
                  <div>
                    Offense: <strong>{p.offense >= 0 ? '+' : ''}{p.offense.toFixed(3)}</strong>
                    <span style={{ color: 'var(--panel-text-faint)' }}> ± {p.offenseSE.toFixed(3)}</span>
                  </div>
                  <div>
                    Defense: <strong>{p.defense >= 0 ? '+' : ''}{p.defense.toFixed(3)}</strong>
                    <span style={{ color: 'var(--panel-text-faint)' }}> ± {p.defenseSE.toFixed(3)}</span>
                  </div>
                  <div style={{ color: 'var(--panel-text-muted)', fontSize: 11, marginTop: 4 }}>
                    {p.minutes.toFixed(0)} min · {p.gp} GP
                  </div>
                </div>
              );
            }}
          />
          <Scatter
            data={points}
            isAnimationActive={false}
            onClick={(data: unknown) => {
              // Single-dot click — Recharts passes the payload directly.
              const d = data as PointDatum | { payload?: PointDatum } | undefined;
              const pid =
                (d as PointDatum)?.playerId ??
                (d as { payload?: PointDatum })?.payload?.playerId;
              if (typeof pid === 'number') navigate(`/player/${pid}`);
            }}
          >
            {points.map((p) => (
              <Cell
                key={p.playerId}
                fill={p.color}
                fillOpacity={p.opacity}
                stroke={p.color}
                strokeOpacity={Math.min(1, p.opacity + 0.15)}
                style={{ cursor: 'pointer' }}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
