/**
 * Team Contracts Table
 *
 * Sortable contracts table showing:
 * - Player Name | Pos | Cap Hit | Surplus | Years Remaining | Expiry | Clauses
 * - Sortable by clicking column headers (toggle asc/desc)
 * - Default sort: cap hit descending
 * - Surplus color-coded (green positive, red negative, gray if no data)
 * - Clause badges (NMC/NTC/M-NTC)
 * - Player name links to /player/{playerId}
 *
 * Used in: ManagementDashboard (Contracts tab)
 */

import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { PlayerContractEntry, PlayerSurplus } from '../types/contract';

interface TeamContractsTableProps {
  players: PlayerContractEntry[];
  surplusData?: Map<string, PlayerSurplus>;
}

type SortKey = 'name' | 'position' | 'capHit' | 'surplus' | 'years' | 'expiry' | 'clause';
type SortDirection = 'asc' | 'desc';

function formatCapHit(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`;
  }
  return `$${amount.toLocaleString()}`;
}

function formatSurplus(amount: number): string {
  const prefix = amount >= 0 ? '+' : '';
  if (Math.abs(amount) >= 1_000_000) {
    return `${prefix}$${(amount / 1_000_000).toFixed(1)}M`;
  }
  return `${prefix}$${amount.toLocaleString()}`;
}

function getYearsRemaining(player: PlayerContractEntry): number {
  return player.years.length;
}

function getExpiryYear(player: PlayerContractEntry): string {
  return player.expiryStatus || 'N/A';
}

function getClauseBadges(clause: string | null): string[] {
  if (!clause) return [];
  // Handle compound clauses like "M-NMC, NTC"
  return clause.split(',').map(c => c.trim()).filter(Boolean);
}

export default function TeamContractsTable({ players, surplusData }: TeamContractsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('capHit');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'position' ? 'asc' : 'desc');
    }
  };

  const sortedPlayers = useMemo(() => {
    const list = [...players];
    const dir = sortDir === 'asc' ? 1 : -1;

    list.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'position':
          return dir * a.position.localeCompare(b.position);
        case 'capHit':
          return dir * (a.capHit - b.capHit);
        case 'surplus': {
          const sA = surplusData?.get(a.name)?.surplus ?? -Infinity;
          const sB = surplusData?.get(b.name)?.surplus ?? -Infinity;
          return dir * (sA - sB);
        }
        case 'years':
          return dir * (getYearsRemaining(a) - getYearsRemaining(b));
        case 'expiry':
          return dir * a.expiryStatus.localeCompare(b.expiryStatus);
        case 'clause': {
          const cA = a.clause || '';
          const cB = b.clause || '';
          return dir * cA.localeCompare(cB);
        }
        default:
          return 0;
      }
    });

    return list;
  }, [players, sortKey, sortDir, surplusData]);

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  return (
    <div className="contracts-table-wrapper">
      <table className="contracts-table">
        <thead>
          <tr>
            <th onClick={() => handleSort('name')} className="contracts-th sortable">
              Player{sortIndicator('name')}
            </th>
            <th onClick={() => handleSort('position')} className="contracts-th sortable">
              Pos{sortIndicator('position')}
            </th>
            <th onClick={() => handleSort('capHit')} className="contracts-th sortable numeric">
              Cap Hit{sortIndicator('capHit')}
            </th>
            <th onClick={() => handleSort('surplus')} className="contracts-th sortable numeric">
              Surplus{sortIndicator('surplus')}
            </th>
            <th onClick={() => handleSort('years')} className="contracts-th sortable numeric">
              Years{sortIndicator('years')}
            </th>
            <th onClick={() => handleSort('expiry')} className="contracts-th sortable">
              Expiry{sortIndicator('expiry')}
            </th>
            <th onClick={() => handleSort('clause')} className="contracts-th sortable">
              Clauses{sortIndicator('clause')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedPlayers.map((player, idx) => {
            const surplus = surplusData?.get(player.name);
            const badges = getClauseBadges(player.clause);
            const yearsRemaining = getYearsRemaining(player);

            return (
              <tr key={player.playerId ?? idx} className="contracts-row">
                <td className="contracts-td player-name-cell">
                  {player.playerId ? (
                    <Link to={`/player/${player.playerId}`} className="contracts-player-link">
                      {player.name}
                    </Link>
                  ) : (
                    <span className="contracts-player-name">{player.name}</span>
                  )}
                  {player.status !== 'active' && (
                    <span className={`contracts-status-badge ${player.status}`}>
                      {player.status.toUpperCase()}
                    </span>
                  )}
                </td>
                <td className="contracts-td">{player.position}</td>
                <td className="contracts-td numeric">{formatCapHit(player.capHit)}</td>
                <td className="contracts-td numeric">
                  {surplus ? (
                    <span className={`surplus-value ${surplus.surplus >= 0 ? 'positive' : 'negative'}`}>
                      {formatSurplus(surplus.surplus)}
                    </span>
                  ) : (
                    <span className="surplus-value none">--</span>
                  )}
                </td>
                <td className="contracts-td numeric">{yearsRemaining}</td>
                <td className="contracts-td">{getExpiryYear(player)}</td>
                <td className="contracts-td clauses-cell">
                  {badges.map((badge, i) => (
                    <span key={i} className="clause-badge">{badge}</span>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
