CREATE TABLE IF NOT EXISTS direct_reviews (
  message_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS direct_reviews_user ON direct_reviews(user_id,created);
