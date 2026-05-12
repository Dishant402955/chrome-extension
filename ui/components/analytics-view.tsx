import { ExpandableCard } from "./expandable-card";
import { ActivityFeed } from "./activity-feed";
import { FloatingPanel } from "./floating-panel";

export function AnalyticsView() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        {[
          "Attention Score",
          "Interaction Density",
          "Focus Stability",
          "Motion Entropy",
        ].map((item, i) => (
          <div
            key={item}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 h-32 hover:border-blue-500 transition-all"
          >
            <div className="text-sm text-zinc-400">
              {item}
            </div>

            <div className="mt-4 text-4xl font-bold">
              {80 + i}%
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <ExpandableCard title="Interaction Timeline">
          <ActivityFeed />
        </ExpandableCard>

        <ExpandableCard title="Region Stability">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-xl bg-zinc-800"
              />
            ))}
          </div>
        </ExpandableCard>
      </div>

      <FloatingPanel />
    </div>
  );
}