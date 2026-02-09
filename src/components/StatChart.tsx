import {
  LineChart,
  Line,
  BarChart,
  Bar,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import './StatChart.css';

export type ChartType = 'line' | 'bar' | 'radar';

interface StatChartProps {
  data: any[];
  type?: ChartType;
  dataKeys: {
    key: string;
    name: string;
    color?: string;
  }[];
  xAxisKey: string;
  title?: string;
  height?: number;
  yAxisLabel?: string;
}

function StatChart({
  data,
  type = 'line',
  dataKeys,
  xAxisKey,
  title,
  height = 300,
  yAxisLabel,
}: StatChartProps) {
  const colors = [
    '#003087', // NHL Blue
    '#C8102E', // NHL Red
    '#0055A4', // Secondary Blue
    '#10b981', // Green
    '#f59e0b', // Orange
    '#8b5cf6', // Purple
  ];

  const renderChart = () => {
    switch (type) {
      case 'bar':
        return (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey={xAxisKey}
              stroke="#6b7280"
              style={{ fontSize: '0.875rem' }}
            />
            <YAxis
              stroke="#6b7280"
              style={{ fontSize: '0.875rem' }}
              label={
                yAxisLabel
                  ? {
                      value: yAxisLabel,
                      angle: -90,
                      position: 'insideLeft',
                      style: { fontSize: '0.875rem', fill: '#6b7280' },
                    }
                  : undefined
              }
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '0.875rem',
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: '0.875rem', paddingTop: '1rem' }}
            />
            {dataKeys.map((item, index) => (
              <Bar
                key={item.key}
                dataKey={item.key}
                name={item.name}
                fill={item.color || colors[index % colors.length]}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        );

      case 'radar':
        return (
          <RadarChart data={data}>
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis
              dataKey={xAxisKey}
              stroke="#6b7280"
              style={{ fontSize: '0.875rem' }}
            />
            <PolarRadiusAxis stroke="#6b7280" style={{ fontSize: '0.75rem' }} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '0.875rem',
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: '0.875rem', paddingTop: '1rem' }}
            />
            {dataKeys.map((item, index) => (
              <Radar
                key={item.key}
                dataKey={item.key}
                name={item.name}
                stroke={item.color || colors[index % colors.length]}
                fill={item.color || colors[index % colors.length]}
                fillOpacity={0.3}
                strokeWidth={2}
              />
            ))}
          </RadarChart>
        );

      case 'line':
      default:
        return (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey={xAxisKey}
              stroke="#6b7280"
              style={{ fontSize: '0.875rem' }}
            />
            <YAxis
              stroke="#6b7280"
              style={{ fontSize: '0.875rem' }}
              label={
                yAxisLabel
                  ? {
                      value: yAxisLabel,
                      angle: -90,
                      position: 'insideLeft',
                      style: { fontSize: '0.875rem', fill: '#6b7280' },
                    }
                  : undefined
              }
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '0.875rem',
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: '0.875rem', paddingTop: '1rem' }}
            />
            {dataKeys.map((item, index) => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.name}
                stroke={item.color || colors[index % colors.length]}
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            ))}
          </LineChart>
        );
    }
  };

  return (
    <div className="stat-chart-container">
      {title && <h3 className="chart-title">{title}</h3>}
      <ResponsiveContainer width="100%" height={height}>
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
}

export default StatChart;
