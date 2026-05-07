const db = require('../database/connection')
const aiEngine = require('../services/AIEngine')
const nudgeEngine = require('../services/NudgeEngine')
const autoSaveEngine = require('../services/AutoSaveEngine')
const gamificationEngine = require('../services/GamificationEngine')

class DashboardController {
  async getDashboard(req, res) {
    try {
      const userId = req.user.id

      const [user, goals, streak, profile, budgets, recentNudges, autoSaveSummary] = await Promise.all([
        db.query(`SELECT id, full_name, email, monthly_income, risk_profile FROM users WHERE id = $1`, [userId]),
        db.query(`SELECT * FROM goals WHERE user_id = $1 AND is_active = true ORDER BY priority`, [userId]),
        db.query(`SELECT * FROM savings_streaks WHERE user_id = $1`, [userId]),
        db.query(`SELECT xp, level, total_badges FROM gamification_profiles WHERE user_id = $1`, [userId]),
        db.query(`SELECT * FROM budgets WHERE user_id = $1 AND period_month = EXTRACT(MONTH FROM NOW()) AND period_year = EXTRACT(YEAR FROM NOW())`, [userId]),
        db.query(`SELECT * FROM nudges WHERE user_id = $1 AND is_read = false ORDER BY delivered_at DESC LIMIT 5`, [userId]),
        db.query(`SELECT COALESCE(SUM(total_saved), 0) as total_auto_saved, COUNT(*) as rule_count FROM autosave_rules WHERE user_id = $1 AND is_active = true`, [userId]),
      ])

      if (!user.rows.length) {
        return res.status(404).json({ error: 'User not found' })
      }

      const monthlySpending = await db.query(
        `SELECT category, COALESCE(SUM(amount), 0) as total
         FROM transactions
         WHERE user_id = $1 AND type = 'debit'
         AND EXTRACT(MONTH FROM transaction_date) = EXTRACT(MONTH FROM NOW())
         AND EXTRACT(YEAR FROM transaction_date) = EXTRACT(YEAR FROM NOW())
         GROUP BY category
         ORDER BY total DESC`,
        [userId]
      )

      const totalSavings = await db.query(
        `SELECT COALESCE(SUM(current_amount), 0) AS sum FROM goals WHERE user_id = $1 AND is_active = true`,
        [userId]
      )

      res.json({
        user: user.rows[0],
        goals: goals.rows,
        streak: streak.rows[0] || { current_streak: 0, longest_streak: 0 },
        gamification: profile.rows[0] || { xp: 0, level: 1, total_badges: 0 },
        budgets: budgets.rows,
        monthlySpending: monthlySpending.rows,
        totalSavings: parseFloat(totalSavings.rows[0].sum),
        unreadNudges: recentNudges.rows,
        autoSaveSummary: autoSaveSummary.rows[0],
      })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getAIInsights(req, res) {
    try {
      const userId = req.user.id

      const cached = await db.query(
        `SELECT * FROM ai_insights WHERE user_id = $1 AND insight_type = 'full_analysis' AND expires_at > datetime('now')`,
        [userId]
      )

      if (cached.rows.length) {
        const parsed = JSON.parse(cached.rows[0].content)
        return res.json({ ...parsed, cached: true })
      }

      const insights = await aiEngine.generatePersonalisedInsights(userId)
      res.json({ ...insights, cached: false })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getGoals(req, res) {
    try {
      const userId = req.user.id
      const goals = await db.query(
        `SELECT g.*,
                CASE WHEN g.target_amount > 0 THEN ROUND((g.current_amount / g.target_amount * 100), 1) ELSE 0 END as progress_percent,
                CASE WHEN g.deadline IS NOT NULL
                  THEN ROUND((g.target_amount - g.current_amount) / CASE WHEN (julianday(g.deadline) - julianday('now')) / 30 = 0 THEN NULL ELSE (julianday(g.deadline) - julianday('now')) / 30 END, 2)
                  ELSE NULL
                END as monthly_required
         FROM goals g WHERE g.user_id = $1 ORDER BY g.priority, g.created_at`,
        [userId]
      )
      res.json(goals.rows)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async createGoal(req, res) {
    try {
      const userId = req.user.id
      const { name, target_amount, deadline, category, icon, priority } = req.body

      const result = await db.query(
        `INSERT INTO goals (user_id, name, target_amount, deadline, category, icon, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [userId, name, target_amount, deadline, category, icon || 'target', priority || 'medium']
      )

      await db.query(
        `UPDATE gamification_profiles SET xp = xp + 50, updated_at = NOW() WHERE user_id = $1`,
        [userId]
      )

      const badgeEarned = await gamificationEngine.checkAllBadges(userId)
      const response = result.rows[0]
      response.xpGained = 50
      if (badgeEarned?.length > 0) {
        response.badgeEarned = badgeEarned[0]
      }

      res.status(201).json(response)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getTransactions(req, res) {
    try {
      const userId = req.user.id
      const { category, limit = 50, offset = 0 } = req.query

      let query = `SELECT * FROM transactions WHERE user_id = $1`
      const params = [userId]

      if (category) {
        query += ` AND category = $${params.length + 1}`
        params.push(category)
      }

      query += ` ORDER BY transaction_date DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
      params.push(parseInt(limit), parseInt(offset))

      const result = await db.query(query, params)
      res.json(result.rows)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async addTransaction(req, res) {
    try {
      const userId = req.user.id
      const { amount, type, category, merchant, description, transaction_date, is_recurring } = req.body

      const txnCategory = category || await aiEngine.categoriseTransaction({ merchant, description })

      const result = await db.query(
        `INSERT INTO transactions (user_id, gxbank_txn_id, amount, type, category, merchant, description, transaction_date, is_recurring)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [userId, `TXN-${Date.now()}`, amount, type, txnCategory, merchant, description, transaction_date || new Date(), is_recurring || false]
      )

      const txn = result.rows[0]

      if (type === 'debit') {
        await autoSaveEngine.executeRoundUp(txn.id)
        await nudgeEngine.checkBudgetAlerts(userId)
      }

      res.status(201).json(txn)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getAutoSaveRules(req, res) {
    try {
      const userId = req.user.id
      const rules = await db.query(
        `SELECT * FROM autosave_rules WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
      )
      res.json(rules.rows)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async createAutoSaveRule(req, res) {
    try {
      const userId = req.user.id
      const { rule_type, config } = req.body

      const result = await autoSaveEngine.createRule(userId, rule_type, config)
      res.status(201).json(result)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async toggleAutoSaveRule(req, res) {
    try {
      const { ruleId } = req.params
      const { is_active } = req.body

      await db.query(
        `UPDATE autosave_rules SET is_active = $1, updated_at = NOW() WHERE id = $2`,
        [is_active, ruleId]
      )

      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getNudges(req, res) {
    try {
      const userId = req.user.id
      const { limit = 20, unread_only } = req.query

      let query = `SELECT * FROM nudges WHERE user_id = $1`
      const params = [userId]

      if (unread_only === 'true') {
        query += ` AND is_read = false`
      }

      query += ` ORDER BY delivered_at DESC LIMIT $${params.length + 1}`
      params.push(parseInt(limit))

      const result = await db.query(query, params)
      res.json(result.rows)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async readNudge(req, res) {
    try {
      const { nudgeId } = req.params
      await nudgeEngine.markNudgeRead(nudgeId)
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async markAllNudgesRead(req, res) {
    try {
      const userId = req.user.id
      await db.query(
        `UPDATE nudges SET is_read = true WHERE user_id = $1 AND is_read = false`,
        [userId]
      )
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getRoundUpStatus(req, res) {
    try {
      const userId = req.user.id
      const rule = await db.query(
        `SELECT * FROM autosave_rules WHERE user_id = $1 AND rule_type = 'round_up' LIMIT 1`,
        [userId]
      )
      const totalRoundUps = await db.query(
        `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM autosave_transactions WHERE user_id = $1 AND type = 'round_up'`,
        [userId]
      )
      res.json({
        enabled: rule.rows.length > 0 && rule.rows[0].is_active === 1,
        ruleId: rule.rows[0]?.id || null,
        totalSaved: parseFloat(totalRoundUps.rows[0].total),
        transactionCount: totalRoundUps.rows[0].count,
      })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async toggleRoundUp(req, res) {
    try {
      const userId = req.user.id
      const { enabled } = req.body
      const existing = await db.query(
        `SELECT * FROM autosave_rules WHERE user_id = $1 AND rule_type = 'round_up' LIMIT 1`,
        [userId]
      )
      if (existing.rows.length) {
        await db.query(
          `UPDATE autosave_rules SET is_active = $1, updated_at = NOW() WHERE id = $2`,
          [enabled ? 1 : 0, existing.rows[0].id]
        )
        if (enabled) {
          const badgeEarned = await gamificationEngine.checkAllBadges(userId)
          return res.json({ success: true, enabled, badgeEarned: badgeEarned?.[0] || null })
        }
        return res.json({ success: true, enabled })
      } else if (enabled) {
        const result = await autoSaveEngine.createRule(userId, 'round_up', { destination_goal_id: null })
        const badgeEarned = await gamificationEngine.checkAllBadges(userId)
        return res.json({ success: true, enabled: true, rule: result, badgeEarned: badgeEarned?.[0] || null })
      } else {
        return res.json({ success: true, enabled: false })
      }
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getGamificationProfile(req, res) {
    try {
      const userId = req.user.id
      const profile = await gamificationEngine.getProfile(userId)
      res.json(profile)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async listGroups(req, res) {
    try {
      const userId = req.user.id
      const groups = await db.query(
        `SELECT sg.*, COUNT(gm.id) as member_count,
         EXISTS(SELECT 1 FROM group_members WHERE group_id = sg.id AND user_id = $1) as is_member
         FROM savings_groups sg
         LEFT JOIN group_members gm ON gm.group_id = sg.id
         GROUP BY sg.id ORDER BY sg.created_at DESC`, [userId])
      res.json(groups.rows)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async getDailyQuests(req, res) {
    try {
      const userId = req.user.id
      const quests = await gamificationEngine.getDailyQuests(userId)
      res.json(quests)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async completeQuest(req, res) {
    try {
      const userId = req.user.id
      const { questKey } = req.params
      const result = await gamificationEngine.completeQuest(userId, questKey)
      if (!result) return res.status(400).json({ error: 'Quest already completed or not found' })
      res.json(result)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async getGroupMessages(req, res) {
    try {
      const { groupId } = req.params
      const messages = await gamificationEngine.getGroupMessages(groupId)
      res.json(messages)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async sendGroupMessage(req, res) {
    try {
      const userId = req.user.id
      const { groupId } = req.params
      const { message } = req.body
      if (!message) return res.status(400).json({ error: 'Message is required' })
      const result = await gamificationEngine.sendGroupMessage(groupId, userId, message)
      res.status(201).json(result)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async getGroupMembers(req, res) {
    try {
      const { groupId } = req.params
      const members = await gamificationEngine.getGroupMembers(groupId)
      res.json(members)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async createSavingsGroup(req, res) {
    try {
      const userId = req.user.id
      const { name, description, goal_type, target_amount } = req.body

      const group = await gamificationEngine.createSavingsGroup(name, description, userId, goal_type, target_amount)
      res.status(201).json(group)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async joinSavingsGroup(req, res) {
    try {
      const userId = req.user.id
      const { groupId } = req.params

      const result = await gamificationEngine.joinSavingsGroup(groupId, userId)
      res.json(result)
    } catch (error) {
      res.status(400).json({ error: error.message })
    }
  }

  async makeCommitment(req, res) {
    try {
      const userId = req.user.id
      const { groupId } = req.params
      const { commitment_type, target_amount, deadline } = req.body

      const result = await gamificationEngine.makeCommitment(groupId, userId, commitment_type, target_amount, deadline)
      res.json(result)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getGroupLeaderboard(req, res) {
    try {
      const { groupId } = req.params
      const leaderboard = await gamificationEngine.getGroupLeaderboard(groupId)
      res.json(leaderboard)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async addDailyExpenditure(req, res) {
    try {
      const userId = req.user.id
      const { amount, category, note, expenditure_date } = req.body

      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Amount must be greater than 0' })
      }

      const allowedCategories = ['food', 'transport', 'shopping', 'entertainment', 'bills', 'health', 'education', 'groceries', 'other']
      if (!allowedCategories.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' })
      }

      const result = await db.query(
        `INSERT INTO daily_expenditures (id, user_id, amount, category, note, expenditure_date)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, COALESCE($5, date('now'))) RETURNING *`,
        [userId, amount, category, note || null, expenditure_date]
      )

      const txnResult = await db.query(
        `INSERT INTO transactions (id, user_id, gxbank_txn_id, amount, type, category, merchant, description, transaction_date)
         VALUES (gen_random_uuid(), $1, $2, $3, 'debit', $4, 'Manual Entry', $5, COALESCE($6, date('now'))) RETURNING *`,
        [userId, `EXP-${Date.now()}`, amount, category, note || 'Daily expenditure', expenditure_date]
      )

      const txn = txnResult.rows[0]
      await autoSaveEngine.executeRoundUp(txn.id)
      await nudgeEngine.checkBudgetAlerts(userId)

      const badgeEarned = await gamificationEngine.checkAllBadges(userId)
      const response = result.rows[0]
      if (badgeEarned?.length > 0) {
        response.badgeEarned = badgeEarned[0]
      }

      res.status(201).json(response)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async getDailyExpenditures(req, res) {
    try {
      const userId = req.user.id
      const date = req.query.date || new Date().toISOString().split('T')[0]

      const expenditures = await db.query(
        `SELECT * FROM daily_expenditures WHERE user_id = $1 AND expenditure_date = $2 ORDER BY created_at DESC`,
        [userId, date]
      )

      const totalResult = await db.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM daily_expenditures WHERE user_id = $1 AND expenditure_date = $2`,
        [userId, date]
      )

      res.json({
        expenditures: expenditures.rows,
        totalToday: parseFloat(totalResult.rows[0].total)
      })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getPersonalisedAdvice(req, res) {
    try {
      const userId = req.user.id
      const user = await db.query(`SELECT * FROM users WHERE id = $1`, [userId])
      if (!user.rows.length) return res.status(404).json({ error: 'User not found' })

      const [daily, monthly, annual] = await Promise.all([
        _getSpendingForPeriod(userId, 1),
        _getSpendingForPeriod(userId, 30),
        _getSpendingForPeriod(userId, 365),
      ])

      const income = user.rows[0].monthly_income || 0
      const goals = await db.query(`SELECT * FROM goals WHERE user_id = $1 AND is_active = true`, [userId])
      const streak = await db.query(`SELECT * FROM savings_streaks WHERE user_id = $1`, [userId])

      const advice = {
        daily: { spent: daily.total, categories: daily.categories, tip: _getDailyTip(daily, income) },
        monthly: { spent: monthly.total, categories: monthly.categories, savingsRate: income > 0 ? ((income - monthly.total) / income * 100).toFixed(1) : 0, tip: _getMonthlyTip(monthly, income, goals.rows) },
        annual: { spent: annual.total, projected: monthly.total * 12, categories: annual.categories, tip: _getAnnualTip(annual, income) },
        streak: streak.rows[0] || { current_streak: 0 },
        goalCount: goals.rows.length,
      }
      res.json(advice)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getCalendarData(req, res) {
    try {
      const userId = req.user.id
      const { month } = req.query
      if (!month) return res.status(400).json({ error: 'month parameter required (YYYY-MM)' })
      const user = await db.query(`SELECT monthly_income FROM users WHERE id = $1`, [userId])
      const dailyBudget = (user.rows[0]?.monthly_income || 0) / 30
      const days = await db.query(
        `SELECT transaction_date as date, COALESCE(SUM(amount), 0) as spent,
         COALESCE((SELECT SUM(amount) FROM autosave_transactions WHERE user_id = $1 AND date(executed_at) = date(t.transaction_date)), 0) as saved
         FROM transactions t WHERE user_id = $1 AND type = 'debit'
         AND strftime('%Y-%m', transaction_date) = $2
         GROUP BY transaction_date ORDER BY transaction_date`,
        [userId, month]
      )
      const result = days.rows.map(function(d) {
        const spent = parseFloat(d.spent)
        let status = 'green'
        if (spent > dailyBudget) status = 'red'
        else if (spent > dailyBudget * 0.5) status = 'yellow'
        return { date: d.date, spent, saved: parseFloat(d.saved), status }
      })
      res.json({ days: result, dailyBudget })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async getDayDetail(req, res) {
    try {
      const userId = req.user.id
      const { date } = req.query
      if (!date) return res.status(400).json({ error: 'date parameter required (YYYY-MM-DD)' })
      const transactions = await db.query(
        `SELECT * FROM transactions WHERE user_id = $1 AND type = 'debit' AND date(transaction_date) = $2 ORDER BY created_at`,
        [userId, date]
      )
      const expenditures = await db.query(
        `SELECT * FROM daily_expenditures WHERE user_id = $1 AND expenditure_date = $2 ORDER BY created_at`,
        [userId, date]
      )
      const savings = await db.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM autosave_transactions WHERE user_id = $1 AND date(executed_at) = $2`,
        [userId, date]
      )
      res.json({
        transactions: transactions.rows,
        expenditures: expenditures.rows,
        totalSaved: parseFloat(savings.rows[0].total),
      })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async deleteGoal(req, res) {
    try {
      const userId = req.user.id
      const { goalId } = req.params
      await db.query(`DELETE FROM goals WHERE id = $1 AND user_id = $2`, [goalId, userId])
      res.json({ success: true })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async deleteAutoSaveRule(req, res) {
    try {
      const userId = req.user.id
      const { ruleId } = req.params
      await db.query(`DELETE FROM autosave_rules WHERE id = $1 AND user_id = $2`, [ruleId, userId])
      res.json({ success: true })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async getSpendingAnalysis(req, res) {
    try {
      const userId = req.user.id
      const { days = 90 } = req.query
      const analysis = await aiEngine.analyseSpendingPatterns(userId, parseInt(days))
      res.json(analysis)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }
}

async function _getSpendingForPeriod(userId, days) {
  const result = await db.query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = $1 AND type = 'debit' AND transaction_date >= datetime('now', '-${days} days')`,
    [userId]
  )
  const categories = await db.query(
    `SELECT category, COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = $1 AND type = 'debit' AND transaction_date >= datetime('now', '-${days} days') GROUP BY category ORDER BY total DESC`,
    [userId]
  )
  return { total: parseFloat(result.rows[0].total), categories: categories.rows }
}

function _getDailyTip(daily, income) {
  if (daily.total > income / 30 * 0.8) {
    return { title: 'High Daily Spend', message: 'Your spending today is higher than usual. Try to save a bit more tomorrow.', priority: 'high' }
  }
  return { title: 'On Track', message: 'Your daily spending looks good. Keep it up!', priority: 'low' }
}

function _getMonthlyTip(monthly, income, goals) {
  const savingsRate = income > 0 ? ((income - monthly.total) / income * 100) : 0
  if (savingsRate < 10) {
    return { title: 'Low Savings Rate', message: 'Try to save at least 10% of your income. Consider reducing non-essential spending.', priority: 'high' }
  }
  if (savingsRate < 20) {
    return { title: 'Good Start', message: `You're saving ${savingsRate.toFixed(0)}% of your income. Aim for 20% to reach your goals faster.`, priority: 'medium' }
  }
  return { title: 'Great Savings Rate', message: `You're saving ${savingsRate.toFixed(0)}% of your income! Your ${goals.length || ''} goals are on track.`, priority: 'low' }
}

function _getAnnualTip(annual, income) {
  const annualIncome = income * 12
  if (annualIncome > 0 && annual.total > annualIncome * 0.9) {
    return { title: 'Annual Spend Warning', message: 'Your projected annual spending is very high. Consider reviewing your budget.', priority: 'high' }
  }
  return { title: 'Healthy Annual Outlook', message: 'Your projected annual spending is within a healthy range relative to your income.', priority: 'low' }
}

module.exports = new DashboardController()
