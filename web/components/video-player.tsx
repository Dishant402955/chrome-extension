"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/store/editor-store";

export default function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamRef = useRef<HTMLVideoElement>(null);

  const timeline = useEditorStore((s) => s.timeline);
  const videoUrl = useEditorStore((s) => s.videoUrl);

  const isPlaying = useEditorStore((s) => s.isPlaying);
  const play = useEditorStore((s) => s.play);
  const pause = useEditorStore((s) => s.pause);
  const setTime = useEditorStore((s) => s.setTime);
  const currentTime = useEditorStore((s) => s.currentTime);
  const setDuration = useEditorStore((s) => s.setDuration);

  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<any>(null);

  // ---------------- PLAY / PAUSE ----------------
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    if (isPlaying) v.play();
    else v.pause();
  }, [isPlaying]);

  // ---------------- CORE APPLY (WORKS EVEN WHEN PAUSED) ----------------
  const applyCurrentFrame = () => {
    const video = videoRef.current;
    if (!video) return;

    const t = video.currentTime;

    let active = timeline[0];

    for (let i = 0; i < timeline.length; i++) {
      const b = timeline[i];
      if (t >= b.t[0] && t <= b.t[1]) {
        active = b;
        break;
      }
    }

    if (!active?.zoom) {
      video.style.transform = "translate(0px,0px) scale(1)";
      return;
    }

    const rect = video.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;

    const { x, y, scale } = active.zoom;

    if (scale <= 1) {
      video.style.transform = `scale(${scale})`;
      return;
    }

    const cx = x * W;
    const cy = y * H;

    let tX = -cx * scale + W / 2;
    let tY = -cy * scale + H / 2;

    const minX = W - W * scale;
    const minY = H - H * scale;

    tX = Math.min(0, Math.max(minX, tX));
    tY = Math.min(0, Math.max(minY, tY));

    video.style.transform = `translate(${tX}px, ${tY}px) scale(${scale})`;
  };

  // 🔥 TIME UPDATE
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const update = () => {
      setTime(v.currentTime);
      applyCurrentFrame();
    };

    v.addEventListener("timeupdate", update);

    return () => v.removeEventListener("timeupdate", update);
  }, [timeline]);

  // 🔥 FIX: APPLY WHEN TIMELINE CHANGES (PAUSED FIX)
  useEffect(() => {
    applyCurrentFrame();
  }, [timeline]);

  useEffect(() => {
  const v = videoRef.current;
  if (!v) return;

  if (Math.abs(v.currentTime - currentTime) > 0.05) {
    v.currentTime = currentTime;
  }
}, [currentTime]);

 // 🔥 SET DURATION (FIXED)
useEffect(() => {
  const v = videoRef.current;
  if (!v) return;

  const updateDuration = () => {
    if (isFinite(v.duration) && v.duration > 0) {
      setDuration(v.duration);
    }
  };

  // try immediately
  updateDuration();

  v.addEventListener("loadedmetadata", updateDuration);
  v.addEventListener("durationchange", updateDuration);

  return () => {
    v.removeEventListener("loadedmetadata", updateDuration);
    v.removeEventListener("durationchange", updateDuration);
  };
}, []);

  // ---------------- SEEK ----------------
  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;

    const t = Number(e.target.value);
    v.currentTime = t;
    setTime(t);

    applyCurrentFrame(); // 🔥 instant update
  };

  // ---------------- UI ----------------
  const toggle = () => {
    isPlaying ? pause() : play();
  };

  const show = () => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setShowControls(false);
    }, 2000);
  };

  const stay = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setShowControls(true);
  };

  return (
    <div
      className="relative w-[960px] h-[540px] bg-black rounded-xl overflow-hidden"
      onMouseMove={show}
      onMouseEnter={stay}
    >
      <video
        ref={videoRef}
        src={videoUrl}
        className="w-full h-full object-contain transition-transform duration-300 origin-top-left"
      />

      {showControls && (
        <div
          className="absolute bottom-0 left-0 w-full bg-black/60 p-3 flex items-center gap-3"
          onMouseEnter={stay}
        >
          <button
            onClick={toggle}
            className="text-white px-3 py-1 bg-white/20 rounded"
          >
            {isPlaying ? "Pause" : "Play"}
          </button>

<input
  type="range"
  min={0}
  max={
    videoRef.current &&
    isFinite(videoRef.current.duration)
      ? videoRef.current.duration
      : 0
  }
  step="0.01"
  value={
    typeof currentTime === "number" && isFinite(currentTime)
      ? currentTime
      : 0
  }
  onChange={onSeek}
  className="flex-1"
/>
        </div>
      )}
    </div>
  );
}