/**
 * Linemate With/Without Impact
 *
 * For a selected player, shows each top linemate's usage (TOI together)
 * and on-ice shot differential per 60 minutes while the pair is on the
 * ice together. Elevated partners show a positive shot diff; anchors
 * show a negative one. A small goals-per-60 badge adds finishing
 * context. Pairs sorted by TOI together (most-used first).
 *
 * Uses PlayerPairChemistry — already produced by chemistryAnalytics.ts.
 */

import { useMemo } from 'react';
import type { PlayerPairChemistry } from '../../services/chemistryAnalytics';
import './LinemateWithWithout.css';

interface Props {
  focusPlayerId: number;
  focusPlayerName?: string;
  pairs: PlayerPairChemistry[];
  title?: string;
  minTogetherSeconds?: number;
  maxRows?: number;
}

interface Row {
  partnerId: number;
  partnerName: string;
  togetherSeconds: number;
  shotsForPer60: number;
  shotsAgainstPer60: number;
  shotDiffPer60: number;
  goalsPer60: number;
  goalsAgainstPer60: number;
  highDangerPer60: number;
}

export default function LinemateWithWithout({
  focusPlayerId,
  focusPlayerName,
  pairs,
  title,
  minTogetherSeconds = 60,
  maxRows = 8,
}: Props) {
  const rows: Row[] = useMemo(() => {
    return (pairs || [])
      .filter(p => p.player1Id === focusPlayerId || p.player2Id === focusPlayerId)
      .filter(p => p.estimatedToiTogether >= minTogetherSeconds)
      .map(p => {
        const isP1 = p.player1Id === focusPlayerId;
        const partnerId = isP1 ? p.player2Id : p.player1Id;
        const partnerName = (isP1 ? p.player2Name : p.player1Name) || `#${partnerId}`;
        return {
          partnerId,
          partnerName,
          togetherSeconds: p.estimatedToiTogether,
          shotsForPer60: p.shotsPer60Together,
          shotsAgainstPer60: p.shotsAgainstPer60Together,
          shotDiffPer60: p.shotDiffPer60Together,
          goalsPer60: p.goalsPer60Together,
          goalsAgainstPer60: p.goalsAgainstPer60Together,
          highDangerPer60: p.highDangerPer60Together,
        };
      })
      .sort((a, b) => b.togetherSeconds - a.togetherSeconds)
      .slice(0, maxRows);
  }, [pairs, focusPlayerId, minTogetherSeconds, maxRows]);

  if (rows.length === 0) {
    return (
      <div className="lww">
        {title && <h3 className="lww-title">{title}</h3>}
        <div className="lww-empty">
          No linemates with enough overlapping ice time for {focusPlayerName || 'this player'}.
        </div>
      </div>
    );
  }

  // Scale the diverging bar against the largest |shot-diff/60| in view so
  // small-sample outliers don't compress the interesting rows to nothing.
  const maxAbsDiff = Math.max(5, ...rows.map(r => Math.abs(r.shotDiffPer60)));

  return (
    <div className="lww">
      {title && <h3 className="lww-title">{title}</h3>}
      <div className="lww-rows">
        <div className="lww-header">
          <span>Linemate</span>
          <span className="lww-num-h">TOI together</span>
          <span className="lww-diff-h">Shot differential /60</span>
          <span className="lww-num-h">G/60</span>
        </div>
        {rows.map(r => {
          const diffFrac = Math.min(1, Math.abs(r.shotDiffPer60) / maxAbsDiff);
          const positive = r.shotDiffPer60 >= 0;
          const goalClass =
            r.goalsPer60 >= 3 ? 'elite' :
            r.goalsPer60 >= 2 ? 'good' :
            r.goalsPer60 >= 1 ? 'ok' : 'cold';
          return (
            <div className="lww-row" key={r.partnerId}>
              <span className="lww-name" title={r.partnerName}>{r.partnerName}</span>
              <span className="lww-num">{(r.togetherSeconds / 60).toFixed(1)} min</span>
              <span className="lww-diff">
                <span className="lww-diff-track">
                  <span className="lww-diff-axis" />
                  <span
                    className={`lww-diff-fill ${positive ? 'pos' : 'neg'}`}
                    style={{
                      width: `${diffFrac * 50}%`,
                      left: positive ? '50%' : `${50 - diffFrac * 50}%`,
                    }}
                  />
                </span>
                <span
                  className={`lww-diff-value ${positive ? 'pos' : 'neg'}`}
                  title={`+${r.shotsForPer60.toFixed(1)} for / -${r.shotsAgainstPer60.toFixed(1)} against per 60`}
                >
                  {positive ? '+' : ''}{r.shotDiffPer60.toFixed(1)}
                </span>
              </span>
              <span className={`lww-goal-badge ${goalClass}`} title={`${r.goalsAgainstPer60.toFixed(1)} against per 60`}>
                {r.goalsPer60.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="lww-caption">
        Bar = (shots-for − shots-against) per 60 minutes while {focusPlayerName || 'the focus player'} and that linemate are on the ice together.
        Green bar right = pair generates more shots than it allows; red left = net negative. G/60 = goals for while together. Sorted by shared ice time.
      </div>
    </div>
  );
}
