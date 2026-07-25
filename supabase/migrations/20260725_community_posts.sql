-- Phase 2: Community photo feed
-- Run in Supabase → SQL Editor

-- Posts
CREATE TABLE IF NOT EXISTS public.community_posts (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url      TEXT        NOT NULL,
  caption        TEXT,
  lieu_id        UUID        REFERENCES public.lieux(id) ON DELETE SET NULL,
  auto_generated BOOLEAN     NOT NULL DEFAULT false,
  report_count   INTEGER     NOT NULL DEFAULT 0,
  hidden         BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Likes
CREATE TABLE IF NOT EXISTS public.community_post_likes (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id    UUID        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- Comments
CREATE TABLE IF NOT EXISTS public.community_post_comments (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id    UUID        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_community_posts_feed       ON public.community_posts(created_at DESC) WHERE hidden = false;
CREATE INDEX IF NOT EXISTS idx_community_posts_lieu_id    ON public.community_posts(lieu_id) WHERE lieu_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_community_posts_user_id    ON public.community_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_cp_likes_post_id           ON public.community_post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_cp_likes_user_id           ON public.community_post_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_cp_comments_post_id        ON public.community_post_comments(post_id);

-- RLS
ALTER TABLE public.community_posts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_likes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_comments ENABLE ROW LEVEL SECURITY;

-- community_posts policies
CREATE POLICY "read visible posts"  ON public.community_posts FOR SELECT USING (hidden = false);
CREATE POLICY "insert own posts"    ON public.community_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete own posts"    ON public.community_posts FOR DELETE USING (auth.uid() = user_id);

-- community_post_likes policies
CREATE POLICY "read likes"          ON public.community_post_likes FOR SELECT USING (true);
CREATE POLICY "insert own likes"    ON public.community_post_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete own likes"    ON public.community_post_likes FOR DELETE USING (auth.uid() = user_id);

-- community_post_comments policies
CREATE POLICY "read comments"       ON public.community_post_comments FOR SELECT USING (true);
CREATE POLICY "insert own comments" ON public.community_post_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete own comments" ON public.community_post_comments FOR DELETE USING (auth.uid() = user_id);

-- Storage: allow community uploads in lieu-photos bucket (community/ prefix)
-- (no SQL needed — bucket already exists, RLS handled at app level)
