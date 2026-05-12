"use client";

import { useState } from "react";

interface Props {
  title: string;
  children: React.ReactNode;
}

export function ExpandableCard({
  title,
  children,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full h-16 px-5 flex items-center justify-between hover:bg-zinc-800 transition-all"
      >
        <span className="font-semibold">{title}</span>

        <span>{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="p-5 border-t border-zinc-800">
          {children}
        </div>
      )}
    </div>
  );
}