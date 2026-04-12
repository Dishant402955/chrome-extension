
import VideoPlayer from "@/components/video-player";
import Timeline from "@/components/timeline";
import ZoomControls from "@/components/zoom-controls";

export default function EditorPage() {


  return (
    <div className="flex flex-col h-screen bg-black">

      <div className="flex flex-1">
        <div className="flex-1 flex justify-center items-center">
          <VideoPlayer />
        </div>

        <ZoomControls />
      </div>

      <Timeline />

    </div>
  );
}