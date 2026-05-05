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

      res.status(201).json(result.rows[0])
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

  async getGamificationProfile(req, res) {
    try {
      const userId = req.user.id
      const profile = await gamificationEngine.getProfile(userId)
      res.json(profile)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
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

module.exports = new DashboardController()
