const items = [
  'Dashboard',
  'Analytics',
  'Sessions',
  'Automation',
  'Reports',
  'Exports',
  'Settings',
];

export function Sidebar() {
  return (
    <aside className="w-64 border-r border-zinc-800 bg-zinc-900 flex flex-col">
      <div className="h-16 flex items-center px-6 border-b border-zinc-800 font-bold text-lg">
        SynthUI
      </div>

      <div className="p-3 space-y-2">
        {items.map((item) => (
          <button
            key={item}
            className="w-full text-left px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition"
          >
            {item}
          </button>
        ))}
      </div>
    </aside>
  );
}