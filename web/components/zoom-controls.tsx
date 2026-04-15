"use client";

import { useEditorStore } from "@/store/editor-store";

export default function ZoomControls() {
  const timeline = useEditorStore((s) => s.timeline);
  const selectedIndex = useEditorStore((s) => s.selectedIndex);

  const updateZoom = useEditorStore((s) => s.updateZoom);
  const updateBlur = useEditorStore((s) => s.updateBlur);
  const toggleBlur = useEditorStore((s) => s.toggleBlur);

  const updateShadow = useEditorStore((s) => s.updateShadow);
  const toggleShadow = useEditorStore((s) => s.toggleShadow);

  const segment = timeline[selectedIndex];

  const zoom = segment.zoom || { x: 0.5, y: 0.5, scale: 1 };
  const blur = segment.blur;
  const shadow = segment.shadow;

  const Slider = ({ label, value, min, max, step, onChange }) => (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-300">
        <span>{label}</span>
        <span>{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-500 cursor-pointer"
      />
    </div>
  );

  return (
    <div className="w-72 p-4 bg-neutral-900 text-white space-y-6 border-l border-neutral-700 overflow-y-auto">

      {/* ================= ZOOM ================= */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Zoom</h2>

        <Slider label="Scale" value={zoom.scale} min={1} max={4} step={0.01}
          onChange={(v) => updateZoom({ scale: v })} />

        <Slider label="X" value={zoom.x} min={0} max={1} step={0.001}
          onChange={(v) => updateZoom({ x: v })} />

        <Slider label="Y" value={zoom.y} min={0} max={1} step={0.001}
          onChange={(v) => updateZoom({ y: v })} />
      </div>

      {/* ================= BLUR ================= */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-sm font-semibold">Blur</h2>
          <button
            onClick={() => toggleBlur(!blur)}
            className={`px-2 py-1 text-xs rounded ${
              blur ? "bg-red-600" : "bg-green-600"
            }`}
          >
            {blur ? "OFF" : "ON"}
          </button>
        </div>

        {blur && (
          <div className="space-y-3">
            <Slider label="Center X" value={blur.x} min={0} max={1} step={0.001}
              onChange={(v) => updateBlur({ x: v })} />

            <Slider label="Center Y" value={blur.y} min={0} max={1} step={0.001}
              onChange={(v) => updateBlur({ y: v })} />

            <Slider label="Width" value={blur.w} min={0.05} max={1} step={0.01}
              onChange={(v) => updateBlur({ w: v })} />

            <Slider label="Height" value={blur.h} min={0.05} max={1} step={0.01}
              onChange={(v) => updateBlur({ h: v })} />
          </div>
        )}
      </div>

      {/* ================= SPOTLIGHT ================= */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-sm font-semibold">Spotlight</h2>
          <button
            onClick={() => toggleShadow(!shadow)}
            className={`px-2 py-1 text-xs rounded ${
              shadow ? "bg-red-600" : "bg-green-600"
            }`}
          >
            {shadow ? "OFF" : "ON"}
          </button>
        </div>

        {shadow && (
          <div className="space-y-3">
            <Slider label="Center X" value={shadow.x} min={0} max={1} step={0.001}
              onChange={(v) => updateShadow({ x: v })} />

            <Slider label="Center Y" value={shadow.y} min={0} max={1} step={0.001}
              onChange={(v) => updateShadow({ y: v })} />

            <Slider label="Radius" value={shadow.w} min={0.05} max={1} step={0.01}
              onChange={(v) => updateShadow({ w: v })} />
          </div>
        )}
      </div>

    </div>
  );
}