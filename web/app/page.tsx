import { Button } from "@/components/ui/button"
import VideoPlayer from "@/components/video-player"
import script from "@/data/script.json"

export default function Page() {
  return (

        <VideoPlayer timeline={script}/>
     
  )
}
