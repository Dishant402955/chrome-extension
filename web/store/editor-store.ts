"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type Block = any;

type EditorStore = {
  // 🎬 core data
  timeline: Block[];
  videoUrl: string | null;

  // ▶️ playback
  currentTime: number;
  duration: number;
  isPlaying: boolean;

  // 🎯 ui
  selectedIndex: number | null;

  // ⚙️ actions
  setTimeline: (t: Block[]) => void;
  setVideoUrl: (url: string | null) => void;

  setTime: (t: number) => void;
  setDuration: (d: number) => void;

  play: () => void;
  pause: () => void;
  togglePlay: () => void;

  selectBlock: (i: number | null) => void;
  reset: () => void;
};

export const useEditorStore = create<EditorStore>()(
  persist(
    (set) => ({
      // -------- state --------
      timeline: [],
      videoUrl: null,

      currentTime: 0,
      duration: 0,
      isPlaying: false,

      selectedIndex: null,

      // -------- actions --------
      setTimeline: (timeline) => set({ timeline }),

      setVideoUrl: (url) => set({ videoUrl: url }),

      setTime: (time) => set({ currentTime: time }),

      setDuration: (duration) => set({ duration }),

      play: () => set({ isPlaying: true }),

      pause: () => set({ isPlaying: false }),

      togglePlay: () =>
        set((s) => ({ isPlaying: !s.isPlaying })),

      selectBlock: (i) => set({ selectedIndex: i }),

      reset: () =>
        set({
          timeline: [],
          videoUrl: null,
          currentTime: 0,
          duration: 0,
          isPlaying: false,
          selectedIndex: null,
        }),
    }),
    {
      name: "editor-storage", // 🔥 localStorage key

      // 🔥 IMPORTANT: only persist what makes sense
      partialize: (state) => ({
        timeline: state.timeline,
        videoUrl: state.videoUrl,
      }),
    }
  )
);