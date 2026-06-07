-- 头像存储表（替代 R2）
CREATE TABLE avatars (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  data TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
