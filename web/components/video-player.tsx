"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/store/editor-store";

export default function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamRef = useRef<HTMLVideoElement>(null);
  const magnifierVideoRef = useRef<HTMLVideoElement>(null);

  const subtitleRef = useRef<HTMLDivElement>(null);
  const magnifierRef = useRef<HTMLDivElement>(null);

  const timeline = useEditorStore((s) => s.timeline);
  const videoUrl = useEditorStore((s) => s.videoUrl);

  const isPlaying = useEditorStore((s) => s.isPlaying);
  const play = useEditorStore((s) => s.play);
  const pause = useEditorStore((s) => s.pause);
  const setTime = useEditorStore((s) => s.setTime);
  const currentTime = useEditorStore((s) => s.currentTime);

  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<any>(null);

  // ---------------- PLAYBACK CONTROL ----------------
  useEffect(() => {
    const v = videoRef.current;
    const w = webcamRef.current;
    const m = magnifierVideoRef.current;

    if (!v) return;

    if (isPlaying) {
      v.play();
      w?.play();
      m?.play();
    } else {
      v.pause();
      w?.pause();
      m?.pause();
    }
  }, [isPlaying]);

  // ---------------- CORE ENGINE ----------------
  useEffect(() => {
    const video = videoRef.current!;
    const webcam = webcamRef.current!;
    const magnifier = magnifierVideoRef.current!;

    function getSize() {
      const rect = video.getBoundingClientRect();
      return { W: rect.width, H: rect.height };
    }

    function reset() {
      video.style.transform = "translate(0px,0px) scale(1)";
      webcam.style.display = "none";
      magnifierRef.current!.style.display = "none";
      subtitleRef.current!.innerText = "";
    }

    function applyBlock(b: any) {
      const { W, H } = getSize();

      if (b.zoom) {
        const scale = b.zoom.scale;

        if (scale <= 1) {
          video.style.transform = `scale(${scale})`;
          return;
        }

        const cx = b.zoom.x * W;
        const cy = b.zoom.y * H;

        let tX = -cx * scale + W / 2;
        let tY = -cy * scale + H / 2;

        const minX = W - W * scale;
        const minY = H - H * scale;

        tX = Math.min(0, Math.max(minX, tX));
        tY = Math.min(0, Math.max(minY, tY));

        video.style.transform = `translate(${tX}px, ${tY}px) scale(${scale})`;
      }

      if (b.webcam) {
        webcam.style.display = "block";

        webcam.style.left =
          b.webcam.x * 100 - (b.webcam.w * 100) / 2 + "%";
        webcam.style.top =
          b.webcam.y * 100 - (b.webcam.h * 100) / 2 + "%";

        webcam.style.width = b.webcam.w * 100 + "%";
        webcam.style.height = b.webcam.h * 100 + "%";
      }

      if (b.subtitle) {
        subtitleRef.current!.innerText = b.subtitle;
      }
    }

    const onTimeUpdate = () => {
      const t = video.currentTime;

      // 🔥 ONLY sync if drift > threshold (NO jitter)
      if (webcam && Math.abs(webcam.currentTime - t) > 0.05) {
        webcam.currentTime = t;
      }

      if (magnifier && Math.abs(magnifier.currentTime - t) > 0.05) {
        magnifier.currentTime = t;
      }

      setTime(t);

      reset();

      for (let i = 0; i < timeline.length; i++) {
        const b = timeline[i];
        if (t >= b.t[0] && t <= b.t[1]) {
          applyBlock(b);
        }
      }
    };

    video.addEventListener("timeupdate", onTimeUpdate);

    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [timeline]);

  // ---------------- SEEK ----------------
  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    const w = webcamRef.current;
    const m = magnifierVideoRef.current;

    if (!v) return;

    const time = Number(e.target.value);

    v.currentTime = time;
    if (w) w.currentTime = time;
    if (m) m.currentTime = time;

    setTime(time);
  };

  // ---------------- CONTROLS UI ----------------
  const toggle = () => {
    if (isPlaying) pause();
    else play();
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
        // @ts-expect-error
        src={videoUrl}
        className="w-full h-full object-contain transition-transform duration-500 origin-top-left"
      />

      <div className="absolute inset-0 pointer-events-none">
        <video
          ref={webcamRef}
          src="/webcam.webm"
          muted
          className="absolute hidden border-2 border-white rounded-xl shadow-lg"
        />

        <div ref={magnifierRef} className="absolute hidden">
          <video 
          ref={magnifierVideoRef} 
          // @ts-expect-error
          src={videoUrl} 
          />
        </div>

        <div
          ref={subtitleRef}
          className="absolute bottom-6 w-full text-center text-white text-lg"
        />
      </div>

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
            max={videoRef.current?.duration || 0}
            step="0.01"
            value={currentTime}
            onChange={onSeek}
            className="flex-1"
          />
        </div>
      )}
    </div>
  );
}