-- A web game's weekly reels brief now goes to its Build chat, which makes the videos in the
-- game's repo (src/lib/video-reels.ts). Each reel keeps the address of its video, on the
-- game's preview, to watch it on the Videos page.
ALTER TABLE public.video_reels ADD COLUMN video_url text;
ALTER TABLE public.video_reels
  ADD CONSTRAINT video_reels_video_url_check
  CHECK (video_url IS NULL OR (video_url ~ '^https://' AND char_length(video_url) <= 600));
