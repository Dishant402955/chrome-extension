import { CodePanel } from './code-panel';
import { ActivityTable } from './activity-table';

interface Props {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export function TabsSection({
  activeTab,
  setActiveTab,
}: Props) {
  const tabs = ['analytics', 'code', 'events'];

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="flex border-b border-zinc-800">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-4 capitalize transition ${
              activeTab === tab
                ? 'bg-zinc-800'
                : 'hover:bg-zinc-800/50'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="p-6">
        {activeTab === 'analytics' && <ActivityTable />}
        {activeTab === 'code' && <CodePanel />}
        {activeTab === 'events' && <ActivityTable />}
      </div>
    </div>
  );
}