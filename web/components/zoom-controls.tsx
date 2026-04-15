"use client";

import { useState } from "react";
import { useEditorStore } from "@/store/editor-store";

export default function ZoomControls() {
  const [tab, setTab] = useState<"zoom" | "blur" | "spotlight">("zoom");

  const timeline = useEditorStore((s) => s.timeline);
  const selectedIndex = useEditorStore((s) => s.selectedIndex);
  const setTimeline = useEditorStore((s) => s.setTimeline);

  const seg = timeline[selectedIndex];

  const update = (key: string, value: any) => {
    const updated = [...timeline];

    updated[selectedIndex] = {
      ...seg,
      [key]: {
        ...(seg[key] || {}),
        ...value,
      },
    };

    setTimeline(updated);
  };

  return (
    <div className="w-64 p-4 bg-neutral-900 text-white space-y-6">

      {/* TABS */}
      <div className="flex gap-2">
        {["zoom", "blur", "spotlight"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t as any)}
            className={`px-2 py-1 rounded ${
              tab === t ? "bg-white text-black" : "bg-white/20"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ZOOM */}
      {tab === "zoom" && (
        <>
          <input type="range" min={1} max={4} step={0.01}
            value={seg.zoom?.scale || 1}
            onChange={(e) => update("zoom", { scale: +e.target.value })}
          />
          <input type="range" min={0} max={1} step={0.001}
            value={seg.zoom?.x || 0.5}
            onChange={(e) => update("zoom", { x: +e.target.value })}
          />
          <input type="range" min={0} max={1} step={0.001}
            value={seg.zoom?.y || 0.5}
            onChange={(e) => update("zoom", { y: +e.target.value })}
          />
        </>
      )}

      {/* BLUR */}
      {tab === "blur" && (
        <>
          <input type="range" min={0} max={1} step={0.01}
            value={seg.blur?.x || 0.5}
            onChange={(e) => update("blur", { x: +e.target.value })}
          />
          <input type="range" min={0} max={1} step={0.01}
            value={seg.blur?.y || 0.5}
            onChange={(e) => update("blur", { y: +e.target.value })}
          />
          <input type="range" min={0} max={1} step={0.01}
            value={seg.blur?.w || 0.2}
            onChange={(e) => update("blur", { w: +e.target.value })}
          />
          <input type="range" min={0} max={1} step={0.01}
            value={seg.blur?.h || 0.2}
            onChange={(e) => update("blur", { h: +e.target.value })}
          />
        </>
      )}

      {/* SPOTLIGHT */}
      {tab === "spotlight" && (
        <>
          <input type="range" min={0} max={1} step={0.01}
            value={seg.shadow?.x || 0.5}
            onChange={(e) => update("shadow", { x: +e.target.value })}
          />
          <input type="range" min={0} max={1} step={0.01}
            value={seg.shadow?.y || 0.5}
            onChange={(e) => update("shadow", { y: +e.target.value })}
          />
          <input type="range" min={0} max={1} step={0.01}
            value={seg.shadow?.w || 0.3}
            onChange={(e) => update("shadow", { w: +e.target.value })}
          />
          <input type="range" min={0} max={1} step={0.01}
            value={seg.shadow?.h || 0.3}
            onChange={(e) => update("shadow", { h: +e.target.value })}
          />
        </>
      )}
    </div>
  );
}