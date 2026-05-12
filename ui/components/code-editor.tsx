"use client";

import { useState } from "react";

export function CodeEditor() {
  const [value, setValue] = useState(`[
  {
    zoom: 1.8,
    x: 0.32,
    y: 0.48
  }
]`);

  return (
    <textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      className="w-full h-[400px] bg-black border border-zinc-800 rounded-2xl p-5 font-mono text-sm outline-none resize-none"
    />
  );
}