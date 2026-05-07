const db = require('./connection')

const TEST_USERS = [
  {
    id: 'test-user-0001',
    gxbank_account_id: 'GG-TEST-001',
    full_name: 'Test User One',
    email: 'test1@guga.test',
    phone: '+60199999001',
    monthly_income: 5000,
    risk_profile: 'moderate',
  },
  {
    id: 'test-user-0002',
    gxbank_account_id: 'GG-TEST-002',
    full_name: 'Test User Two',
    email: 'test2@guga.test',
    phone: '+60199999002',
    monthly_income: 3000,
    risk_profile: 'conservative',
  },
]

const TEST_GOALS = [
  { user_id: 'test-user-0001', name: 'Test Emergency Fund', target_amount: 15000, current_amount: 2000, category: 'emergency', icon: 'shield', priority: 'high' },
  { user_id: 'test-user-0001', name: 'Test Travel Goal', target_amount: 5000, current_amount: 500, category: 'travel', icon: 'plane', priority: 'medium' },
  { user_id: 'test-user-0002', name: 'Test Education Fund', target_amount: 10000, current_amount: 3000, category: 'education', icon: 'book', priority: 'high' },
]

const TEST_TRANSACTIONS = []
const categories = ['food', 'transport', 'shopping', 'entertainment', 'bills']
const merchants = ['GrabFood', 'Grab', 'Shopee', 'TGV Cinemas', 'TNB']

for (let day = 0; day < 60; day++) {
  const date = new Date()
  date.setDate(date.getDate() - day)

  for (const user of TEST_USERS) {
    const numTxns = Math.floor(Math.random() * 3) + 1

    for (let i = 0; i < numTxns; i++) {
      const catIndex = Math.floor(Math.random() * categories.length)
      const amount = (Math.random() * 100 + 5).toFixed(2)

      TEST_TRANSACTIONS.push({
        user_id: user.id,
        gxbank_txn_id: `TEST-TXN-${day}-${i}`,
        amount: parseFloat(amount),
        type: 'debit',
        category: categories[catIndex],
        merchant: merchants[catIndex],
        description: `Test transaction ${day}-${i}`,
        transaction_date: date.toISOString(),
        is_recurring: false,
      })
    }

    if (day === 0) {
      TEST_TRANSACTIONS.push({
        user_id: user.id,
        gxbank_txn_id: `TEST-SALARY-${day}`,
        amount: user.monthly_income,
        type: 'credit',
        category: 'salary',
        merchant: 'Test Employer',
        description: 'Monthly salary',
        transaction_date: date.toISOString(),
        is_recurring: true,
      })
    }
  }
}

const TEST_AUTOSAVE_RULES = [
  { user_id: 'test-user-0001', rule_type: 'round_up', config: { destination_goal_id: 'goal-emergency' }, total_saved: 150 },
  { user_id: 'test-user-0001', rule_type: 'salary_trigger', config: { percentage: 15, destination_goal_id: 'goal-travel' }, total_saved: 750 },
  { user_id: 'test-user-0002', rule_type: 'round_up', config: { destination_goal_id: 'goal-education' }, total_saved: 80 },
]

const TEST_BUDGETS = [
  { user_id: 'test-user-0001', category: 'food', monthly_limit: 600, current_spent: 280, period_month: new Date().getMonth() + 1, period_year: new Date().getFullYear() },
  { user_id: 'test-user-0001', category: 'transport', monthly_limit: 300, current_spent: 90, period_month: new Date().getMonth() + 1, period_year: new Date().getFullYear() },
  { user_id: 'test-user-0001', category: 'entertainment', monthly_limit: 200, current_spent: 180, period_month: new Date().getMonth() + 1, period_year: new Date().getFullYear() },
  { user_id: 'test-user-0002', category: 'food', monthly_limit: 400, current_spent: 150, period_month: new Date().getMonth() + 1, period_year: new Date().getFullYear() },
]

async function seedTestData() {
  try {
    console.log('Seeding test data...')

    for (const user of TEST_USERS) {
      await db.query(
        `INSERT INTO users (id, gxbank_account_id, full_name, email, phone, monthly_income, risk_profile)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [user.id, user.gxbank_account_id, user.full_name, user.email, user.phone, user.monthly_income, user.risk_profile]
      )
    }

    for (const goal of TEST_GOALS) {
      await db.query(
        `INSERT INTO goals (id, user_id, name, target_amount, current_amount, category, icon, priority)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [goal.user_id, goal.name, goal.target_amount, goal.current_amount, goal.category, goal.icon, goal.priority]
      )
    }

    for (const txn of TEST_TRANSACTIONS) {
      await db.query(
        `INSERT INTO transactions (id, user_id, gxbank_txn_id, amount, type, category, merchant, description, transaction_date, is_recurring)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [txn.user_id, txn.gxbank_txn_id, txn.amount, txn.type, txn.category, txn.merchant, txn.description, txn.transaction_date, txn.is_recurring]
      )
    }

    for (const rule of TEST_AUTOSAVE_RULES) {
      await db.query(
        `INSERT INTO autosave_rules (id, user_id, rule_type, config, is_active, total_saved)
         VALUES (gen_random_uuid(), $1, $2, $3, true, $4)`,
        [rule.user_id, rule.rule_type, JSON.stringify(rule.config), rule.total_saved]
      )
    }

    for (const budget of TEST_BUDGETS) {
      await db.query(
        `INSERT INTO budgets (user_id, category, monthly_limit, current_spent, period_month, period_year)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, category, period_month, period_year) DO UPDATE SET current_spent = $4`,
        [budget.user_id, budget.category, budget.monthly_limit, budget.current_spent, budget.period_month, budget.period_year]
      )
    }

    for (const user of TEST_USERS) {
      await db.query(
        `INSERT INTO savings_streaks (id, user_id, current_streak, longest_streak, last_save_date, streak_start_date)
         VALUES (gen_random_uuid(), $1, 5, 10, CURRENT_DATE, CURRENT_DATE - INTERVAL '5 days')
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id]
      )

      await db.query(
        `INSERT INTO gamification_profiles (id, user_id, xp, level, total_badges)
         VALUES (gen_random_uuid(), $1, 200, 2, 2)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id]
      )
    }

    console.log('Test data seeded successfully')
    await db.pool.end()
  } catch (error) {
    console.error('Test seeding failed:', error.message)
    process.exit(1)
  }
}

seedTestData()
