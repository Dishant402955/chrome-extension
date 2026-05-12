const rows = Array.from({ length: 12 }).map((_, i) => ({
  action: `Interaction ${i + 1}`,
  target: `Container-${i + 1}`,
  duration: `${(i + 2) * 120}ms`,
}));

export function ActivityTable() {
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.action}
          className="grid grid-cols-3 bg-zinc-800 rounded-xl px-4 py-4 hover:bg-zinc-700 transition"
        >
          <div>{row.action}</div>
          <div>{row.target}</div>
          <div>{row.duration}</div>
        </div>
      ))}
    </div>
  );
}