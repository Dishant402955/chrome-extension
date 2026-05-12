"use client";

import { useState } from "react";

export function SessionsView() {
  const [selected, setSelected] = useState(0);

  return (
    <div className="grid grid-cols-[320px_1fr] gap-6 h-full">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 overflow-auto">
        <div className="space-y-3">
          {Array.from({ length: 20 }).map((_, i) => (
            <button
              key={i}
              onClick={() => setSelected(i)}
              className={`w-full h-20 rounded-2xl p-4 text-left transition-all ${
                selected === i
                  ? "bg-blue-600"
                  : "bg-zinc-800 hover:bg-zinc-700"
              }`}
            >
              <div className="font-semibold">
                Session #{i + 1}
              </div>

              <div className="text-sm opacity-70">
                Interaction Density: High
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        <h2 className="text-2xl font-bold mb-6">
          Session Details
        </h2>

        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-36 rounded-2xl bg-zinc-800 hover:bg-zinc-700 transition-all"
            />
          ))}
        </div>
      </div>
    </div>
  );
}