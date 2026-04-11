"use client"

import { Button } from "@/components/ui/button"
import VideoPlayer from "@/components/video-player"
import { useEditorStore } from "@/store/editor-store"
import { useEffect } from "react";

export default function Page() {
  const timeline = useEditorStore((s) => s.timeline);
  const setTimeline = useEditorStore((s) => s.setTimeline)
  const setVideoUrl = useEditorStore((s) => s.setVideoUrl)

useEffect(() => {
    if(timeline.length === 0){
    fetch("/script.json")
    .then((res) => res.json()).then((data) => {setTimeline(data)})

    setVideoUrl("/screen.webm")
  }
}, [])

  return (
        <VideoPlayer/>
  )
}
