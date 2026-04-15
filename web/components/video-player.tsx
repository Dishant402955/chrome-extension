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

  // 🎥 fake webcam source (replace later with real stream if you want)
  const webcamUrl = "/screen.webm";

  // ---------------- PLAY / PAUSE ----------------
  useEffect(() => {
    const v = videoRef.current;
    const w = webcamRef.current;
    if (!v) return;

    if (isPlaying) {
      v.play().catch(() => {});
      w?.play().catch(() => {});
    } else {
      v.pause();
      w?.pause();
    }
  }, [isPlaying]);

  // ---------------- CORE APPLY ----------------
  const applyCurrentFrame = () => {
    const video = videoRef.current;
    if (!video || timeline.length === 0) return;

    const t = video.currentTime;

    let active = timeline[0];
    let activeIndex = 0;

    for (let i = 0; i < timeline.length; i++) {
      const b = timeline[i];
      if (t >= b.t[0] && t <= b.t[1]) {
        active = b;
        activeIndex = i;
        break;
      }
    }

    // 🔥 AUTO SELECT SEGMENT
    const currentSelected = useEditorStore.getState().selectedIndex;
    if (currentSelected !== activeIndex) {
      useEditorStore.getState().selectBlock(activeIndex);
    }

    // ================= ZOOM =================
    if (!active.zoom) {
      video.style.transform = "translate(0px,0px) scale(1)";
    } else {
      const rect = video.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;

      const { x, y, scale } = active.zoom;

      if (scale <= 1) {
        video.style.transform = `scale(${scale})`;
      } else {
        const cx = x * W;
        const cy = y * H;

        let tX = -cx * scale + W / 2;
        let tY = -cy * scale + H / 2;

        const minX = W - W * scale;
        const minY = H - H * scale;

        tX = Math.min(0, Math.max(minX, tX));
        tY = Math.min(0, Math.max(minY, tY));

        video.style.transform = `translate(${tX}px, ${tY}px) scale(${scale})`;
      }
    }

    // ================= WEBCAM =================
    const webcam = webcamRef.current;

    if (active.webcam && webcam) {
      const { x, y, w, h } = active.webcam;

      webcam.style.display = "block";

      webcam.style.width = `${w * 100}%`;
      webcam.style.height = `${h * 100}%`;

      webcam.style.left = `${(x - w / 2) * 100}%`;
      webcam.style.top = `${(y - h / 2) * 100}%`;
    } else if (webcam) {
      webcam.style.display = "none";
    }

    // ================= BLUR =================
    const topEl = document.getElementById("blur-top");
    const bottomEl = document.getElementById("blur-bottom");
    const leftEl = document.getElementById("blur-left");
    const rightEl = document.getElementById("blur-right");

    if (active.blur && topEl && bottomEl && leftEl && rightEl) {
      const { x, y, w, h } = active.blur;

      const left = x - w / 2;
      const right = x + w / 2;
      const top = y - h / 2;
      const bottom = y + h / 2;

      [topEl, bottomEl, leftEl, rightEl].forEach((el) => {
        el.style.display = "block";
      });

      topEl.style.height = `${top * 100}%`;
      bottomEl.style.top = `${bottom * 100}%`;
      bottomEl.style.height = `${(1 - bottom) * 100}%`;

      leftEl.style.width = `${left * 100}%`;
      leftEl.style.top = `${top * 100}%`;
      leftEl.style.height = `${h * 100}%`;

      rightEl.style.left = `${right * 100}%`;
      rightEl.style.width = `${(1 - right) * 100}%`;
      rightEl.style.top = `${top * 100}%`;
      rightEl.style.height = `${h * 100}%`;
    } else {
      ["blur-top", "blur-bottom", "blur-left", "blur-right"].forEach(
        (id) => {
          const el = document.getElementById(id);
          if (el) el.style.display = "none";
        }
      );
    }

    // ================= SPOTLIGHT =================
    const shadowLayer = document.getElementById("shadow-layer");

    if (active.shadow && shadowLayer) {
      const { x, y, w } = active.shadow;

      shadowLayer.style.display = "block";
      shadowLayer.style.background = `
        radial-gradient(
          circle at ${x * 100}% ${y * 100}%,
          transparent ${w * 100}%,
          rgba(0,0,0,0.75) ${w * 100 + 1}%
        )
      `;
    } else if (shadowLayer) {
      shadowLayer.style.display = "none";
    }
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

  useEffect(() => {
    applyCurrentFrame();
  }, [timeline, currentTime]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    if (Math.abs(v.currentTime - currentTime) > 0.05) {
      v.currentTime = currentTime;
    }
  }, [currentTime]);

  // 🔥 SET DURATION
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const updateDuration = () => {
      if (isFinite(v.duration) && v.duration > 0) {
        setDuration(v.duration);
      }
    };

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
      {/* MAIN VIDEO */}
      <video
        ref={videoRef}
        src={videoUrl}
        className="w-full h-full object-contain transition-transform duration-300 origin-top-left"
      />

      {/* 🎥 WEBCAM OVERLAY */}
      <video
        ref={webcamRef}
        src={"/webcam.webm"}
        className="absolute hidden object-cover rounded-md border border-white/30"
        muted
      />

      {/* BLUR */}
      <div id="blur-top" className="absolute hidden backdrop-blur-md pointer-events-none" />
      <div id="blur-bottom" className="absolute hidden backdrop-blur-md pointer-events-none" />
      <div id="blur-left" className="absolute hidden backdrop-blur-md pointer-events-none" />
      <div id="blur-right" className="absolute hidden backdrop-blur-md pointer-events-none" />

      {/* SPOTLIGHT */}
      <div id="shadow-layer" className="absolute inset-0 hidden pointer-events-none" />

      {/* CONTROLS */}
      {showControls && (
        <div className="absolute bottom-0 left-0 w-full bg-black/60 p-3 flex items-center gap-3">
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