-- 用户表
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  avatar TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 账本表
CREATE TABLE ledgers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  daily_limit INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- 账本成员表
CREATE TABLE ledger_members (
  ledger_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  removed_at INTEGER,
  PRIMARY KEY (ledger_id, user_id),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 邀请表
CREATE TABLE ledger_invites (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 交易表
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount != 0),
  note TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  created_by TEXT NOT NULL,
  updated_by TEXT,
  deleted_by TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 事件表
CREATE TABLE ledger_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id TEXT NOT NULL,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  client_mutation_id TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 客户端变更去重表
CREATE TABLE client_mutations (
  id TEXT NOT NULL,
  ledger_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  event_id INTEGER,
  response_payload TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (ledger_id, user_id, id)
);

-- 刷新会话表
CREATE TABLE refresh_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip_hash TEXT,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 限额历史表
CREATE TABLE limit_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  daily_limit INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (ledger_id, effective_date)
);

-- 索引
CREATE INDEX idx_transactions_ledger_date ON transactions(ledger_id, deleted_at, date DESC, created_at DESC);
CREATE INDEX idx_transactions_ledger_updated ON transactions(ledger_id, updated_at);
CREATE INDEX idx_ledger_members_user ON ledger_members(user_id, removed_at);
CREATE INDEX idx_ledger_members_ledger ON ledger_members(ledger_id);
CREATE INDEX idx_ledger_events_ledger_id ON ledger_events(ledger_id, id);
CREATE INDEX idx_client_mutations_ledger ON client_mutations(ledger_id, expires_at);
CREATE INDEX idx_limit_history_ledger_date ON limit_history(ledger_id, effective_date);
CREATE INDEX idx_ledger_invites_code ON ledger_invites(code, revoked_at, expires_at);
CREATE INDEX idx_ledgers_owner ON ledgers(owner_id, deleted_at);
CREATE INDEX idx_refresh_sessions_user ON refresh_sessions(user_id, revoked_at);
