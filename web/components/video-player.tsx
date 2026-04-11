"use client";

import { useEffect, useRef } from "react";

type Block = any;

export default function VideoPlayer({
  src = "/screen.webm",
  timeline = [],
}: {
  src?: string;
  timeline: Block[];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamRef = useRef<HTMLVideoElement>(null);
  const magnifierVideoRef = useRef<HTMLVideoElement>(null);

  const highlightRef = useRef<HTMLDivElement>(null);
  const blurTopRef = useRef<HTMLDivElement>(null);
  const blurBottomRef = useRef<HTMLDivElement>(null);
  const blurLeftRef = useRef<HTMLDivElement>(null);
  const blurRightRef = useRef<HTMLDivElement>(null);

  const shadowTopRef = useRef<HTMLDivElement>(null);
  const shadowBottomRef = useRef<HTMLDivElement>(null);
  const shadowLeftRef = useRef<HTMLDivElement>(null);
  const shadowRightRef = useRef<HTMLDivElement>(null);

  const magnifierRef = useRef<HTMLDivElement>(null);
  const subtitleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const video = videoRef.current!;
    const webcam = webcamRef.current!;
    const magnifierVideo = magnifierVideoRef.current!;

    function getSize() {
      const rect = video.getBoundingClientRect();
      return { W: rect.width, H: rect.height };
    }

    function reset() {
      highlightRef.current!.style.display = "none";

      [blurTopRef, blurBottomRef, blurLeftRef, blurRightRef].forEach(
        (r) => (r.current!.style.display = "none")
      );

      [shadowTopRef, shadowBottomRef, shadowLeftRef, shadowRightRef].forEach(
        (r) => (r.current!.style.display = "none")
      );

      magnifierRef.current!.style.display = "none";
      subtitleRef.current!.innerText = "";

      // 🔥 critical
      video.style.transform = "translate(0px,0px) scale(1)";
      webcam.style.display = "none";
    }

    function applyBlock(b: any) {
      const { W, H } = getSize();

      if (b.zoom) {
        const scale = b.zoom.scale;

        // 🔥 if zooming OUT → always center, no clipping ever
        if (scale <= 1) {
          video.style.transform = `scale(${scale})`;
          return;
        }

        const cx = b.zoom.x * W;
        const cy = b.zoom.y * H;

        let tX = -cx * scale + W / 2;
        let tY = -cy * scale + H / 2;

        const scaledW = W * scale;
        const scaledH = H * scale;

        const minX = W - scaledW;
        const minY = H - scaledH;

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

      if (b.webcamLarge) {
        webcam.style.display = "block";
        webcam.style.left = "10%";
        webcam.style.top = "10%";
        webcam.style.width = "80%";
        webcam.style.height = "80%";
      }

      if (b.subtitle) {
        subtitleRef.current!.innerText = b.subtitle;
      }
    }

    const onTimeUpdate = () => {
      const t = video.currentTime;
      reset();

      timeline.forEach((block) => {
        if (t >= block.t[0] && t <= block.t[1]) {
          applyBlock(block);
        }
      });
    };

    video.addEventListener("timeupdate", onTimeUpdate);

    video.addEventListener("play", () => {
      magnifierVideo.play();
      webcam.play();
    });

    video.addEventListener("pause", () => {
      magnifierVideo.pause();
      webcam.pause();
    });

    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [timeline]);

  return (
    <div className="bg-[#111] flex justify-center items-center h-screen">
      <div className="relative w-[960px] h-fit overflow-hidden rounded-xl shadow-2xl bg-black">

        <video
          ref={videoRef}
          src={src}
          controls
          className="w-full h-full object-contain transition-transform duration-500 origin-top-left"
        />

        <div className="absolute inset-0 pointer-events-none">

          <video
            ref={webcamRef}
            src={src}
            muted
            className="absolute hidden border-2 border-white rounded-xl shadow-lg"
          />

          <div ref={highlightRef} className="absolute border-4 border-red-500 hidden" />

          <div ref={blurTopRef} className="absolute backdrop-blur-md hidden" />
          <div ref={blurBottomRef} className="absolute backdrop-blur-md hidden" />
          <div ref={blurLeftRef} className="absolute backdrop-blur-md hidden" />
          <div ref={blurRightRef} className="absolute backdrop-blur-md hidden" />

          <div ref={shadowTopRef} className="absolute bg-black/70 hidden" />
          <div ref={shadowBottomRef} className="absolute bg-black/70 hidden" />
          <div ref={shadowLeftRef} className="absolute bg-black/70 hidden" />
          <div ref={shadowRightRef} className="absolute bg-black/70 hidden" />

          <div
            ref={magnifierRef}
            className="absolute overflow-hidden border-4 border-white rounded-full hidden shadow-lg"
          >
            <video
              ref={magnifierVideoRef}
              src={src}
              className="absolute w-full h-full object-cover"
            />
          </div>

          <div
            ref={subtitleRef}
            className="absolute bottom-6 w-full text-center text-white text-lg drop-shadow-lg"
          />
        </div>
      </div>
    </div>
  );
}