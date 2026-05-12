"use client";

import { AnalyticsView } from "./analytics-view";
import { EditorView } from "./editor-view";
import { SessionsView } from "./sessions-view";

interface Props {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const tabs = ["analytics", "editor", "sessions"];

export function WorkspaceTabs({
  activeTab,
  setActiveTab,
}: Props) {
  return (
    <div className="h-full flex flex-col">
      <div className="h-14 border-b border-zinc-800 flex items-center px-4 gap-2 bg-zinc-900">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`h-10 px-5 rounded-xl capitalize transition-all ${
              activeTab === tab
                ? "bg-blue-600"
                : "bg-zinc-800 hover:bg-zinc-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {activeTab === "analytics" && <AnalyticsView />}
        {activeTab === "editor" && <EditorView />}
        {activeTab === "sessions" && <SessionsView />}
      </div>
    </div>
  );
}