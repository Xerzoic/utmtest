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

-- Fixed monthly expenses
CREATE TABLE IF NOT EXISTS fixed_expenses (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT,
  due_day INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

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

-- Youth resilience extensions
CREATE TABLE IF NOT EXISTS user_segments (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  segment_type TEXT NOT NULL CHECK (segment_type IN ('student', 'intern', 'first_jobber', 'gig_worker')),
  confidence REAL DEFAULT 0.7,
  onboarding_answers TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resilience_scores (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  score_date TEXT NOT NULL DEFAULT (date('now')),
  score INTEGER NOT NULL,
  savings_rate REAL DEFAULT 0,
  emergency_runway_months REAL DEFAULT 0,
  debt_pressure REAL DEFAULT 0,
  spending_volatility REAL DEFAULT 0,
  consistency REAL DEFAULT 0,
  movement_reason TEXT,
  next_best_action TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resilience_user_date ON resilience_scores(user_id, score_date);

CREATE TABLE IF NOT EXISTS debt_risk_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  risk_type TEXT NOT NULL CHECK (risk_type IN ('bnpl', 'utilization', 'payday_signal', 'cashflow_shortfall')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  confidence REAL DEFAULT 0.5,
  trigger_context TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_debt_risks_user_active ON debt_risk_events(user_id, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS intervention_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  intervention_type TEXT NOT NULL,
  variant_key TEXT,
  channel TEXT DEFAULT 'in_app',
  status TEXT DEFAULT 'delivered',
  context TEXT,
  delivered_at TEXT DEFAULT (datetime('now')),
  viewed_at TEXT,
  accepted_at TEXT,
  outcome_d1 REAL,
  outcome_d7 REAL,
  outcome_d30 REAL
);
CREATE INDEX IF NOT EXISTS idx_intervention_logs_user ON intervention_logs(user_id, delivered_at DESC);

CREATE TABLE IF NOT EXISTS nudge_experiments (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  experiment_key TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  tone TEXT NOT NULL,
  delivery_hour INTEGER NOT NULL,
  fatigue_score REAL DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  accepted_count INTEGER DEFAULT 0,
  reward_score REAL DEFAULT 0,
  quiet_hours_start INTEGER DEFAULT 22,
  quiet_hours_end INTEGER DEFAULT 7,
  do_not_disturb INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nudge_exp_unique ON nudge_experiments(user_id, experiment_key, variant_key);

CREATE TABLE IF NOT EXISTS micro_learning_cards (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  cta_label TEXT,
  cta_action TEXT,
  is_completed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_micro_learning_user ON micro_learning_cards(user_id, is_completed, created_at DESC);

CREATE TABLE IF NOT EXISTS autopilot_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  mode_key TEXT NOT NULL CHECK (mode_key IN ('exam_month', 'internship_mode', 'first_salary_mode', 'gig_stability_mode')),
  rule_bundle TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS autopilot_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  is_active INTEGER DEFAULT 0,
  last_month_income REAL DEFAULT 0,
  emergency_fund_pct REAL DEFAULT 10,
  savings_goals_pct REAL DEFAULT 10,
  fixed_bills_monthly REAL DEFAULT 0,
  emergency_fund_goal REAL DEFAULT 15000,
  emergency_fund_current REAL DEFAULT 0,
  daily_spending_total REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS autopilot_daily_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  log_date TEXT NOT NULL,
  daily_limit REAL NOT NULL,
  spent REAL DEFAULT 0,
  rolled_over REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, log_date)
);

CREATE TABLE IF NOT EXISTS piggy_bank_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  source_txn_id TEXT REFERENCES transactions(id),
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS commitment_contracts (
  id TEXT PRIMARY KEY,
  group_id TEXT REFERENCES savings_groups(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  contract_type TEXT NOT NULL,
  stake_amount REAL DEFAULT 0,
  target_value REAL NOT NULL,
  due_date TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'cancelled')),
  resolution_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_commitment_contracts_group ON commitment_contracts(group_id, status, due_date);
`

module.exports = { SQL_SCHEMA: SQL_SCHEMA_PG }
