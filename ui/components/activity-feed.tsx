const items = Array.from({ length: 15 }).map((_, i) => ({
  title: `Interaction Event ${i + 1}`,
  type: i % 2 === 0 ? "Hover" : "Click",
  time: `${i + 1}s`,
}));

export function ActivityFeed() {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.title}
          className="bg-zinc-800 rounded-xl p-4 hover:bg-zinc-700 transition-all"
        >
          <div className="flex justify-between">
            <div>
              <div className="font-medium">
                {item.title}
              </div>

              <div className="text-sm text-zinc-400">
                {item.type}
              </div>
            </div>

            <div className="text-sm text-zinc-500">
              {item.time}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}