'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { MetricsGrid } from '@/components/metrics-grid';
import { TabsSection } from '@/components/tabs-section';
import { TimelinePanel } from '@/components/timeline-panel';

export default function Page() {
  const [activeTab, setActiveTab] = useState('analytics');

  return (
    <div className="h-screen w-screen bg-zinc-950 text-white overflow-hidden">
      <div className="flex h-full">
        <Sidebar />

        <div className="flex-1 flex flex-col">
          <Topbar />

          <main className="flex-1 overflow-auto p-6 space-y-6">
            <MetricsGrid />

            <TabsSection
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />

            <TimelinePanel />
          </main>
        </div>
      </div>
    </div>
  );
}