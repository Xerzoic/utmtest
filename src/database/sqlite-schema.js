const SQL_SCHEMA_PG = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  gxbank_account_id TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  date_of_birth TEXT,
  monthly_income REAL,
  risk_profile TEXT DEFAULT 'moderate',
  is_npc INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Financial goals
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_amount REAL NOT NULL,
  current_amount REAL DEFAULT 0,
  deadline TEXT,
  category TEXT,
  icon TEXT,
  priority TEXT DEFAULT 'medium',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  gxbank_txn_id TEXT UNIQUE NOT NULL,
  amount REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('debit', 'credit')),
  category TEXT,
  merchant TEXT,
  description TEXT,
  transaction_date TEXT NOT NULL,
  is_recurring INTEGER DEFAULT 0,
  ai_analysis TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Automated savings rules
CREATE TABLE IF NOT EXISTS autosave_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('round_up', 'salary_trigger', 'fixed_schedule', 'spending_threshold')),
  is_active INTEGER DEFAULT 1,
  config TEXT NOT NULL,
  total_saved REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Auto-save transactions log
CREATE TABLE IF NOT EXISTS autosave_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  rule_id TEXT REFERENCES autosave_rules(id),
  source_txn_id TEXT REFERENCES transactions(id),
  amount REAL NOT NULL,
  type TEXT,
  status TEXT DEFAULT 'completed',
  executed_at TEXT DEFAULT (datetime('now'))
);

-- Nudge delivery log
CREATE TABLE IF NOT EXISTS nudges (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  channel TEXT DEFAULT 'push',
  priority TEXT DEFAULT 'normal',
  context TEXT,
  is_read INTEGER DEFAULT 0,
  is_actioned INTEGER DEFAULT 0,
  delivered_at TEXT DEFAULT (datetime('now')),
  actioned_at TEXT
);

-- Savings streaks
CREATE TABLE IF NOT EXISTS savings_streaks (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_save_date TEXT,
  streak_start_date TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Gamification: user profiles
CREATE TABLE IF NOT EXISTS gamification_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  total_badges INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Badges earned
CREATE TABLE IF NOT EXISTS badges (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  badge_key TEXT NOT NULL,
  badge_name TEXT NOT NULL,
  badge_description TEXT,
  badge_icon TEXT,
  earned_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_badges_user_key ON badges(user_id, badge_key);

-- Social savings groups
CREATE TABLE IF NOT EXISTS savings_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT REFERENCES users(id),
  goal_type TEXT,
  target_amount REAL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Group memberships
CREATE TABLE IF NOT EXISTS group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT REFERENCES savings_groups(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  joined_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_unique ON group_members(group_id, user_id);

-- Group commitments
CREATE TABLE IF NOT EXISTS group_commitments (
  id TEXT PRIMARY KEY,
  group_id TEXT REFERENCES savings_groups(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  commitment_type TEXT,
  target_amount REAL,
  deadline TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Spending budgets
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  monthly_limit REAL NOT NULL,
  current_spent REAL DEFAULT 0,
  period_month INTEGER,
  period_year INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_unique ON budgets(user_id, category, period_month, period_year);

-- AI insights cache
CREATE TABLE IF NOT EXISTS ai_insights (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL,
  content TEXT NOT NULL,
  generated_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_unique ON ai_insights(user_id, insight_type);

CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_nudges_user_unread ON nudges(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_goals_user_active ON goals(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_autosave_rules_user ON autosave_rules(user_id, is_active);

-- Daily expenditure submissions
CREATE TABLE IF NOT EXISTS daily_expenditures (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  category TEXT NOT NULL,
  note TEXT,
  expenditure_date TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_daily_expenditures_user_date
  ON daily_expenditures(user_id, expenditure_date DESC);

CREATE TABLE IF NOT EXISTS daily_quests (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  quest_key TEXT NOT NULL,
  quest_title TEXT NOT NULL,
  quest_description TEXT NOT NULL,
  xp_reward INTEGER NOT NULL,
  target_value REAL,
  current_value REAL DEFAULT 0,
  is_completed INTEGER DEFAULT 0,
  quest_date TEXT NOT NULL DEFAULT (date('now')),
  completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quests_user_key_date ON daily_quests(user_id, quest_key, quest_date);

CREATE TABLE IF NOT EXISTS group_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT REFERENCES savings_groups(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  sent_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_group_messages ON group_messages(group_id, sent_at DESC);
`

module.exports = { SQL_SCHEMA: SQL_SCHEMA_PG }
