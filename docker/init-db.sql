-- PostgreSQL schema for skating-editor

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT UNIQUE,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  dir TEXT UNIQUE NOT NULL,
  hash TEXT NOT NULL,
  original_name TEXT,
  file_size BIGINT,
  duration REAL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_hash ON videos (hash);
CREATE INDEX IF NOT EXISTS idx_videos_user ON videos (user_id);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES videos(id),
  user_id UUID REFERENCES users(id),
  job_id TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, running, done, error
  percent INTEGER DEFAULT 0,
  stage TEXT,
  error TEXT,
  settings JSONB, -- threshold, minContour, etc.
  result JSONB, -- segments, duration, finalUrl, etc.
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_video ON jobs (video_id);

CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE,
  threshold REAL DEFAULT 0.003,
  min_contour INTEGER DEFAULT 50,
  min_motion_frames INTEGER DEFAULT 8,
  buffer_frames INTEGER DEFAULT 60,
  history INTEGER DEFAULT 300,
  var_threshold INTEGER DEFAULT 25,
  detect_shadows BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
