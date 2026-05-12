"use client";

import { useState } from "react";

export function FloatingPanel() {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <button
        onClick={() => setVisible(true)}
        className="h-11 px-5 rounded-xl bg-purple-600 hover:bg-purple-500"
      >
        Open Inspector
      </button>

      {visible && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="w-[700px] bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">
                DOM Inspector
              </h2>

              <button
                onClick={() => setVisible(false)}
                className="h-10 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-14 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition-all"
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}