import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useEditorStore = create(
  persist(
    (set) => ({
      timeline: [
        {
          t: [0, 3],
          zoom: { x: 0.5, y: 0.5, scale: 1.5 },
        },
        {
          t: [3, 7],
          zoom: { x: 0.3, y: 0.4, scale: 2 },
        },
                {
          t: [7, 12],
          zoom: { x: 0.5, y: 0.5, scale: 1.5 },
        },
        {
          t: [12, 19],
          zoom: { x: 0.3, y: 0.4, scale: 2 },
        },
                {
          t: [19, 23],
          zoom: { x: 0.3, y: 0.4, scale: 2 },
        },
      ],
setFullState: (data) =>
  set(() => ({
    timeline: data.timeline || [],
    selectedIndex: 0,
    currentTime: 0,
  })),

setVideoUrl: (url) => set({ videoUrl: url })
      ,
      selectedIndex: 0,
      duration: 0,
      currentTime: 0,
      isPlaying: false,
      videoUrl: "/screen.webm",
     setRange: (index, range) =>
  set((state) => {
    const timeline = [...state.timeline];

    let [newStart, newEnd] = range;

    // 🔥 update current block
    timeline[index] = {
      ...timeline[index],
      t: [newStart, newEnd],
    };

    // 🔥 HANDLE RIGHT SIDE (EXPANDING RIGHT)
    for (let i = index + 1; i < timeline.length; i++) {
      const [s, e] = timeline[i].t;

      // overlap exists
      if (s < newEnd) {
        // shrink from left
        const updatedStart = newEnd;

        // if fully eaten → collapse
        if (updatedStart >= e) {
          timeline[i].t = [e, e]; // zero width (or delete later)
        } else {
          timeline[i].t = [updatedStart, e];
        }
      }
    }

    // 🔥 HANDLE LEFT SIDE (EXPANDING LEFT)
    for (let i = index - 1; i >= 0; i--) {
      const [s, e] = timeline[i].t;

      if (e > newStart) {
        const updatedEnd = newStart;

        if (updatedEnd <= s) {
          timeline[i].t = [s, s];
        } else {
          timeline[i].t = [s, updatedEnd];
        }
      }
    }

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
  name: "video-editor-store",
  version: 2,
  migrate: (persistedState: any, version: number) => {
    // 🔥 force reset when structure changes
    if (version < 2) {
      return {
        timeline: [
          { t: [0, 3], zoom: { x: 0.5, y: 0.5, scale: 1.5 } },
          { t: [3, 7], zoom: { x: 0.3, y: 0.4, scale: 2 } },
          { t: [7, 12], zoom: { x: 0.5, y: 0.5, scale: 1.5 } }
        ],
        selectedIndex: 0,
        duration: 0,
        currentTime: 0,
        isPlaying: false,
        videoUrl: "/screen.webm",
      };
    }

    return persistedState;
  },
},
  ),
);