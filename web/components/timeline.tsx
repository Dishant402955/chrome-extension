"use client";

import { useEditorStore } from "@/store/editor-store";

export default function Timeline() {
  const timeline = useEditorStore((s) => s.timeline);
  const duration = useEditorStore((s) => s.duration);
  const currentTime = useEditorStore((s) => s.currentTime);
  const setTime = useEditorStore((s) => s.setTime);
  const selectBlock = useEditorStore((s) => s.selectBlock);
  const selectedIndex = useEditorStore((s) => s.selectedIndex);

  const format = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="bg-neutral-900 text-white p-3">

      <div className="flex justify-between text-xs mb-1 opacity-70">
        <span>0:00</span>
        <span>{format(duration)}</span>
      </div>

      <div className="relative h-14 bg-neutral-800 rounded"
      onClick={(e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const t = x * duration;

  const setTime = useEditorStore((s) => s.setTime());

setTime(t);
}}
      
      
      >


        {/* segments */}
{timeline.map((b, i) => {
  const safeDuration = duration || 1; // prevent divide by 0

  const left = (b.t[0] / safeDuration) * 100;
  const width = ((b.t[1] - b.t[0]) / safeDuration) * 100;

  return (
    <div
      key={i}
      onClick={() => selectBlock(i)}
      className={`absolute top-0 h-full border cursor-pointer ${
        selectedIndex === i
          ? "bg-blue-500 border-white"
          : "bg-green-500 border-transparent"
      }`}
      style={{
        left: `${left}%`,
        width: `${width}%`,
        minWidth: "20px", // 🔥 prevents invisible segments
      }}
    />
  );
})}

        {/* playhead */}
        <div
          className="absolute top-0 w-[2px] h-full bg-red-500"
          style={{
            left: `${(currentTime / duration) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}