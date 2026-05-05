const config = require('../config')
const db = require('../database/connection')

class NudgeEngine {
  constructor() {
    this.nudgeTypes = {
      SPENDING_ALERT: 'spending_alert',
      STREAK_REMINDER: 'streak_reminder',
      STREAK_MILESTONE: 'streak_milestone',
      MILESTONE_REACHED: 'milestone_reached',
      AI_INSIGHT: 'ai_insight',
      GOAL_PROGRESS: 'goal_progress',
      SALARY_TRIGGER: 'salary_trigger',
      BUDGET_WARNING: 'budget_warning',
      SOCIAL_NUDGE: 'social_nudge',
      WEEKLY_RECAP: 'weekly_recap',
    }
  }

  async createNudge(userId, type, title, message, options = {}) {
    const { channel = 'push', priority = 'normal', context = {} } = options

    const result = await db.query(
      `INSERT INTO nudges (user_id, type, title, message, channel, priority, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, type, title, message, channel, priority, JSON.stringify(context)]
    )

    return result.rows[0]
  }

  async checkBudgetAlerts(userId) {
    const now = new Date()
    const budgets = await db.query(
      `SELECT * FROM budgets WHERE user_id = $1 AND period_month = $2 AND period_year = $3`,
      [userId, now.getMonth() + 1, now.getFullYear()]
    )

    const alerts = []
    for (const budget of budgets.rows) {
      const ratio = budget.current_spent / budget.monthly_limit

      if (ratio >= config.nudges.spendingAlertThreshold && ratio < 1) {
        const percent = Math.round(ratio * 100)
        const remaining = (budget.monthly_limit - budget.current_spent).toFixed(2)
        alerts.push(
          await this.createNudge(
            userId,
            this.nudgeTypes.BUDGET_WARNING,
            `${this.capitalize(budget.category)} Budget Alert`,
            `You've used ${percent}% of your ${budget.category} budget. RM${remaining} remaining this month.`,
            { priority: 'high', context: { category: budget.category, ratio, remaining } }
          )
        )
      } else if (ratio >= 1) {
        alerts.push(
          await this.createNudge(
            userId,
            this.nudgeTypes.SPENDING_ALERT,
            `${this.capitalize(budget.category)} Budget Exceeded`,
            `You've exceeded your ${budget.category} budget by RM${Math.abs(budget.monthly_limit - budget.current_spent).toFixed(2)}. Try to slow down for the rest of the month.`,
            { priority: 'urgent', context: { category: budget.category, exceeded: true } }
          )
        )
      }
    }

    return alerts
  }

  async checkStreakNudge(userId) {
    const streak = await db.query(
      `SELECT * FROM savings_streaks WHERE user_id = $1`,
      [userId]
    )

    if (!streak.rows.length) return null
    const { current_streak, last_save_date } = streak.rows[0]

    const lastSave = new Date(last_save_date)
    const hoursSinceLastSave = (Date.now() - lastSave.getTime()) / (1000 * 60 * 60)

    if (hoursSinceLastSave > config.nudges.streakReminderHours) {
      return await this.createNudge(
        userId,
        this.nudgeTypes.STREAK_REMINDER,
        "Don't Break Your Streak!",
        `You're on a ${current_streak}-day savings streak. Make a small save today to keep it going!`,
        { priority: 'high', context: { current_streak, hours_since_last: Math.round(hoursSinceLastSave) } }
      )
    }

    return null
  }

  async checkMilestoneReached(userId, newTotal) {
    const milestones = config.nudges.milestoneIntervals
    const reached = []

    for (const milestone of milestones) {
      if (newTotal >= milestone) {
        const existing = await db.query(
          `SELECT * FROM nudges WHERE user_id = $1 AND type = $2 AND context->>'milestone' = $3`,
          [userId, this.nudgeTypes.MILESTONE_REACHED, String(milestone)]
        )

        if (!existing.rows.length) {
          const nudge = await this.createNudge(
            userId,
            this.nudgeTypes.MILESTONE_REACHED,
            `Milestone Unlocked: RM${milestone.toLocaleString()}!`,
            this.getMilestoneMessage(milestone),
            {
              priority: 'high',
              context: { milestone, total: newTotal },
            }
          )
          reached.push(nudge)
        }
      }
    }

    return reached
  }

  async generateWeeklyRecap(userId) {
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)

    const weeklySavings = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as total_saved, COUNT(*) as save_count
       FROM autosave_transactions
       WHERE user_id = $1 AND executed_at >= $2`,
      [userId, weekAgo.toISOString()]
    )

    const weeklySpending = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as total_spent, COUNT(*) as txn_count
       FROM transactions
       WHERE user_id = $1 AND type = 'debit' AND transaction_date >= $2`,
      [userId, weekAgo.toISOString()]
    )

    const streak = await db.query(
      `SELECT current_streak FROM savings_streaks WHERE user_id = $1`,
      [userId]
    )

    const { total_saved, save_count } = weeklySavings.rows[0]
    const { total_spent, txn_count } = weeklySpending.rows[0]
    const currentStreak = streak.rows[0]?.current_streak || 0

    const netSavings = total_saved - total_spent
    const isPositive = netSavings > 0

    return await this.createNudge(
      userId,
      this.nudgeTypes.WEEKLY_RECAP,
      isPositive ? 'Great Week!' : 'Time to Refocus',
      isPositive
        ? `You saved RM${total_saved.toFixed(2)} across ${save_count} actions and spent RM${total_spent.toFixed(2)}. Net positive of RM${netSavings.toFixed(2)}! Streak: ${currentStreak} days.`
        : `You spent RM${total_spent.toFixed(2)} and saved RM${total_saved.toFixed(2)} this week. Try setting up auto-save to stay on track.`,
      { priority: 'normal', context: { total_saved, total_spent, net_savings: netSavings, current_streak: currentStreak } }
    )
  }

  getMilestoneMessage(milestone) {
    const messages = {
      500: "You've saved RM500! That's a solid start. Keep going!",
      1000: "RM1,000 milestone unlocked! You're building real momentum.",
      2500: "RM2,500 saved! You're proving that small habits compound.",
      5000: "RM5,000! Half an emergency fund for most Malaysians. Impressive!",
      10000: "RM10,000! You're in the top 15% of young Malaysian savers.",
      25000: "RM25,000! You could buy a car deposit or cover 8 months of expenses.",
      50000: "RM50,000! You've built serious financial security. Legendary!",
    }
    return messages[milestone] || `RM${milestone.toLocaleString()} milestone reached!`
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  async getUnreadNudges(userId) {
    const result = await db.query(
      `SELECT * FROM nudges WHERE user_id = $1 AND is_read = false ORDER BY delivered_at DESC LIMIT 20`,
      [userId]
    )
    return result.rows
  }

  async markNudgeRead(nudgeId) {
    return await db.query(
      `UPDATE nudges SET is_read = true WHERE id = $1`,
      [nudgeId]
    )
  }

  async runAllNudgeChecks(userId) {
    const results = {
      budgetAlerts: await this.checkBudgetAlerts(userId),
      streakNudge: await this.checkStreakNudge(userId),
    }
    return results
  }
}

module.exports = new NudgeEngine()
