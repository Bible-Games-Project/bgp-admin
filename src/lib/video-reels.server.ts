// Keeps the reels Claude makes or plans (video-reels.ts). Called when the build server
// finishes a Videos message, or a Build chat message that was the weekly reels brief
// (agent.server.ts, finishTurn): if the reply has a ```reels block, it becomes the reels of
// the weeks its days fall in, replacing the reels still planned for those weeks (the ones the
// team discarded stay discarded). A video given as a path is put on the game's preview.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { mondayOf, parseReelPlan, videoUrl } from "@/lib/video-reels";

const db = () => supabaseAdmin as any;

export async function saveReelPlan(
  turn: { id: string; appId: string },
  reply: string | null,
  previewUrl: string | null = null,
) {
  const reels = parseReelPlan(reply);
  if (!reels) return 0;
  const weeks = [...new Set(reels.map((r) => mondayOf(r.publishOn)))];
  const { error: cleared } = await db()
    .from("video_reels")
    .delete()
    .eq("app_id", turn.appId)
    .eq("status", "planned")
    .in("week_of", weeks);
  if (cleared) throw new Error(cleared.message);
  const { error } = await db()
    .from("video_reels")
    .insert(
      reels.map((r) => ({
        app_id: turn.appId,
        turn_id: turn.id,
        week_of: mondayOf(r.publishOn),
        publish_on: r.publishOn,
        title: r.title,
        hook: r.hook,
        script: r.script,
        voiceover: r.voiceover,
        caption: r.caption,
        hashtags: r.hashtags,
        video_url: videoUrl(r.video, previewUrl),
      })),
    );
  if (error) throw new Error(error.message);
  return reels.length;
}
