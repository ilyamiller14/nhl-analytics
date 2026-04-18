/**
 * Season Shot Quality Pulse
 *
 * One horizontal strip per recent game, stacked top-to-bottom. Each
 * strip is 60 minutes of game time; each shot the team took that game
 * is a vertical tick along the strip, height proportional to shot xG,
 * color intensity scaled to xG, goals marked with a filled star.
 *
 * A season of offense visualized as a rhythm — nights the team
 * hammered high-xG chances show up as dense tall strips; quiet games
 * show up as sparse short ones. Shows shot quality *timing* not just
 * totals.
 *
 * Input: flat ShotAttempt[] with xGoal, shooter team's timing
 * (period + timeInPeriod). Groups by game via a synthetic gameKey
 * derived from the sequence of shots (same game = same run of shots
 * in input order, delimited by period 1 starting again).
 */

import { useMemo } from 'react';
import type { ShotAttempt } from '../../services/playByPlayService';
import './SeasonShotQualityPulse.css';

interface Props {
  shots: ShotAttempt[];
  title?: string;
  height?: number; // per-strip height
}

interface GameGroup {
  gameId: number;
  gameDate?: string;
  gameIndex: number;
  shots: ShotAttempt[];
  goalCount: number;
  totalXG: number;
}

// Period length: 1200s. OT is 300s regular season but for layout we use
// 1200s per period consistently; shots after regulation render at the
// right edge of the strip.
const PERIOD_SECONDS = 1200;
const FULL_GAME_SECONDS = 3 * PERIOD_SECONDS;

function parseTimeInPeriod(t: string, period: number, isOT: boolean): number {
  // Returns seconds elapsed since start of game.
  const [mm, ss] = (t || '00:00').split(':').map(v => parseInt(v, 10) || 0);
  const periodOffset = (Math.min(period, 3) - 1) * PERIOD_SECONDS;
  const intoPeriod = mm * 60 + ss;
  if (isOT) return FULL_GAME_SECONDS + Math.min(intoPeriod, 300);
  return Math.min(FULL_GAME_SECONDS, periodOffset + intoPeriod);
}

export default function SeasonShotQualityPulse({ shots, title, height = 18 }: Props) {
  const games = useMemo<GameGroup[]>(() => {
    if (!shots || shots.length === 0) return [];
    // Group by gameId. Each ShotAttempt carries its source gameId from
    // the aggregator. Games are ordered by their first appearance so
    // input order (chronological in our case) is preserved.
    const byGame = new Map<number, GameGroup>();
    let order = 0;
    for (const s of shots) {
      if (!s.gameId) continue;
      let g = byGame.get(s.gameId);
      if (!g) {
        g = {
          gameId: s.gameId,
          gameDate: s.gameDate,
          gameIndex: order++,
          shots: [],
          goalCount: 0,
          totalXG: 0,
        };
        byGame.set(s.gameId, g);
      }
      g.shots.push(s);
      if (s.type === 'goal') g.goalCount += 1;
      g.totalXG += s.xGoal ?? 0;
    }
    return Array.from(byGame.values()).sort((a, b) => {
      const da = a.gameDate ? Date.parse(a.gameDate) : 0;
      const db = b.gameDate ? Date.parse(b.gameDate) : 0;
      return da - db || a.gameIndex - b.gameIndex;
    }).map((g, i) => ({ ...g, gameIndex: i }));
  }, [shots]);

  if (games.length === 0) {
    return (
      <div className="sqp">
        {title && <h3 className="sqp-title">{title}</h3>}
        <div className="sqp-empty">No shot timing data yet.</div>
      </div>
    );
  }

  const rowHeight = height;
  const rowGap = 3;
  const totalHeight = games.length * (rowHeight + rowGap) + 40;
  const stripWidth = 920;

  // Max xG / shot across all games for normalization.
  const maxXG = Math.max(0.3, ...games.flatMap(g => g.shots.map(s => s.xGoal ?? 0)));

  return (
    <div className="sqp">
      {title && <h3 className="sqp-title">{title}</h3>}
      <div className="sqp-wrapper">
        <svg width={stripWidth} height={totalHeight} className="sqp-svg" preserveAspectRatio="xMidYMid meet">
          {/* Period dividers at 1/3 and 2/3 */}
          <line x1={stripWidth / 3} x2={stripWidth / 3} y1={0} y2={totalHeight - 40}
            stroke="rgba(148,163,184,0.12)" strokeDasharray="2 3" />
          <line x1={(stripWidth / 3) * 2} x2={(stripWidth / 3) * 2} y1={0} y2={totalHeight - 40}
            stroke="rgba(148,163,184,0.12)" strokeDasharray="2 3" />

          {games.map((g, idx) => {
            const y = idx * (rowHeight + rowGap);
            // Background lane
            return (
              <g key={idx}>
                <rect
                  x={0} y={y} width={stripWidth} height={rowHeight}
                  fill="rgba(30, 41, 59, 0.35)" rx={3}
                />
                {g.shots.map((s, si) => {
                  const period = s.period ?? 1;
                  const tip = s.timeInPeriod ?? '00:00';
                  const ts = parseTimeInPeriod(tip, period, period > 3);
                  const x = (ts / (FULL_GAME_SECONDS + 300)) * stripWidth;
                  const xg = s.xGoal ?? 0;
                  const intensity = Math.min(1, xg / maxXG);
                  // Color: low xG → pale blue, high xG → hot orange
                  const color = xg >= 0.15
                    ? `rgba(239, 68, 68, ${0.55 + intensity * 0.35})`
                    : xg >= 0.08
                    ? `rgba(251, 146, 60, ${0.45 + intensity * 0.35})`
                    : `rgba(96, 165, 250, ${0.35 + intensity * 0.4})`;
                  const barH = 2 + intensity * (rowHeight - 4);
                  const isGoal = s.type === 'goal';
                  return (
                    <g key={si}>
                      <rect
                        x={x - 0.8} y={y + (rowHeight - barH) / 2}
                        width={1.6} height={barH}
                        fill={color}
                      >
                        <title>{`xG ${(xg * 100).toFixed(1)}%${isGoal ? ' — GOAL' : ''}`}</title>
                      </rect>
                      {isGoal && (
                        <circle
                          cx={x} cy={y + rowHeight / 2} r={2.2}
                          fill="#fde68a" stroke="#f59e0b" strokeWidth={0.6}
                        />
                      )}
                    </g>
                  );
                })}
                {/* Row summary to the right (outside strip) */}
              </g>
            );
          })}

          {/* Time axis labels */}
          <g transform={`translate(0, ${totalHeight - 24})`}>
            <text x={4} y={12} fontSize={10} fill="#94a3b8">P1</text>
            <text x={stripWidth / 3 + 4} y={12} fontSize={10} fill="#94a3b8">P2</text>
            <text x={(stripWidth / 3) * 2 + 4} y={12} fontSize={10} fill="#94a3b8">P3</text>
            <text x={stripWidth - 24} y={12} fontSize={10} fill="#94a3b8">OT</text>
          </g>
        </svg>
        <div className="sqp-sidebar" style={{ height: totalHeight - 40 }}>
          {games.map((g, idx) => (
            <div className="sqp-meta" key={idx} style={{ height: rowHeight, marginBottom: rowGap }}>
              <span className="sqp-game-idx">G{g.gameIndex + 1}</span>
              <span className="sqp-xg">{g.totalXG.toFixed(1)} xG</span>
              <span className="sqp-goals">{g.goalCount}g</span>
            </div>
          ))}
        </div>
      </div>
      <div className="sqp-caption">
        Each row = one game. Each tick = a shot, height scaled by xG, color by danger tier. Gold circles = goals.
        Games stacked oldest (top) → newest (bottom).
      </div>
    </div>
  );
}
