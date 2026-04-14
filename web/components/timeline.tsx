"use client";

import { useRef } from "react";
import { useEditorStore } from "@/store/editor-store";

const COLORS = [
  "bg-pink-500",
  "bg-green-500",
  "bg-blue-500",
  "bg-yellow-500",
  "bg-purple-500",
];

export default function Timeline() {
  const ref = useRef<HTMLDivElement>(null);

  const timeline = useEditorStore((s) => s.timeline);
  const selectBlock = useEditorStore((s) => s.selectBlock);
  const selectedIndex = useEditorStore((s) => s.selectedIndex);

  const currentTime = useEditorStore((s) => s.currentTime);
  const setTime = useEditorStore((s) => s.setTime);

  const total =
    timeline.length > 0
      ? Math.max(...timeline.map((b) => b.t[1]))
      : 1;

  // 🔥 convert time → %
  const getPercent = (t: number) => (t / total) * 100;

  // 🔥 DRAG PLAYHEAD
  const startDrag = (e: React.MouseEvent) => {
    e.stopPropagation();

    const move = (ev: MouseEvent) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;

      let x = ev.clientX - rect.left;
      x = Math.max(0, Math.min(x, rect.width));

      const percent = x / rect.width;
      const time = percent * total;

      setTime(time);
    };

    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="bg-neutral-900 text-white p-3 w-full">
      <div
        ref={ref}
        className="relative flex h-16 bg-neutral-800 rounded w-full cursor-pointer"
        onClick={(e) => {
          const rect = ref.current?.getBoundingClientRect();
          if (!rect) return;

          const x = e.clientX - rect.left;
          const percent = x / rect.width;

          setTime(percent * total);
        }}
      >
        {/* 🟩 SEGMENTS */}
        {timeline.map((b, i) => {
          const duration = b.t[1] - b.t[0];
          const percent = duration / total;

          return (
            <div
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                selectBlock(i);
              }}
              className={`h-full ${
                COLORS[i % COLORS.length]
              } ${selectedIndex === i ? "outline outline-white" : ""}`}
              style={{
                flex: `${percent} 0 0`,
                minWidth: "20px",
              }}
            />
          );
        })}

        {/* 🔴 PLAYHEAD */}
        <div
          className="absolute top-0 h-full w-[2px] bg-red-600 cursor-ew-resize"
          style={{
            left: `${getPercent(currentTime)}%`,
          }}
          onMouseDown={startDrag}
        />
      </div>
    </div>
  );
}