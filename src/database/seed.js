const { v4: uuidv4 } = require('uuid')
const db = require('./connection')

function uid() {
  return uuidv4()
}

const SEED_DATA = {
  users: [
    {
      id: uid(),
      gxbank_account_id: 'GG001234567',
      full_name: 'Aisha Rahman',
      email: 'aisha.rahman@email.com',
      phone: '+60123456789',
      date_of_birth: '1998-03-15',
      monthly_income: 4500,
      risk_profile: 'moderate',
    },
    {
      id: uid(),
      gxbank_account_id: 'GG001234568',
      full_name: 'Muhammad Hakim',
      email: 'hakim@email.com',
      phone: '+60123456790',
      date_of_birth: '1995-07-22',
      monthly_income: 6000,
      risk_profile: 'aggressive',
    },
    {
      id: uid(),
      gxbank_account_id: 'GG001234569',
      full_name: 'Lim Wei Ling',
      email: 'weiling@email.com',
      phone: '+60123456791',
      date_of_birth: '2000-01-10',
      monthly_income: 3500,
      risk_profile: 'conservative',
    },
  ],
}

async function seed() {
  try {
    console.log('Seeding database with SQLite...')

    await db.query('DELETE FROM group_commitments')
    await db.query('DELETE FROM group_members')
    await db.query('DELETE FROM savings_groups')
    await db.query('DELETE FROM ai_insights')
    await db.query('DELETE FROM autosave_transactions')
    await db.query('DELETE FROM autosave_rules')
    await db.query('DELETE FROM budgets')
    await db.query('DELETE FROM nudges')
    await db.query('DELETE FROM badges')
    await db.query('DELETE FROM gamification_profiles')
    await db.query('DELETE FROM savings_streaks')
    await db.query('DELETE FROM goals')
    await db.query('DELETE FROM transactions')
    await db.query('DELETE FROM users')

    console.log('  Cleared existing data')

    const u1 = SEED_DATA.users[0]
    const u2 = SEED_DATA.users[1]
    const u3 = SEED_DATA.users[2]

    for (const user of SEED_DATA.users) {
      await db.query(
        `INSERT INTO users (id, gxbank_account_id, full_name, email, phone, date_of_birth, monthly_income, risk_profile)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [user.id, user.gxbank_account_id, user.full_name, user.email, user.phone, user.date_of_birth, user.monthly_income, user.risk_profile]
      )
    }
    console.log('  Seeded 3 users')

    const npcs = [
      { name: 'Siti Bot', email: 'siti.npc@guga.ai', income: 4000 },
      { name: 'Raj Saver', email: 'raj.npc@guga.ai', income: 5500 },
      { name: 'Yuki Finance', email: 'yuki.npc@guga.ai', income: 3500 },
      { name: 'Ali Budget', email: 'ali.npc@guga.ai', income: 5000 },
      { name: 'Mei Savings', email: 'mei.npc@guga.ai', income: 4500 },
    ]
    const npcIds = []
    for (const n of npcs) {
      const nid = uid()
      npcIds.push(nid)
      await db.query(
        `INSERT INTO users (id, gxbank_account_id, full_name, email, phone, monthly_income, risk_profile, is_npc)
         VALUES ($1, $2, $3, $4, $5, $6, 'moderate', 1)`,
        [nid, 'NPC-' + nid.substring(0, 8), n.name, n.email, '+60' + Math.floor(100000000 + Math.random() * 900000000), n.income]
      )
    }
    console.log('  Seeded 5 NPC users')

    const goalIds = {
      emergency: uid(),
      travel: uid(),
      car: uid(),
      macbook: uid(),
    }

    await db.query(
      `INSERT INTO goals (id, user_id, name, target_amount, current_amount, deadline, category, icon, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [goalIds.emergency, u1.id, 'Emergency Fund', 13500, 4200, '2027-03-15', 'emergency', 'shield', 'high']
    )
    await db.query(
      `INSERT INTO goals (id, user_id, name, target_amount, current_amount, deadline, category, icon, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [goalIds.travel, u1.id, 'Japan Trip', 8000, 1500, '2026-12-01', 'travel', 'plane', 'medium']
    )
    await db.query(
      `INSERT INTO goals (id, user_id, name, target_amount, current_amount, deadline, category, icon, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [goalIds.car, u2.id, 'Car Down Payment', 30000, 8500, '2027-06-01', 'vehicle', 'car', 'high']
    )
    await db.query(
      `INSERT INTO goals (id, user_id, name, target_amount, current_amount, deadline, category, icon, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [goalIds.macbook, u3.id, 'MacBook Pro', 9000, 3200, '2026-09-01', 'electronics', 'laptop', 'medium']
    )
    console.log('  Seeded 4 goals')

    const txns = [
      [u1.id, 'TXN-20260501-001', 15.50, 'debit', 'food', 'GrabFood', 'Lunch order - Nasi Lemak', '2026-05-01T12:30:00', 0],
      [u1.id, 'TXN-20260501-002', 2500, 'credit', 'salary', 'Tech Solutions Sdn Bhd', 'Monthly salary', '2026-05-01T00:00:00', 1],
      [u1.id, 'TXN-20260502-001', 45.00, 'debit', 'transport', 'Grab', 'Ride to office', '2026-05-02T08:15:00', 0],
      [u1.id, 'TXN-20260502-002', 89.90, 'debit', 'shopping', 'Shopee', 'Skincare products', '2026-05-02T20:00:00', 0],
      [u1.id, 'TXN-20260503-001', 12.00, 'debit', 'food', 'Teh Tarik Corner', 'Breakfast', '2026-05-03T07:45:00', 0],
      [u1.id, 'TXN-20260503-002', 150.00, 'debit', 'entertainment', 'TGV Cinemas', 'Movie tickets x3', '2026-05-03T19:00:00', 0],
      [u1.id, 'TXN-20260504-001', 35.00, 'debit', 'food', 'Foodpanda', 'Dinner delivery', '2026-05-04T19:30:00', 0],
      [u2.id, 'TXN-20260501-003', 3500, 'credit', 'salary', 'Digital Agency Sdn Bhd', 'Monthly salary', '2026-05-01T00:00:00', 1],
      [u2.id, 'TXN-20260502-003', 200.00, 'debit', 'shopping', 'Zalora', 'New shoes', '2026-05-02T15:00:00', 0],
      [u3.id, 'TXN-20260501-004', 1800, 'credit', 'salary', 'Freelance Client', 'Design project payment', '2026-05-01T00:00:00', 0],
    ]

    for (const t of txns) {
      await db.query(
        `INSERT INTO transactions (id, user_id, gxbank_txn_id, amount, type, category, merchant, description, transaction_date, is_recurring)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [uid(), ...t]
      )
    }
    console.log(`  Seeded ${txns.length} transactions`)

    await db.query(
      `INSERT INTO autosave_rules (id, user_id, rule_type, is_active, config, total_saved)
       VALUES ($1, $2, $3, 1, $4, $5)`,
      [uid(), u1.id, 'round_up', JSON.stringify({ destination_goal_id: goalIds.emergency }), 320.50]
    )
    await db.query(
      `INSERT INTO autosave_rules (id, user_id, rule_type, is_active, config, total_saved)
       VALUES ($1, $2, $3, 1, $4, $5)`,
      [uid(), u1.id, 'salary_trigger', JSON.stringify({ percentage: 15, destination_goal_id: goalIds.travel }), 1500.00]
    )
    await db.query(
      `INSERT INTO autosave_rules (id, user_id, rule_type, is_active, config, total_saved)
       VALUES ($1, $2, $3, 1, $4, $5)`,
      [uid(), u2.id, 'round_up', JSON.stringify({ destination_goal_id: goalIds.car }), 850.00]
    )
    console.log('  Seeded 3 autosave rules')

    await db.query(
      `INSERT INTO savings_streaks (id, user_id, current_streak, longest_streak, last_save_date, streak_start_date)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uid(), u1.id, 12, 18, '2026-05-04', '2026-04-23']
    )
    await db.query(
      `INSERT INTO savings_streaks (id, user_id, current_streak, longest_streak, last_save_date, streak_start_date)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uid(), u2.id, 5, 14, '2026-05-03', '2026-04-29']
    )
    await db.query(
      `INSERT INTO savings_streaks (id, user_id, current_streak, longest_streak, last_save_date, streak_start_date)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uid(), u3.id, 21, 21, '2026-05-04', '2026-04-14']
    )
    console.log('  Seeded savings streaks')

    await db.query(
      `INSERT INTO gamification_profiles (id, user_id, xp, level, total_badges)
       VALUES ($1, $2, $3, $4, $5)`,
      [uid(), u1.id, 680, 4, 5]
    )
    await db.query(
      `INSERT INTO gamification_profiles (id, user_id, xp, level, total_badges)
       VALUES ($1, $2, $3, $4, $5)`,
      [uid(), u2.id, 420, 3, 3]
    )
    await db.query(
      `INSERT INTO gamification_profiles (id, user_id, xp, level, total_badges)
       VALUES ($1, $2, $3, $4, $5)`,
      [uid(), u3.id, 1150, 5, 8]
    )
    console.log('  Seeded gamification profiles')

    await db.query(
      `INSERT INTO badges (id, user_id, badge_key, badge_name, badge_description, badge_icon)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uid(), u1.id, 'first_save', 'First Step', 'Made your first automated save', 'star']
    )
    await db.query(
      `INSERT INTO badges (id, user_id, badge_key, badge_name, badge_description, badge_icon)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uid(), u1.id, 'streak_7', 'Week Warrior', 'Saved 7 days in a row', 'fire']
    )
    await db.query(
      `INSERT INTO badges (id, user_id, badge_key, badge_name, badge_description, badge_icon)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uid(), u1.id, 'milestone_1000', 'Grand RM1K', 'Reached RM1,000 in savings', 'trophy']
    )
    await db.query(
      `INSERT INTO badges (id, user_id, badge_key, badge_name, badge_description, badge_icon)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uid(), u3.id, 'streak_21', 'Habit Master', '21-day savings streak', 'crown']
    )
    console.log('  Seeded 4 badges')

    await db.query(
      `INSERT INTO budgets (id, user_id, category, monthly_limit, current_spent, period_month, period_year)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uid(), u1.id, 'food', 600, 107.40, 5, 2026]
    )
    await db.query(
      `INSERT INTO budgets (id, user_id, category, monthly_limit, current_spent, period_month, period_year)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uid(), u1.id, 'transport', 300, 45.00, 5, 2026]
    )
    await db.query(
      `INSERT INTO budgets (id, user_id, category, monthly_limit, current_spent, period_month, period_year)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uid(), u1.id, 'shopping', 400, 89.90, 5, 2026]
    )
    await db.query(
      `INSERT INTO budgets (id, user_id, category, monthly_limit, current_spent, period_month, period_year)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uid(), u1.id, 'entertainment', 200, 150.00, 5, 2026]
    )
    console.log('  Seeded 4 budgets')

    await db.query(
      `INSERT INTO nudges (id, user_id, type, title, message, channel, priority, is_read, is_actioned)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [uid(), u1.id, 'spending_alert', 'Entertainment Budget Warning',
       "You've used 75% of your entertainment budget (RM150/RM200). Consider a free activity this weekend!",
       'push', 'high', 0, 0]
    )
    await db.query(
      `INSERT INTO nudges (id, user_id, type, title, message, channel, priority, is_read, is_actioned)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [uid(), u1.id, 'streak_milestone', '12-Day Streak!',
       "Amazing! You've saved for 12 days straight. Your emergency fund is growing steadily!",
       'push', 'normal', 1, 1]
    )
    await db.query(
      `INSERT INTO nudges (id, user_id, type, title, message, channel, priority, is_read, is_actioned)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [uid(), u1.id, 'ai_insight', 'Personalised Tip',
       'Your food delivery spending is 30% above average. Cooking at home 2 more days/week could save you ~RM120/month.',
       'in_app', 'normal', 0, 0]
    )
    const moreNudges = [
      { type: 'goal_progress', title: 'Emergency Fund Progress', message: 'Your emergency fund is 31% complete (RM4,200/RM13,500). Stay consistent!', priority: 'normal' },
      { type: 'salary_trigger', title: 'Salary Auto-Save Done', message: 'RM375 (15%) has been moved from your salary to Japan Trip savings.', priority: 'normal' },
      { type: 'social_nudge', title: 'Group Activity', message: 'Budget Warriors has a new member! Check out the leaderboard.', priority: 'normal' },
      { type: 'ai_insight', title: 'Weekend Spending Pattern', message: 'You spend 40% more on weekends. Try setting a weekend-only budget of RM100.', priority: 'high' },
      { type: 'weekly_recap', title: 'Weekly Recap', message: 'This week: saved RM125, spent RM347. Net positive RM125! Streak: 12 days.', priority: 'normal' },
    ]
    for (const n of moreNudges) {
      await db.query(
        `INSERT INTO nudges (id, user_id, type, title, message, channel, priority, is_read)
         VALUES ($1, $2, $3, $4, $5, 'push', $6, 0)`,
        [uid(), u1.id, n.type, n.title, n.message, n.priority]
      )
    }
    console.log('  Seeded 5 more nudges for u1')

    const u2Nudges = [
      { type: 'goal_progress', title: 'Car Down Payment Progress', message: 'Your car fund is 28% complete (RM8,500/RM30,000). Keep going!', priority: 'normal' },
      { type: 'weekly_recap', title: 'Weekly Recap', message: 'This week: saved RM85, spent RM520. Try to reduce spending.', priority: 'high' },
    ]
    for (const n of u2Nudges) {
      await db.query(
        `INSERT INTO nudges (id, user_id, type, title, message, channel, priority, is_read)
         VALUES ($1, $2, $3, $4, $5, 'push', $6, 0)`,
        [uid(), u2.id, n.type, n.title, n.message, n.priority]
      )
    }
    console.log('  Seeded 2 nudges for u2')

    const u3Nudges = [
      { type: 'streak_milestone', title: '21-Day Streak!', message: 'Amazing! You have maintained a 21-day savings streak. Habit formed!', priority: 'normal' },
      { type: 'goal_progress', title: 'MacBook Pro Progress', message: 'Your MacBook fund is 36% complete (RM3,200/RM9,000). Almost a third!', priority: 'normal' },
    ]
    for (const n of u3Nudges) {
      await db.query(
        `INSERT INTO nudges (id, user_id, type, title, message, channel, priority, is_read)
         VALUES ($1, $2, $3, $4, $5, 'push', $6, 0)`,
        [uid(), u3.id, n.type, n.title, n.message, n.priority]
      )
    }
    console.log('  Seeded 2 nudges for u3')

    const dummyGroups = [
      { name: 'Budget Warriors', description: 'Emergency savings clan — we save for rainy days together!', goal_type: 'emergency', target_amount: 5000 },
      { name: 'RM10K Racers', description: 'Race to RM10K in savings. First one there buys coffee!', goal_type: 'other', target_amount: 10000 },
      { name: 'Zero Spend Squad', description: 'Minimize daily spending and hit zero-spend days together', goal_type: 'other', target_amount: null },
      { name: 'Gig Savers', description: 'For freelancers — save 20% of every gig payment', goal_type: 'emergency', target_amount: 3000 },
      { name: 'Student Stackers', description: 'Student-friendly saving group. Every ringgit counts!', goal_type: 'other', target_amount: 1000 },
    ]
    for (const g of dummyGroups) {
      const gid = uid()
      await db.query(
        `INSERT INTO savings_groups (id, name, description, created_by, goal_type, target_amount)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [gid, g.name, g.description, u1.id, g.goal_type, g.target_amount]
      )
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')`,
        [gid, u1.id]
      )
    }
    console.log('  Seeded 5 dummy groups')

    const allGroupIds = await db.query(`SELECT id FROM savings_groups`)
    const groupIds = allGroupIds.rows.map(r => r.id)
    for (const nid of npcIds) {
      const shuffled = [...groupIds].sort(() => Math.random() - 0.5)
      const assignTo = shuffled.slice(0, 2 + Math.floor(Math.random() * 2))
      for (const gid of assignTo) {
        await db.query(
          `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
          [gid, nid]
        )
      }
    }
    console.log('  Added NPCs to groups')

    for (const gid of groupIds) {
      const groupMembers = await db.query(
        `SELECT u.id, u.full_name FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = $1 AND u.is_npc = 1`,
        [gid]
      )
      for (const member of groupMembers.rows) {
        await db.query(
          `INSERT INTO group_messages (id, group_id, user_id, message)
           VALUES (gen_random_uuid(), $1, $2, $3)`,
          [gid, member.id, 'Hey everyone! Just saved another RM10 today. Small steps! 💪']
        )
      }
    }
    console.log('  Seeded NPC chat messages')

    for (const nid of npcIds) {
      const xp = Math.floor(Math.random() * 500) + 100
      const level = Math.floor(xp / 200) + 1
      const totalB = Math.min(level, 3)
      await db.query(
        `INSERT INTO gamification_profiles (id, user_id, xp, level, total_badges)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [nid, xp, level, totalB]
      )
      await db.query(
        `INSERT INTO savings_streaks (id, user_id, current_streak, longest_streak, last_save_date)
         VALUES (gen_random_uuid(), $1, $2, $3, date('now'))`,
        [nid, Math.floor(Math.random() * 10) + 1, Math.floor(Math.random() * 20) + 5]
      )
    }
    console.log('  Seeded NPC gamification profiles and streaks')

    console.log('\nDatabase seeded successfully!')
    console.log(`\nDemo user: ${u1.full_name} (${u1.email})`)
    console.log(`Total saved: RM 5,700 across 2 goals`)
    console.log(`Current streak: 12 days (best: 18)`)

    await db.pool.end()
  } catch (error) {
    console.error('Seeding failed:', error.message)
    process.exit(1)
  }
}

seed()
