import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useEditorStore = create(
  persist(
    (set) => ({
      timeline: [
        {
          t: [0, 5],
          zoom: { x: 0.5, y: 0.5, scale: 1.5 },
        },
        {
          t: [5, 10],
          zoom: { x: 0.3, y: 0.4, scale: 2 },
        },
      ],

      selectedIndex: 0,
      duration: 10,
      currentTime: 0,
      isPlaying: false,
      videoUrl: "/screen.webm",

      setTimeline: (t) => set({ timeline: t }),

      selectBlock: (i) => set({ selectedIndex: i }),

      setDuration: (d) => set({ duration: d }),

      setTime: (t) => set({ currentTime: t }),

      play: () => set({ isPlaying: true }),
      pause: () => set({ isPlaying: false }),

      updateZoom: (zoom) =>
        set((state) => {
          const updated = [...state.timeline];
          const b = updated[state.selectedIndex];

          updated[state.selectedIndex] = {
            ...b,
            zoom: { ...b.zoom, ...zoom },
          };

          return { timeline: updated };
        }),
    }),
    {
      name: "video-editor-store", // 🔥 persistence key
    }
  )
);