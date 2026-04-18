/**
 * Season Shot Quality Pulse
 *
 * One horizontal strip per 10-game block, stacked oldest (top) →
 * newest (bottom). Each row is divided into 10 equal-width slots; each
 * slot holds one game's shots, positioned by fraction of game-time
 * elapsed. Tick height scales with xG, color with danger tier; goals
 * are gold circles.
 *
 * Shows *season-long* shot-quality rhythm — hot streaks, cold stretches,
 * and whether finishing lines up with chance creation.
 */

import { useMemo } from 'react';
import type { ShotAttempt } from '../../services/playByPlayService';
import './SeasonShotQualityPulse.css';

interface Props {
  shots: ShotAttempt[];
  title?: string;
  gamesPerRow?: number;
  rowHeight?: number;
}

interface GameGroup {
  gameId: number;
  gameDate?: string;
  gameIndex: number;
  shots: ShotAttempt[];
  goalCount: number;
  totalXG: number;
}

const PERIOD_SECONDS = 1200;
const FULL_GAME_SECONDS = 3 * PERIOD_SECONDS;

function parseTimeInPeriod(t: string, period: number, isOT: boolean): number {
  const [mm, ss] = (t || '00:00').split(':').map(v => parseInt(v, 10) || 0);
  const periodOffset = (Math.min(period, 3) - 1) * PERIOD_SECONDS;
  const intoPeriod = mm * 60 + ss;
  if (isOT) return FULL_GAME_SECONDS + Math.min(intoPeriod, 300);
  return Math.min(FULL_GAME_SECONDS, periodOffset + intoPeriod);
}

export default function SeasonShotQualityPulse({
  shots, title, gamesPerRow = 10, rowHeight = 24,
}: Props) {
  const games = useMemo<GameGroup[]>(() => {
    if (!shots || shots.length === 0) return [];
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
    return Array.from(byGame.values())
      .sort((a, b) => {
        const da = a.gameDate ? Date.parse(a.gameDate) : 0;
        const db = b.gameDate ? Date.parse(b.gameDate) : 0;
        return da - db || a.gameIndex - b.gameIndex;
      })
      .map((g, i) => ({ ...g, gameIndex: i }));
  }, [shots]);

  if (games.length === 0) {
    return (
      <div className="sqp">
        {title && <h3 className="sqp-title">{title}</h3>}
        <div className="sqp-empty">No shot timing data yet.</div>
      </div>
    );
  }

  const rowCount = Math.ceil(games.length / gamesPerRow);
  const rows: GameGroup[][] = [];
  for (let r = 0; r < rowCount; r++) {
    rows.push(games.slice(r * gamesPerRow, (r + 1) * gamesPerRow));
  }

  const rowGap = 4;
  const axisHeight = 22;
  const stripWidth = 920;
  const slotWidth = stripWidth / gamesPerRow;
  const totalHeight = rowCount * (rowHeight + rowGap) + axisHeight;

  // Normalize tick height against the shot-level xG max across the season so
  // a monster chance reads big everywhere — not just in its own row.
  const maxXG = Math.max(0.3, ...games.flatMap(g => g.shots.map(s => s.xGoal ?? 0)));

  // Game-within-season totals for sidebar annotations.
  const rowTotals = rows.map(rowGames => {
    const rowShots = rowGames.reduce((n, g) => n + g.shots.length, 0);
    const rowXG = rowGames.reduce((n, g) => n + g.totalXG, 0);
    const rowGoals = rowGames.reduce((n, g) => n + g.goalCount, 0);
    const first = rowGames[0]?.gameIndex ?? 0;
    const last = rowGames[rowGames.length - 1]?.gameIndex ?? 0;
    return { rowShots, rowXG, rowGoals, first, last };
  });

  return (
    <div className="sqp">
      {title && <h3 className="sqp-title">{title}</h3>}
      <div className="sqp-wrapper">
        <svg
          viewBox={`0 0 ${stripWidth} ${totalHeight}`}
          width="100%"
          height="auto"
          preserveAspectRatio="xMidYMid meet"
          className="sqp-svg"
          role="img"
        >
          {rows.map((rowGames, rowIdx) => {
            const y = rowIdx * (rowHeight + rowGap);
            return (
              <g key={`row-${rowIdx}`}>
                {/* Background lane for the filled portion of the row only */}
                <rect
                  x={0}
                  y={y}
                  width={rowGames.length * slotWidth}
                  height={rowHeight}
                  fill="rgba(30, 41, 59, 0.45)"
                  rx={3}
                />
                {rowGames.map((g, slotIdx) => {
                  const slotX = slotIdx * slotWidth;
                  return (
                    <g key={g.gameId}>
                      {/* Slot divider (skip the leftmost edge) */}
                      {slotIdx > 0 && (
                        <line
                          x1={slotX}
                          x2={slotX}
                          y1={y + 2}
                          y2={y + rowHeight - 2}
                          stroke="rgba(148, 163, 184, 0.18)"
                          strokeWidth={0.75}
                        />
                      )}
                      {g.shots.map((s, si) => {
                        const period = s.period ?? 1;
                        const tip = s.timeInPeriod ?? '00:00';
                        const ts = parseTimeInPeriod(tip, period, period > 3);
                        const frac = ts / (FULL_GAME_SECONDS + 300);
                        const x = slotX + frac * slotWidth;
                        const xg = s.xGoal ?? 0;
                        const intensity = Math.min(1, xg / maxXG);
                        const color =
                          xg >= 0.15
                            ? `rgba(239, 68, 68, ${0.55 + intensity * 0.35})`
                            : xg >= 0.08
                            ? `rgba(251, 146, 60, ${0.45 + intensity * 0.35})`
                            : `rgba(96, 165, 250, ${0.35 + intensity * 0.4})`;
                        const barH = 2 + intensity * (rowHeight - 4);
                        const isGoal = s.type === 'goal';
                        return (
                          <g key={si}>
                            <rect
                              x={x - 0.8}
                              y={y + (rowHeight - barH) / 2}
                              width={1.6}
                              height={barH}
                              fill={color}
                            >
                              <title>
                                {`G${g.gameIndex + 1}${g.gameDate ? ` (${g.gameDate})` : ''} · xG ${(xg * 100).toFixed(1)}%${isGoal ? ' — GOAL' : ''}`}
                              </title>
                            </rect>
                            {isGoal && (
                              <circle
                                cx={x}
                                cy={y + rowHeight / 2}
                                r={2.4}
                                fill="#fde68a"
                                stroke="#f59e0b"
                                strokeWidth={0.7}
                              />
                            )}
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* Bottom axis: slot positions 1..N */}
          <g transform={`translate(0, ${rowCount * (rowHeight + rowGap) + 2})`}>
            {Array.from({ length: gamesPerRow }, (_, i) => (
              <text
                key={`axis-${i}`}
                x={i * slotWidth + slotWidth / 2}
                y={14}
                textAnchor="middle"
                fontSize={10}
                fill="#94a3b8"
              >
                {i + 1}
              </text>
            ))}
          </g>
        </svg>
        <div className="sqp-sidebar">
          {rowTotals.map((t, i) => (
            <div
              className="sqp-meta"
              key={i}
              style={{ height: rowHeight, marginBottom: rowGap }}
            >
              <span className="sqp-game-idx">
                G{t.first + 1}–{t.last + 1}
              </span>
              <span className="sqp-xg">{t.rowXG.toFixed(1)} xG</span>
              <span className="sqp-goals">{t.rowGoals}g</span>
            </div>
          ))}
        </div>
      </div>
      <div className="sqp-caption">
        Each row = {gamesPerRow} games, oldest (top) → newest (bottom). Each tick = a shot, height scaled by xG, color by danger tier. Gold circles = goals. Slot dividers separate consecutive games within the 10-game block.
      </div>
    </div>
  );
}
