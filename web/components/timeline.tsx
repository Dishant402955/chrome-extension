"use client";

import { useRef } from "react";
import { useEditorStore } from "@/store/editor-store";

const COLORS = [
  "bg-pink-300",
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
  const setRange = useEditorStore((s) => s.setRange);

  const currentTime = useEditorStore((s) => s.currentTime);
  const setTime = useEditorStore((s) => s.setTime);

  const total =
    timeline.length > 0
      ? Math.max(...timeline.map((b) => b.t[1]))
      : 1;

  const getPercent = (t: number) => (t / total) * 100;

  // 🔥 HANDLE DRAG (SHRINK ONLY)
  const drag =
    (index: number, side: "start" | "end") =>
    (e: React.MouseEvent) => {
      e.stopPropagation();

      const move = (ev: MouseEvent) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;

        let x = ev.clientX - rect.left;
        x = Math.max(0, Math.min(x, rect.width));

        const percent = x / rect.width;
        const time = percent * total;

        const block = timeline[index];
        let [start, end] = block.t;

        if (side === "start") {
          start = Math.min(time, end - 0.1);
        } else {
          end = Math.max(time, start + 0.1);
        }

        setRange(index, [start, end]);
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
        className="relative  h-16 bg-neutral-800 rounded w-full cursor-pointer"
onClick={(e) => {
  const rect = ref.current?.getBoundingClientRect();
  if (!rect) return;

  const x = e.clientX - rect.left;
  const percent = x / rect.width;
  const time = percent * total;

  // 🔥 check if clicked inside any segment
  const foundIndex = timeline.findIndex(
    (b) => time >= b.t[0] && time <= b.t[1]
  );

  if (foundIndex !== -1) {
    // normal behavior
    setTime(time);
    return;
  }

  // 🔥 CLICKED EMPTY / ORPHAN SPACE
  const newSegment = {
    t: [time, time + 0.5], // small default size
    zoom: { x: 0, y: 0, scale: 1 },
    blur: { x: 0, y: 0, w: 0, h: 0 },
    shadow: { x: 0, y: 0, w: 0, h: 0 },
    orphan: false,
  };

  const updated = [...timeline, newSegment];

  // 🔥 sort by time so timeline doesn't become garbage
  updated.sort((a, b) => a.t[0] - b.t[0]);

  useEditorStore.getState().setTimeline(updated);
  useEditorStore.getState().selectBlock(updated.length - 1);
}}
      >
{/* SEGMENTS */}
{timeline.map((b, i) => {
  const left = (b.t[0] / total) * 100;
  const width = ((b.t[1] - b.t[0]) / total) * 100;

  return (
    <div
      key={i}
      onClick={(e) => {
        e.stopPropagation();
        selectBlock(i);
      }}
      className={`absolute top-0 h-full ${
        COLORS[i % COLORS.length]
      } ${selectedIndex === i ? "outline outline-white" : ""}`}
      style={{
        left: `${left}%`,
        width: `${width}%`,
        minWidth: "10px",
      }}
    >
      {selectedIndex === i && (
        <>
          {/* LEFT STICK */}
          <div
            className="absolute left-0 top-0 w-2 h-full bg-white cursor-ew-resize"
            onMouseDown={drag(i, "start")}
          />

          {/* RIGHT STICK */}
          <div
            className="absolute right-0 top-0 w-2 h-full bg-white cursor-ew-resize"
            onMouseDown={drag(i, "end")}
          />
        </>
      )}
    </div>
  );
})}

        {/* 🔴 PLAYHEAD */}
        <div
          className="absolute top-0 h-full w-[2px] bg-red-600 cursor-ew-resize"
          style={{
            left: `${getPercent(currentTime)}%`,
          }}
        />
      </div>
    </div>
  );
}