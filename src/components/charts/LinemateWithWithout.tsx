/**
 * Linemate With/Without Impact
 *
 * For a selected player, shows shots-for/60 when paired with each of
 * their top linemates vs when that linemate is off the ice (and only
 * the focus player is on). Identifies "glue guys" whose partners
 * elevate vs "line-riders" who fade apart from a specific teammate.
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
}

interface Row {
  partnerId: number;
  partnerName: string;
  togetherShotsPer60: number;
  togetherSeconds: number;
  apartShots: number;
  apartPer60Unknown: boolean; // we don't have partner-absent TOI, so per60 of "apart" is N/A; we show raw count
}

export default function LinemateWithWithout({
  focusPlayerId,
  focusPlayerName,
  pairs,
  title,
  minTogetherSeconds = 60,
}: Props) {
  const rows: Row[] = useMemo(() => {
    return (pairs || [])
      .filter(p => p.player1Id === focusPlayerId || p.player2Id === focusPlayerId)
      .filter(p => p.estimatedToiTogether >= minTogetherSeconds)
      .map(p => {
        const isP1 = p.player1Id === focusPlayerId;
        const partnerId = isP1 ? p.player2Id : p.player1Id;
        const partnerName = (isP1 ? p.player2Name : p.player1Name) || `#${partnerId}`;
        const apartShots = isP1 ? p.apart.player1Only.shots : p.apart.player2Only.shots;
        return {
          partnerId,
          partnerName,
          togetherShotsPer60: p.shotsPer60Together,
          togetherSeconds: p.estimatedToiTogether,
          apartShots,
          apartPer60Unknown: true,
        };
      })
      .sort((a, b) => b.togetherSeconds - a.togetherSeconds)
      .slice(0, 8);
  }, [pairs, focusPlayerId, minTogetherSeconds]);

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

  const maxShots60 = Math.max(...rows.map(r => r.togetherShotsPer60), 1);

  return (
    <div className="lww">
      {title && <h3 className="lww-title">{title}</h3>}
      <div className="lww-rows">
        <div className="lww-header">
          <span>Linemate</span>
          <span>Together TOI</span>
          <span>Shots/60 together</span>
          <span>Apart shots (focus only)</span>
        </div>
        {rows.map(r => (
          <div className="lww-row" key={r.partnerId}>
            <span className="lww-name" title={r.partnerName}>{r.partnerName}</span>
            <span className="lww-num">{(r.togetherSeconds / 60).toFixed(1)} min</span>
            <span className="lww-bar">
              <span className="lww-bar-track">
                <span className="lww-bar-fill"
                  style={{ width: `${(r.togetherShotsPer60 / maxShots60) * 100}%` }} />
              </span>
              <span className="lww-bar-value">{r.togetherShotsPer60.toFixed(1)}</span>
            </span>
            <span className="lww-num">{r.apartShots}</span>
          </div>
        ))}
      </div>
      <div className="lww-caption">
        &quot;Apart&quot; counts shots for while {focusPlayerName || 'focus player'} was on the ice
        without that linemate. Larger gap → larger chemistry dependence.
      </div>
    </div>
  );
}
