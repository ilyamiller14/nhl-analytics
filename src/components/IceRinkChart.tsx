import { useEffect, useRef } from 'react';
import './IceRinkChart.css';

interface DataPoint {
  x: number; // 0-100 (percentage of rink width)
  y: number; // 0-100 (percentage of rink length)
  value: number; // intensity/frequency
  type?: 'goal' | 'shot' | 'miss' | 'block' | 'pass' | 'hit';
}

interface IceRinkChartProps {
  data: DataPoint[];
  title: string;
  type: 'heatmap' | 'scatter' | 'zones';
  colorScheme?: 'hot' | 'cool' | 'impact';
}

function IceRinkChart({ data, title, type, colorScheme = 'hot' }: IceRinkChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw ice rink
    drawRink(ctx, width, height);

    // Draw data
    if (type === 'heatmap') {
      drawHeatmap(ctx, data, width, height, colorScheme);
    } else if (type === 'scatter') {
      drawScatter(ctx, data, width, height);
    } else if (type === 'zones') {
      drawZones(ctx, data, width, height);
    }
  }, [data, type, colorScheme]);

  return (
    <div className="ice-rink-chart">
      <h3 className="rink-chart-title">{title}</h3>
      <div className="rink-canvas-container">
        <canvas
          ref={canvasRef}
          width={600}
          height={400}
          className="rink-canvas"
        />
      </div>
      <div className="rink-legend">
        {type === 'scatter' && (
          <>
            <div className="legend-item">
              <span className="legend-dot goal"></span>
              <span>Goal</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot shot"></span>
              <span>Shot</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot miss"></span>
              <span>Miss</span>
            </div>
          </>
        )}
        {type === 'heatmap' && (
          <>
            <div className="legend-gradient">
              <span>Low</span>
              <div className="gradient-bar"></div>
              <span>High</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Draw ice rink outline
function drawRink(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const padding = 30;
  const rinkWidth = width - padding * 2;
  const rinkHeight = height - padding * 2;

  // Ice background
  ctx.fillStyle = '#f0f8ff';
  ctx.fillRect(padding, padding, rinkWidth, rinkHeight);

  // Rink border
  ctx.strokeStyle = '#003087';
  ctx.lineWidth = 3;
  ctx.strokeRect(padding, padding, rinkWidth, rinkHeight);

  // Center line
  ctx.strokeStyle = '#C8102E';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width / 2, padding);
  ctx.lineTo(width / 2, height - padding);
  ctx.stroke();

  // Blue lines
  ctx.strokeStyle = '#003087';
  ctx.lineWidth = 2;
  const blueLineOffset = rinkWidth * 0.25;

  ctx.beginPath();
  ctx.moveTo(padding + blueLineOffset, padding);
  ctx.lineTo(padding + blueLineOffset, height - padding);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(width - padding - blueLineOffset, padding);
  ctx.lineTo(width - padding - blueLineOffset, height - padding);
  ctx.stroke();

  // Goal creases
  // const creaseWidth = 40;
  const creaseHeight = 20;

  ctx.strokeStyle = '#C8102E';
  ctx.lineWidth = 2;

  // Left goal
  ctx.strokeRect(
    padding + 5,
    height / 2 - creaseHeight / 2,
    15,
    creaseHeight
  );

  // Right goal
  ctx.strokeRect(
    width - padding - 20,
    height / 2 - creaseHeight / 2,
    15,
    creaseHeight
  );

  // Face-off circles
  ctx.strokeStyle = '#C8102E';
  ctx.lineWidth = 1;

  const circleRadius = 15;
  const circleY = height / 2;
  const circleOffsetX = rinkWidth * 0.35;

  // Left offensive zone circles
  ctx.beginPath();
  ctx.arc(padding + circleOffsetX, circleY - 40, circleRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(padding + circleOffsetX, circleY + 40, circleRadius, 0, Math.PI * 2);
  ctx.stroke();

  // Right offensive zone circles
  ctx.beginPath();
  ctx.arc(width - padding - circleOffsetX, circleY - 40, circleRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(width - padding - circleOffsetX, circleY + 40, circleRadius, 0, Math.PI * 2);
  ctx.stroke();

  // Center face-off circle
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, circleRadius, 0, Math.PI * 2);
  ctx.stroke();
}

// Draw heatmap
function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  data: DataPoint[],
  width: number,
  height: number,
  colorScheme: string
) {
  const padding = 30;
  const rinkWidth = width - padding * 2;
  const rinkHeight = height - padding * 2;

  // Create gradient colors
  const colors = colorScheme === 'hot'
    ? ['rgba(255, 255, 0, 0.1)', 'rgba(255, 140, 0, 0.3)', 'rgba(255, 0, 0, 0.6)']
    : ['rgba(0, 255, 255, 0.1)', 'rgba(0, 140, 255, 0.3)', 'rgba(0, 0, 255, 0.6)'];

  data.forEach((point) => {
    const x = padding + (point.x / 100) * rinkWidth;
    const y = padding + (point.y / 100) * rinkHeight;
    const intensity = Math.min(point.value / 10, 1);

    const gradient = ctx.createRadialGradient(x, y, 0, x, y, 40);
    gradient.addColorStop(0, colors[2].replace(/,\s*[\d.]+\)$/, ', ' + (intensity * 0.8) + ')'));
    gradient.addColorStop(0.5, colors[1].replace(/,\s*[\d.]+\)$/, ', ' + (intensity * 0.4) + ')'));
    gradient.addColorStop(1, colors[0]);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, 40, 0, Math.PI * 2);
    ctx.fill();
  });
}

// Draw scatter plot
function drawScatter(
  ctx: CanvasRenderingContext2D,
  data: DataPoint[],
  width: number,
  height: number
) {
  const padding = 30;
  const rinkWidth = width - padding * 2;
  const rinkHeight = height - padding * 2;

  data.forEach((point) => {
    const x = padding + (point.x / 100) * rinkWidth;
    const y = padding + (point.y / 100) * rinkHeight;

    // Set color based on type
    let color = '#003087';
    let size = 6;

    if (point.type === 'goal') {
      color = '#10b981';
      size = 8;
    } else if (point.type === 'shot') {
      color = '#003087';
      size = 6;
    } else if (point.type === 'miss') {
      color = '#f59e0b';
      size = 5;
    } else if (point.type === 'block') {
      color = '#ef4444';
      size = 5;
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();

    // Add stroke for visibility
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

// Draw zone analysis
function drawZones(
  ctx: CanvasRenderingContext2D,
  data: DataPoint[],
  width: number,
  height: number
) {
  const padding = 30;
  const rinkWidth = width - padding * 2;
  const rinkHeight = height - padding * 2;

  // Define zones
  const zones = [
    { x: 0, y: 0, w: 33, h: 33, name: 'Left D' },
    { x: 33, y: 0, w: 34, h: 33, name: 'Center D' },
    { x: 67, y: 0, w: 33, h: 33, name: 'Right D' },
    { x: 0, y: 33, w: 33, h: 34, name: 'Left N' },
    { x: 33, y: 33, w: 34, h: 34, name: 'Neutral' },
    { x: 67, y: 33, w: 33, h: 34, name: 'Right N' },
    { x: 0, y: 67, w: 33, h: 33, name: 'Left O' },
    { x: 33, y: 67, w: 34, h: 33, name: 'Slot' },
    { x: 67, y: 67, w: 33, h: 33, name: 'Right O' },
  ];

  // Calculate zone totals
  const zoneTotals: { [key: string]: number } = {};
  zones.forEach((zone) => {
    zoneTotals[zone.name] = 0;
  });

  data.forEach((point) => {
    zones.forEach((zone) => {
      if (
        point.x >= zone.x &&
        point.x < zone.x + zone.w &&
        point.y >= zone.y &&
        point.y < zone.y + zone.h
      ) {
        zoneTotals[zone.name] += point.value;
      }
    });
  });

  // Find max for normalization
  const maxValue = Math.max(...Object.values(zoneTotals), 1);

  // Draw zones
  zones.forEach((zone) => {
    const zoneX = padding + (zone.x / 100) * rinkWidth;
    const zoneY = padding + (zone.y / 100) * rinkHeight;
    const zoneW = (zone.w / 100) * rinkWidth;
    const zoneH = (zone.h / 100) * rinkHeight;

    const intensity = zoneTotals[zone.name] / maxValue;
    const alpha = 0.2 + intensity * 0.6;

    ctx.fillStyle = `rgba(0, 48, 135, ${alpha})`;
    ctx.fillRect(zoneX, zoneY, zoneW, zoneH);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(zoneX, zoneY, zoneW, zoneH);

    // Draw value
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      zoneTotals[zone.name].toString(),
      zoneX + zoneW / 2,
      zoneY + zoneH / 2
    );
  });
}

export default IceRinkChart;
