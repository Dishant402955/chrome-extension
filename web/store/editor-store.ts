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
      setRange: (index, range) =>
  set((state) => {
    const timeline = [...state.timeline];
    const block = timeline[index];

    const [oldStart, oldEnd] = block.t;
    const [newStart, newEnd] = range;

    const newTimeline = [];

    // 🔥 LEFT SPLIT
    if (newStart > oldStart) {
      newTimeline.push({
        ...block,
        t: [oldStart, newStart],
      });
    }

    // 🔥 MAIN UPDATED BLOCK
    newTimeline.push({
      ...block,
      t: [newStart, newEnd],
    });

    // 🔥 RIGHT SPLIT
    if (newEnd < oldEnd) {
      newTimeline.push({
        ...block,
        t: [newEnd, oldEnd],
      });
    }

    // 🔥 replace in timeline
    timeline.splice(index, 1, ...newTimeline);

    return { timeline };
  }),

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