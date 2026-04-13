"use client";

import { useRef } from "react";
import { useEditorStore } from "@/store/editor-store";

const COLORS = [
  "bg-red-500/40",
  "bg-green-500/40",
  "bg-blue-500/40",
  "bg-yellow-500/40",
  "bg-purple-500/40",
];

export default function Timeline() {
  const ref = useRef<HTMLDivElement>(null);

  const timeline = useEditorStore((s) => s.timeline);
  const durationRaw = useEditorStore((s) => s.duration);
  const currentTimeRaw = useEditorStore((s) => s.currentTime);
  const setTime = useEditorStore((s) => s.setTime);
  const selectBlock = useEditorStore((s) => s.selectBlock);
  const setRange = useEditorStore((s) => s.setRange);
  const selectedIndex = useEditorStore((s) => s.selectedIndex);

  const duration = durationRaw > 0 ? durationRaw : 1;
  const currentTime = isFinite(currentTimeRaw) ? currentTimeRaw : 0;

  const getWidth = () => ref.current?.clientWidth || 1;

  // ✅ REAL proportional mapping (no stretch)
  const toPx = (t: number) => (t / duration) * getWidth();
  const toTime = (px: number) => (px / getWidth()) * duration;

  const drag =
    (index: number, type: "start" | "end") => (e: React.MouseEvent) => {
      e.stopPropagation();

      const move = (ev: MouseEvent) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;

        const x = ev.clientX - rect.left;
        const time = toTime(x);

        const block = timeline[index];
        const [start, end] = block.t;

        if (type === "start") {
          setRange(index, [
            Math.max(0, Math.min(time, end - 0.1)),
            end,
          ]);
        } else {
          setRange(index, [
            start,
            Math.min(duration, Math.max(time, start + 0.1)),
          ]);
        }
      };

      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };

      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };

  return (
    <div className="bg-neutral-900 text-white p-3">
      <div
        ref={ref}
        className="relative h-16 bg-neutral-800 rounded w-full"
        onClick={(e) => {
          const rect = ref.current?.getBoundingClientRect();
          if (!rect) return;

          const x = e.clientX - rect.left;
          setTime(toTime(x));
        }}
      >
        {timeline.map((b, i) => {
          const start = b.t[0];
          const end = b.t[1];

          const left = toPx(start);
          const width = Math.max(12, toPx(end) - toPx(start));

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
                left: `${left}px`,
                width: `${width}px`,
              }}
            >
              {selectedIndex === i && (
                <>
                  <div
                    className="absolute left-0 top-0 w-2 h-full bg-white cursor-ew-resize"
                    onMouseDown={drag(i, "start")}
                  />
                  <div
                    className="absolute right-0 top-0 w-2 h-full bg-white cursor-ew-resize"
                    onMouseDown={drag(i, "end")}
                  />
                </>
              )}
            </div>
          );
        })}

        {/* playhead */}
        <div
          className="absolute top-0 w-[2px] h-full bg-red-500"
          style={{ left: `${toPx(currentTime)}px` }}
        />
      </div>
    </div>
  );
}