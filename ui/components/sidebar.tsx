const items = [
  "Dashboard",
  "Sessions",
  "Analytics",
  "Heatmaps",
  "Editor",
  "Exports",
  "Settings",
];

export function Sidebar() {
  return (
    <aside className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col">
      <div className="h-16 flex items-center px-6 border-b border-zinc-800 text-xl font-bold">
        SynthLab
      </div>

      <div className="p-3 flex flex-col gap-2">
        {items.map((item) => (
          <button
            key={item}
            className="h-12 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition-all text-left px-4"
          >
            {item}
          </button>
        ))}
      </div>

      <div className="mt-auto p-4">
        <div className="rounded-2xl bg-zinc-800 p-4">
          <div className="text-sm text-zinc-400">
            Active Session
          </div>

          <div className="mt-2 text-lg font-semibold">
            UI Behavior Analysis
          </div>
        </div>
      </div>
    </aside>
  );
}