export function TimelinePanel() {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          Session Timeline
        </h2>

        <button className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700">
          Export Timeline
        </button>
      </div>

      <div className="space-y-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition"
          />
        ))}
      </div>
    </div>
  );
}