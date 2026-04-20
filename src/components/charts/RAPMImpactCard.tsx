/**
 * RAPM Impact Card — per-player 5v5 isolated offense + defense
 * coefficients from the ridge-regressed shift-level model. Shows the
 * player's effect on xGF/60 and xGA/60 after controlling for
 * line-mates and opponents, along with their rank among non-low-sample
 * skaters in the artifact.
 *
 * Three empty states:
 *   1. rapm === null          — artifact not loaded / not yet published.
 *   2. entry missing          — skater below the sample threshold.
 *   3. goalie                 — skater-only metric in v1.
 *
 * No mock data, no hardcoded league averages, no percentile cutoffs:
 * rank is derived directly from the artifact's players map.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { RAPMArtifact, RAPMPlayerEntry } from '../../services/rapmService';
import { getRAPMForPlayer } from '../../services/rapmService';
import './RAPMImpactCard.css';

interface RAPMImpactCardProps {
  playerId: number;
  playerName: string;
  position?: string;
  rapm: RAPMArtifact | null;
}

function fmt(n: number, d = 2): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(d)}`;
}

function toneClass(value: number): 'pos' | 'neg' | '' {
  if (value > 0) return 'pos';
  if (value < 0) return 'neg';
  return '';
}

/**
 * Produce the rank (1-based, lower = better) for a player's metric
 * among all non-low-sample skaters in the artifact. Higher metric
 * value = better rank (#1). Ties share the lower rank.
 */
function rankIn(
  players: Record<string, RAPMPlayerEntry>,
  playerId: number,
  metric: (e: RAPMPlayerEntry) => number,
): { rank: number; of: number } | null {
  const idKey = String(playerId);
  const eligible = Object.entries(players).filter(([, e]) => !e.lowSample);
  if (eligible.length === 0) return null;

  const ownEntry = players[idKey];
  if (!ownEntry || ownEntry.lowSample) return null;

  const ownValue = metric(ownEntry);
  let rank = 1;
  for (const [, e] of eligible) {
    if (metric(e) > ownValue) rank += 1;
  }
  return { rank, of: eligible.length };
}

export default function RAPMImpactCard({
  playerId,
  playerName: _playerName,
  position,
  rapm,
}: RAPMImpactCardProps) {
  const entry = getRAPMForPlayer(rapm, playerId);

  // Rank computations — memoized so the 500+-entry sorts only run when
  // the artifact identity changes. Sorting is O(n) here (we only need
  // to count players better than the subject, not a full sort).
  const offenseRank = useMemo(() => {
    if (!rapm) return null;
    return rankIn(rapm.players, playerId, (e) => e.offense);
  }, [rapm, playerId]);

  const defenseRank = useMemo(() => {
    if (!rapm) return null;
    return rankIn(rapm.players, playerId, (e) => e.defense);
  }, [rapm, playerId]);

  const twoWayRank = useMemo(() => {
    if (!rapm) return null;
    return rankIn(rapm.players, playerId, (e) => e.offense + e.defense);
  }, [rapm, playerId]);

  // 1) Goalie guard first — RAPM is skater-only in v1.
  if (position === 'G') {
    return (
      <div className="rapm-card">
        <div className="rapm-card-head">
          <h3 className="rapm-card-title">RAPM Impact (5v5)</h3>
          <p className="rapm-card-subtitle">
            Isolated individual xG/60 above RAPM baseline — controls for line-mates and opponents.
          </p>
        </div>
        <div className="rapm-card-empty">
          RAPM is skater-only in v1. Goalie variant scoped for a future build.
        </div>
      </div>
    );
  }

  // 2) Artifact not loaded.
  if (!rapm) {
    return (
      <div className="rapm-card">
        <div className="rapm-card-head">
          <h3 className="rapm-card-title">RAPM Impact (5v5)</h3>
          <p className="rapm-card-subtitle">
            Isolated individual xG/60 above RAPM baseline — controls for line-mates and opponents.
          </p>
        </div>
        <div className="rapm-card-empty">
          RAPM coefficients pending — rebuilt nightly. Shows shift-level isolated impact once the artifact lands.
        </div>
      </div>
    );
  }

  // 3) Artifact present but no entry for this skater.
  if (!entry) {
    return (
      <div className="rapm-card">
        <div className="rapm-card-head">
          <h3 className="rapm-card-title">RAPM Impact (5v5)</h3>
          <p className="rapm-card-subtitle">
            Isolated individual xG/60 above RAPM baseline — controls for line-mates and opponents.
          </p>
        </div>
        <div className="rapm-card-empty">
          Not enough 5v5 shift data for this skater — typically 150+ minutes needed for a stable coefficient.
        </div>
      </div>
    );
  }

  const twoWay = entry.offense + entry.defense;

  return (
    <div className="rapm-card">
      <div className="rapm-card-head">
        <h3 className="rapm-card-title">RAPM Impact (5v5)</h3>
        <p className="rapm-card-subtitle">
          Isolated individual xG/60 above RAPM baseline — controls for line-mates and opponents.
        </p>
      </div>

      <div className="rapm-card-metrics">
        <div className="rapm-metric">
          <span className="rapm-metric-label">Offense</span>
          <span>
            <span className={`rapm-metric-value ${toneClass(entry.offense)}`}>
              {fmt(entry.offense)}
            </span>
            <span className="rapm-metric-se">±{entry.offenseSE.toFixed(2)}</span>
          </span>
          <span className="rapm-metric-unit">xGF/60 above baseline</span>
          {offenseRank && (
            <span className="rapm-metric-rank">
              #{offenseRank.rank} of {offenseRank.of}
            </span>
          )}
        </div>

        <div className="rapm-metric">
          <span className="rapm-metric-label">Defense</span>
          <span>
            <span className={`rapm-metric-value ${toneClass(entry.defense)}`}>
              {fmt(entry.defense)}
            </span>
            <span className="rapm-metric-se">±{entry.defenseSE.toFixed(2)}</span>
          </span>
          <span className="rapm-metric-unit">xGA/60 suppressed</span>
          {defenseRank && (
            <span className="rapm-metric-rank">
              #{defenseRank.rank} of {defenseRank.of}
            </span>
          )}
        </div>
      </div>

      {twoWayRank && (
        <div className="rapm-twoway">
          <span className="rapm-twoway-label">Two-way</span>
          <span className={`rapm-twoway-value ${toneClass(twoWay)}`}>
            {fmt(twoWay)}
          </span>
          <span className="rapm-twoway-rank">
            #{twoWayRank.rank} two-way
          </span>
        </div>
      )}

      <div className="rapm-card-footer">
        <span>
          {entry.minutes.toFixed(0)} min · {entry.shifts.toLocaleString()} shifts · GP={entry.gp}
        </span>
        {entry.lowSample && (
          <span className="rapm-low-sample">
            ⚠ low sample — SE wide, treat as directional
          </span>
        )}
        <Link to="/glossary">methodology</Link>
      </div>
    </div>
  );
}
