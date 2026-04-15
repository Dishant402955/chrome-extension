"use client";

import { useRef } from "react";
import { useEditorStore } from "@/store/editor-store";

export default function ControlsBar() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const timeline = useEditorStore((s) => s.timeline);
  const setFullState = useEditorStore((s) => s.setFullState);
  const setVideoUrl = useEditorStore((s) => s.setVideoUrl);

  // ================= EXPORT =================
  const exportScript = () => {
    const data = JSON.stringify({ timeline }, null, 2);

    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "script.json";
    a.click();

    URL.revokeObjectURL(url);
  };

  // ================= IMPORT SCRIPT =================
  const importScript = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);

        // 🔥 override entire timeline
        setFullState(data);
      } catch {
        alert("Invalid JSON. Try again.");
      }
    };

    reader.readAsText(file);
  };

  // ================= IMPORT VIDEO =================
  const importVideoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    setVideoUrl(url);
  };

  const importVideoUrl = () => {
    const url = prompt("Enter video URL");
    if (!url) return;

    setVideoUrl(url);
  };

  return (
    <div className="flex gap-3 p-3 bg-neutral-900 border-b border-neutral-700">
      
      {/* EXPORT */}
      <button
        onClick={exportScript}
        className="px-3 py-1 bg-green-600 rounded"
      >
        Export Script
      </button>

      {/* IMPORT SCRIPT */}
      <label className="px-3 py-1 bg-blue-600 rounded cursor-pointer">
        Import Script
        <input
          type="file"
          accept="application/json"
          className="hidden"
          onChange={importScript}
        />
      </label>

      {/* IMPORT VIDEO FILE */}
      <label className="px-3 py-1 bg-purple-600 rounded cursor-pointer">
        Upload Video
        <input
          type="file"
          accept="video/*"
          className="hidden"
          onChange={importVideoFile}
        />
      </label>

      {/* IMPORT VIDEO URL */}
      <button
        onClick={importVideoUrl}
        className="px-3 py-1 bg-orange-600 rounded"
      >
        Video URL
      </button>
    </div>
  );
}