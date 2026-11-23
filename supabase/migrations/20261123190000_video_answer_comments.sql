-- Answering the comments on a game's reels (src/lib/video-comments.ts): when on, every night
-- the console asks the game's Build chat to answer the new comments on its reels at Upload-Post.
ALTER TABLE public.video_settings ADD COLUMN answer_comments boolean NOT NULL DEFAULT false;
