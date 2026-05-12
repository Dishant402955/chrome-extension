import { AnalyticsCard } from './analytics-card';

const data = [
  ['Session Duration', '18m 24s'],
  ['Attention Score', '82%'],
  ['Interaction Density', 'High'],
  ['Focus Stability', '91%'],
];

export function MetricsGrid() {
  return (
    <div className="grid grid-cols-4 gap-4">
      {data.map(([title, value]) => (
        <AnalyticsCard
          key={title}
          title={title}
          value={value}
        />
      ))}
    </div>
  );
}