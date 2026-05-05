const db = require('../database/connection')
const config = require('../config')
const nudgeEngine = require('./NudgeEngine')
const gamificationEngine = require('./GamificationEngine')

class AutoSaveEngine {
  constructor() {
    this.ruleTypes = {
      ROUND_UP: 'round_up',
      SALARY_TRIGGER: 'salary_trigger',
      FIXED_SCHEDULE: 'fixed_schedule',
      SPENDING_THRESHOLD: 'spending_threshold',
    }
  }

  async createRule(userId, ruleType, ruleConfig) {
    const result = await db.query(
      `INSERT INTO autosave_rules (user_id, rule_type, config, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING *`,
      [userId, ruleType, JSON.stringify(ruleConfig)]
    )

    const nudge = await nudgeEngine.createNudge(
      userId,
      nudgeEngine.nudgeTypes.AI_INSIGHT,
      'Auto-Save Activated',
      this.getActivationMessage(ruleType),
      { priority: 'normal', context: { rule_type: ruleType } }
    )

    return { rule: result.rows[0], nudge }
  }

  async executeRoundUp(transactionId) {
    const transaction = await db.query(
      `SELECT t.*, ar.id as rule_id, ar.config
       FROM transactions t
       JOIN autosave_rules ar ON ar.user_id = t.user_id AND ar.rule_type = 'round_up' AND ar.is_active = true
       WHERE t.id = $1`,
      [transactionId]
    )

    if (!transaction.rows.length) return null

    const txn = transaction.rows[0]
    const amount = parseFloat(txn.amount)
    const roundUp = Math.ceil(amount) - amount

    if (roundUp < 0.10) return null

    const balance = await this.getAccountBalance(txn.user_id)
    if (balance < roundUp + config.autosave.minBalanceBuffer) return null

    const config_parsed = typeof txn.config === 'string' ? JSON.parse(txn.config) : txn.config
    const goalId = config_parsed.destination_goal_id

    await db.query(
      `INSERT INTO autosave_transactions (user_id, rule_id, source_txn_id, amount, type)
       VALUES ($1, $2, $3, $4, 'round_up')`,
      [txn.user_id, txn.rule_id, transactionId, roundUp]
    )

    if (goalId) {
      await db.query(
        `UPDATE goals SET current_amount = current_amount + $1, updated_at = NOW() WHERE id = $2`,
        [roundUp, goalId]
      )
    }

    await db.query(
      `UPDATE autosave_rules SET total_saved = total_saved + $1, updated_at = NOW() WHERE id = $2`,
      [roundUp, txn.rule_id]
    )

    await this.updateStreak(txn.user_id)
    await gamificationEngine.awardSaveXP(txn.user_id, roundUp)

    return { amount: roundUp, source: txn.merchant, goalId }
  }

  async executeSalaryTrigger(userId) {
    const rules = await db.query(
      `SELECT * FROM autosave_rules WHERE user_id = $1 AND rule_type = 'salary_trigger' AND is_active = true`,
      [userId]
    )

    if (!rules.rows.length) return []

    const results = []
    const balance = await this.getAccountBalance(userId)
    const now = new Date()

    for (const rule of rules.rows) {
      const ruleConfig = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config
      const percentage = ruleConfig.percentage || config.autosave.salaryTriggerPercentage
      const salaryAmount = await this.getLastSalaryAmount(userId)

      if (!salaryAmount) continue

      const saveAmount = salaryAmount * percentage

      if (balance < saveAmount + config.autosave.minBalanceBuffer) continue
      if (saveAmount > config.autosave.maxDailyAutoSave) continue

      await db.query(
        `INSERT INTO autosave_transactions (user_id, rule_id, amount, type)
         VALUES ($1, $2, $3, 'salary_trigger')`,
        [userId, rule.id, saveAmount]
      )

      if (ruleConfig.destination_goal_id) {
        await db.query(
          `UPDATE goals SET current_amount = current_amount + $1, updated_at = NOW() WHERE id = $2`,
          [saveAmount, ruleConfig.destination_goal_id]
        )
      }

      await db.query(
        `UPDATE autosave_rules SET total_saved = total_saved + $1, updated_at = NOW() WHERE id = $2`,
        [saveAmount, rule.id]
      )

      await nudgeEngine.createNudge(
        userId,
        nudgeEngine.nudgeTypes.SALARY_TRIGGER,
        'Salary Auto-Save Executed',
        `RM${saveAmount.toFixed(2)} (${(percentage * 100).toFixed(0)}% of salary) has been moved to your savings.`,
        { priority: 'normal', context: { amount: saveAmount, percentage } }
      )

      await this.updateStreak(userId)
      await gamificationEngine.awardSaveXP(userId, saveAmount)

      results.push({ amount: saveAmount, percentage })
    }

    return results
  }

  async executeFixedSchedule(userId) {
    const rules = await db.query(
      `SELECT * FROM autosave_rules WHERE user_id = $1 AND rule_type = 'fixed_schedule' AND is_active = true`,
      [userId]
    )

    const results = []
    const balance = await this.getAccountBalance(userId)

    for (const rule of rules.rows) {
      const ruleConfig = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config
      const saveAmount = ruleConfig.amount

      if (balance < saveAmount + config.autosave.minBalanceBuffer) continue

      await db.query(
        `INSERT INTO autosave_transactions (user_id, rule_id, amount, type)
         VALUES ($1, $2, $3, 'fixed_schedule')`,
        [userId, rule.id, saveAmount]
      )

      if (ruleConfig.destination_goal_id) {
        await db.query(
          `UPDATE goals SET current_amount = current_amount + $1, updated_at = NOW() WHERE id = $2`,
          [saveAmount, ruleConfig.destination_goal_id]
        )
      }

      await db.query(
        `UPDATE autosave_rules SET total_saved = total_saved + $1, updated_at = NOW() WHERE id = $2`,
        [saveAmount, rule.id]
      )

      await this.updateStreak(userId)
      await gamificationEngine.awardSaveXP(userId, saveAmount)

      results.push({ amount: saveAmount })
    }

    return results
  }

  async updateStreak(userId) {
    const today = new Date().toISOString().split('T')[0]

    const streak = await db.query(
      `SELECT * FROM savings_streaks WHERE user_id = $1`,
      [userId]
    )

    if (!streak.rows.length) {
      await db.query(
        `INSERT INTO savings_streaks (user_id, current_streak, longest_streak, last_save_date, streak_start_date)
         VALUES ($1, 1, 1, $2, $2)`,
        [userId, today]
      )

      await nudgeEngine.createNudge(
        userId,
        nudgeEngine.nudgeTypes.STREAK_MILESTONE,
        'First Save Complete!',
        'Your savings journey begins today. Every small step counts!',
        { priority: 'high' }
      )

      return { current_streak: 1, isNew: true }
    }

    const { current_streak, longest_streak, last_save_date } = streak.rows[0]
    const lastDate = new Date(last_save_date)
    const todayDate = new Date(today)
    const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24))

    let newStreak
    let newLongest = longest_streak

    if (diffDays === 0) {
      return { current_streak, isNew: false }
    } else if (diffDays === 1) {
      newStreak = current_streak + 1
      if (newStreak > newLongest) newLongest = newStreak
    } else {
      newStreak = 1
    }

    await db.query(
      `UPDATE savings_streaks
       SET current_streak = $1, longest_streak = $2, last_save_date = $3, updated_at = NOW()
       WHERE user_id = $4`,
      [newStreak, newLongest, today, userId]
    )

    if (newStreak === 7) {
      await nudgeEngine.createNudge(
        userId,
        nudgeEngine.nudgeTypes.STREAK_MILESTONE,
        '7-Day Streak!',
        'A full week of consistent saving! You\'re building a real habit.',
        { priority: 'high' }
      )
      await gamificationEngine.awardBadge(userId, 'streak_7', 'Week Warrior', 'Saved 7 days in a row', 'fire')
    } else if (newStreak === 21) {
      await nudgeEngine.createNudge(
        userId,
        nudgeEngine.nudgeTypes.STREAK_MILESTONE,
        '21-Day Streak - Habit Formed!',
        'Science says it takes 21 days to build a habit. You\'ve done it!',
        { priority: 'high' }
      )
      await gamificationEngine.awardBadge(userId, 'streak_21', 'Habit Master', '21-day savings streak', 'crown')
    } else if (newStreak === 30) {
      await nudgeEngine.createNudge(
        userId,
        nudgeEngine.nudgeTypes.STREAK_MILESTONE,
        '30-Day Streak!',
        'One full month of daily saving. You\'re a savings machine!',
        { priority: 'high' }
      )
      await gamificationEngine.awardBadge(userId, 'streak_30', 'Monthly Champion', '30-day savings streak', 'diamond')
    }

    return { current_streak: newStreak, isNew: diffDays !== 0 }
  }

  async getAccountBalance(userId) {
    const result = await db.query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 5000) as balance
       FROM transactions WHERE user_id = $1`,
      [userId]
    )
    return parseFloat(result.rows[0].balance)
  }

  async getLastSalaryAmount(userId) {
    const result = await db.query(
      `SELECT amount FROM transactions
       WHERE user_id = $1 AND type = 'credit' AND category = 'salary'
       ORDER BY transaction_date DESC LIMIT 1`,
      [userId]
    )
    return result.rows.length ? parseFloat(result.rows[0].amount) : null
  }

  getActivationMessage(ruleType) {
    const messages = {
      round_up: 'Round-up savings activated! Every purchase now contributes to your goals.',
      salary_trigger: 'Salary-triggered savings set up! A portion of each salary goes straight to savings.',
      fixed_schedule: 'Scheduled savings activated! Your automatic savings are running.',
      spending_threshold: 'Spending-triggered savings activated! Smart saves when you underspend.',
    }
    return messages[ruleType] || 'Auto-save activated!'
  }
}

module.exports = new AutoSaveEngine()
