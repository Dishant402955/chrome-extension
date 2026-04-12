"use client";

import { useEditorStore } from "@/store/editor-store";

export default function ZoomControls() {
  const timeline = useEditorStore((s) => s.timeline);
  const selectedIndex = useEditorStore((s) => s.selectedIndex);
  const updateZoom = useEditorStore((s) => s.updateZoom);

  const zoom = timeline[selectedIndex].zoom;

  return (
    <div className="w-64 p-4 bg-neutral-900 text-white space-y-6">

      <input
        type="range"
        min={1}
        max={4}
        step={0.01}
        value={zoom.scale}
        onChange={(e) =>
          updateZoom({ scale: Number(e.target.value) })
        }
      />

      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={zoom.x}
        onChange={(e) =>
          updateZoom({ x: Number(e.target.value) })
        }
      />

      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={zoom.y}
        onChange={(e) =>
          updateZoom({ y: Number(e.target.value) })
        }
      />
    </div>
  );
}