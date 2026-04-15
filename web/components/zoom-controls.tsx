"use client";

import { useEditorStore } from "@/store/editor-store";

export default function Controls() {
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
    <div className="w-72 p-4 bg-neutral-900 text-white space-y-6 overflow-y-auto">

      {/* -------- ZOOM -------- */}
      <div>
        <p className="text-sm mb-2 opacity-70">ZOOM</p>

        <label>Scale</label>
        <input type="range" min={1} max={4} step={0.01}
          value={seg.zoom?.scale || 1}
          onChange={(e) => update("zoom", { scale: +e.target.value })}
        />

        <label>X</label>
        <input type="range" min={0} max={1} step={0.001}
          value={seg.zoom?.x || 0.5}
          onChange={(e) => update("zoom", { x: +e.target.value })}
        />

        <label>Y</label>
        <input type="range" min={0} max={1} step={0.001}
          value={seg.zoom?.y || 0.5}
          onChange={(e) => update("zoom", { y: +e.target.value })}
        />
      </div>

      {/* -------- BLUR -------- */}
      <div>
        <p className="text-sm mb-2 opacity-70">BLUR REGION (keeps clear)</p>

        <label>X</label>
        <input type="range" min={0} max={1} step={0.01}
          value={seg.blur?.x || 0.5}
          onChange={(e) => update("blur", { x: +e.target.value })}
        />

        <label>Y</label>
        <input type="range" min={0} max={1} step={0.01}
          value={seg.blur?.y || 0.5}
          onChange={(e) => update("blur", { y: +e.target.value })}
        />

        <label>Width</label>
        <input type="range" min={0} max={1} step={0.01}
          value={seg.blur?.w || 0.2}
          onChange={(e) => update("blur", { w: +e.target.value })}
        />

        <label>Height</label>
        <input type="range" min={0} max={1} step={0.01}
          value={seg.blur?.h || 0.2}
          onChange={(e) => update("blur", { h: +e.target.value })}
        />
      </div>

      {/* -------- SPOTLIGHT -------- */}
      <div>
        <p className="text-sm mb-2 opacity-70">SPOTLIGHT</p>

        <label>X</label>
        <input type="range" min={0} max={1} step={0.01}
          value={seg.shadow?.x || 0.5}
          onChange={(e) => update("shadow", { x: +e.target.value })}
        />

        <label>Y</label>
        <input type="range" min={0} max={1} step={0.01}
          value={seg.shadow?.y || 0.5}
          onChange={(e) => update("shadow", { y: +e.target.value })}
        />

        <label>Radius</label>
        <input type="range" min={0} max={1} step={0.01}
          value={seg.shadow?.w || 0.3}
          onChange={(e) => update("shadow", { w: +e.target.value })}
        />
      </div>

    </div>
  );
}