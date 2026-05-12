"use client";

import { useState } from "react";

import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { WorkspaceTabs } from "@/components/workspace-tabs";

export default function HomePage() {
  const [activeTab, setActiveTab] = useState("analytics");

  return (
    <div className="w-screen h-screen flex bg-zinc-950 text-white">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar />

        <div className="flex-1 overflow-hidden">
          <WorkspaceTabs
            activeTab={activeTab}
            setActiveTab={setActiveTab}
          />
        </div>
      </div>
    </div>
  );
}