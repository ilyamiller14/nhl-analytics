/**
 * Pass Network Diagram Component
 *
 * Visualizes passing connections between players
 * Node size = pass volume, line thickness = connection strength
 * Color = pass completion rate
 */

import { useMemo, useState } from 'react';
import './PassNetworkDiagram.css';

export interface PassConnection {
  from: string; // Player name
  to: string; // Player name
  passes: number; // Number of passes
  completions: number; // Successful passes
}

interface PassNetworkDiagramProps {
  connections: PassConnection[];
  width?: number;
  height?: number;
  title?: string;
  minPasses?: number; // Filter out weak connections
}

interface PlayerNode {
  name: string;
  x: number;
  y: number;
  totalPasses: number;
  radius: number;
}

export default function PassNetworkDiagram({
  connections,
  width = 600,
  height = 600,
  title,
  minPasses = 3,
}: PassNetworkDiagramProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredConnection, setHoveredConnection] = useState<PassConnection | null>(null);

  // Filter connections and calculate node positions
  const { nodes, filteredConnections } = useMemo(() => {
    // Filter weak connections
    const filtered = connections.filter(c => c.passes >= minPasses);

    // Get unique players
    const playerMap = new Map<string, number>();
    filtered.forEach(conn => {
      playerMap.set(conn.from, (playerMap.get(conn.from) || 0) + conn.passes);
      playerMap.set(conn.to, (playerMap.get(conn.to) || 0) + conn.completions);
    });

    const players = Array.from(playerMap.keys());
    const maxPasses = Math.max(...playerMap.values());

    // Position nodes in a circle
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.35;

    const nodeList: PlayerNode[] = players.map((player, i) => {
      const angle = (i / players.length) * 2 * Math.PI - Math.PI / 2;
      const passVolume = playerMap.get(player) || 0;
      const nodeRadius = 15 + (passVolume / maxPasses) * 25;

      return {
        name: player,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        totalPasses: passVolume,
        radius: nodeRadius,
      };
    });

    return {
      nodes: nodeList,
      filteredConnections: filtered,
    };
  }, [connections, minPasses, width, height]);

  // Get node by player name
  const getNode = (playerName: string): PlayerNode | undefined => {
    return nodes.find(n => n.name === playerName);
  };

  // Calculate connection color based on completion rate
  const getConnectionColor = (completions: number, total: number): string => {
    const rate = completions / total;
    if (rate >= 0.8) return '#00aa00'; // Excellent
    if (rate >= 0.6) return '#88cc00'; // Good
    if (rate >= 0.4) return '#ffaa00'; // Average
    return '#ff4444'; // Poor
  };

  // Calculate stats
  const totalPasses = filteredConnections.reduce((sum, c) => sum + c.passes, 0);
  const totalCompletions = filteredConnections.reduce((sum, c) => sum + c.completions, 0);
  const completionRate = totalPasses > 0 ? (totalCompletions / totalPasses) * 100 : 0;

  // Top connections
  const topConnections = [...filteredConnections]
    .sort((a, b) => b.passes - a.passes)
    .slice(0, 3);

  return (
    <div className="pass-network-container">
      {title && <h3 className="pass-network-title">{title}</h3>}

      {/* Stats summary */}
      <div className="pass-stats">
        <div className="stat-item">
          <span className="stat-label">Total Passes:</span>
          <span className="stat-value">{totalPasses}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Completion Rate:</span>
          <span className="stat-value">{completionRate.toFixed(1)}%</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Active Connections:</span>
          <span className="stat-value">{filteredConnections.length}</span>
        </div>
      </div>

      {/* Network diagram */}
      <div className="pass-network-wrapper">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="pass-network-svg"
          style={{ width: '100%', maxWidth: width, height: 'auto' }}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Background */}
          <rect width={width} height={height} fill="#fafafa" />

          {/* Connections (edges) */}
          <g className="connections-layer">
            {filteredConnections.map((conn, i) => {
              const fromNode = getNode(conn.from);
              const toNode = getNode(conn.to);
              if (!fromNode || !toNode) return null;

              const isHovered = hoveredConnection === conn ||
                              hoveredNode === conn.from ||
                              hoveredNode === conn.to;
              const strokeWidth = 1 + (conn.passes / Math.max(...filteredConnections.map(c => c.passes))) * 8;
              // completionRate available for future use (e.g., line styling)
              // const completionRate = conn.completions / conn.passes;

              return (
                <g key={i}>
                  {/* Line */}
                  <line
                    x1={fromNode.x}
                    y1={fromNode.y}
                    x2={toNode.x}
                    y2={toNode.y}
                    stroke={getConnectionColor(conn.completions, conn.passes)}
                    strokeWidth={strokeWidth}
                    opacity={isHovered ? 0.9 : 0.3}
                    className="connection-line"
                    onMouseEnter={() => setHoveredConnection(conn)}
                    onMouseLeave={() => setHoveredConnection(null)}
                    style={{ cursor: 'pointer' }}
                  />

                  {/* Arrow head */}
                  <polygon
                    points={`${toNode.x},${toNode.y} ${toNode.x - 5},${toNode.y - 5} ${toNode.x - 5},${toNode.y + 5}`}
                    fill={getConnectionColor(conn.completions, conn.passes)}
                    opacity={isHovered ? 0.9 : 0.3}
                    transform={`rotate(${Math.atan2(toNode.y - fromNode.y, toNode.x - fromNode.x) * 180 / Math.PI} ${toNode.x} ${toNode.y})`}
                  />
                </g>
              );
            })}
          </g>

          {/* Nodes (players) */}
          <g className="nodes-layer">
            {nodes.map((node, i) => {
              const isHovered = hoveredNode === node.name;

              return (
                <g key={i}>
                  {/* Node circle */}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.radius}
                    fill="#007bff"
                    opacity={isHovered ? 1 : 0.8}
                    stroke="#fff"
                    strokeWidth={2}
                    className="player-node"
                    onMouseEnter={() => setHoveredNode(node.name)}
                    onMouseLeave={() => setHoveredNode(null)}
                    style={{ cursor: 'pointer' }}
                  />

                  {/* Player name */}
                  <text
                    x={node.x}
                    y={node.y - node.radius - 8}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="600"
                    fill="#333"
                    className="player-label"
                  >
                    {node.name}
                  </text>

                  {/* Pass count */}
                  <text
                    x={node.x}
                    y={node.y + 4}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="bold"
                    fill="#fff"
                  >
                    {node.totalPasses}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Tooltip for connection */}
        {hoveredConnection && (
          <div className="pass-tooltip">
            <div className="tooltip-row">
              <strong>{hoveredConnection.from} → {hoveredConnection.to}</strong>
            </div>
            <div className="tooltip-row">
              Passes: {hoveredConnection.passes}
            </div>
            <div className="tooltip-row">
              Completed: {hoveredConnection.completions} ({((hoveredConnection.completions / hoveredConnection.passes) * 100).toFixed(1)}%)
            </div>
          </div>
        )}
      </div>

      {/* Top connections list */}
      {topConnections.length > 0 && (
        <div className="top-connections">
          <h4>Strongest Connections</h4>
          <div className="connection-list">
            {topConnections.map((conn, i) => (
              <div key={i} className="connection-item">
                <span className="connection-rank">#{i + 1}</span>
                <span className="connection-players">
                  {conn.from} → {conn.to}
                </span>
                <span className="connection-stat">
                  {conn.passes} passes ({((conn.completions / conn.passes) * 100).toFixed(0)}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="pass-legend">
        <div className="legend-section">
          <strong>Node Size:</strong> Pass volume
        </div>
        <div className="legend-section">
          <strong>Line Thickness:</strong> Connection strength
        </div>
        <div className="legend-section">
          <strong>Color:</strong>
          <div className="color-indicators">
            <span><div className="color-box excellent"></div>≥80%</span>
            <span><div className="color-box good"></div>60-80%</span>
            <span><div className="color-box average"></div>40-60%</span>
            <span><div className="color-box poor"></div>&lt;40%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
