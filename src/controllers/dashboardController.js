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
        db.query(`SELECT * FROM budgets WHERE user_id = $1 AND period_month = CAST(strftime('%m', 'now') AS INTEGER) AND period_year = CAST(strftime('%Y', 'now') AS INTEGER)`, [userId]),
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
         AND strftime('%m', transaction_date) = strftime('%m', 'now')
         AND strftime('%Y', transaction_date) = strftime('%Y', 'now')
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

      const insights = await aiEngine.generateAIInsights(userId)
      await gamificationEngine.updateQuestProgress(userId, 'check_insights', 1)
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
        `INSERT INTO goals (id, user_id, name, target_amount, deadline, category, icon, priority)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [userId, name, target_amount, deadline, category, icon || 'target', priority || 'medium']
      )

      await db.query(
        `UPDATE gamification_profiles SET xp = xp + 50, updated_at = NOW() WHERE user_id = $1`,
        [userId]
      )

      await gamificationEngine.updateQuestProgress(userId, 'set_goal', 1)

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
        `SELECT sg.*,
         (SELECT COUNT(*) FROM group_members WHERE group_id = sg.id) as member_count,
         EXISTS(SELECT 1 FROM group_members WHERE group_id = sg.id AND user_id = $1) as is_member
         FROM savings_groups sg
         ORDER BY sg.created_at DESC`, [userId])
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
      await gamificationEngine.triggerNPCResponse(groupId)
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
      await gamificationEngine.updateQuestProgress(userId, 'join_group', 1)
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

      const now = new Date()
      const month = now.getMonth() + 1
      const year = now.getFullYear()
      const existingBudget = await db.query(
        `SELECT id FROM budgets WHERE user_id = $1 AND category = $2 AND period_month = $3 AND period_year = $4`,
        [userId, category, month, year]
      )
      if (existingBudget.rows.length) {
        await db.query(
          `UPDATE budgets SET current_spent = current_spent + $1, updated_at = datetime('now')
           WHERE user_id = $2 AND category = $3 AND period_month = $4 AND period_year = $5`,
          [amount, userId, category, month, year]
        )
      } else {
        const userRows = await db.query(`SELECT monthly_income FROM users WHERE id = $1`, [userId])
        const income = userRows.rows[0]?.monthly_income || 5000
        const limits = { food: 0.15, transport: 0.1, shopping: 0.1, entertainment: 0.05, bills: 0.15, health: 0.05, education: 0.05, groceries: 0.1, other: 0.1 }
        const limit = income * (limits[category] || 0.1)
        await db.query(
          `INSERT INTO budgets (id, user_id, category, monthly_limit, current_spent, period_month, period_year)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
          [userId, category, limit, amount, month, year]
        )
      }

      await nudgeEngine.checkBudgetAlerts(userId)

      await gamificationEngine.updateQuestProgress(userId, 'log_expense', 1)
      await gamificationEngine.updateQuestProgress(userId, 'log_3_expenses', 1)

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

  async deleteExpenditure(req, res) {
    try {
      const userId = req.user.id
      const { expenseId } = req.params
      const expense = await db.query(
        `SELECT amount, category, expenditure_date FROM daily_expenditures WHERE id = $1 AND user_id = $2`,
        [expenseId, userId]
      )
      if (!expense.rows.length) {
        return res.status(404).json({ error: 'Expense not found' })
      }
      const { amount, category, expenditure_date } = expense.rows[0]
      await db.query(`DELETE FROM daily_expenditures WHERE id = $1 AND user_id = $2`, [expenseId, userId])
      const txn = await db.query(
        `SELECT id FROM transactions WHERE user_id = $1 AND amount = $2 AND category = $3
         AND transaction_date = $4 AND type = 'debit' AND merchant = 'Manual Entry' LIMIT 1`,
        [userId, amount, category, expenditure_date]
      )
      if (txn.rows.length) {
        await db.query(`DELETE FROM transactions WHERE id = $1`, [txn.rows[0].id])
      }
      const expDate = new Date(expenditure_date)
      const month = expDate.getMonth() + 1
      const year = expDate.getFullYear()
      await db.query(
        `UPDATE budgets SET current_spent = MAX(0, current_spent - $1), updated_at = datetime('now')
         WHERE user_id = $2 AND category = $3 AND period_month = $4 AND period_year = $5`,
        [amount, userId, category, month, year]
      )
      res.json({ success: true })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async leaveGroup(req, res) {
    try {
      const userId = req.user.id
      const { groupId } = req.params
      const result = await db.query(`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 AND role != 'admin'`, [groupId, userId])
      if (result.rowCount === 0) {
        return res.status(400).json({ error: 'Cannot leave group as admin. Transfer ownership first or delete the group.' })
      }
      res.json({ success: true })
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

  async handleAIAction(req, res) {
    try {
      const userId = req.user.id
      const { action, category, limit, name, amount } = req.body
      if (action === 'create_budget') {
        const now = new Date()
        const month = now.getMonth() + 1
        const year = now.getFullYear()
        await db.query(
          `INSERT INTO budgets (id, user_id, category, monthly_limit, current_spent, period_month, period_year)
           VALUES (gen_random_uuid(), $1, $2, $3, 0, $4, $5)
           ON CONFLICT (user_id, category, period_month, period_year) DO UPDATE SET monthly_limit = $3`,
          [userId, category, limit, month, year]
        )
        return res.json({ success: true, message: 'Budget created!' })
      }
      if (action === 'enable_roundup') {
        const existing = await db.query(
          `SELECT id FROM autosave_rules WHERE user_id = $1 AND rule_type = 'round_up' LIMIT 1`,
          [userId]
        )
        if (existing.rows.length) {
          await db.query(`UPDATE autosave_rules SET is_active = 1 WHERE id = $1`, [existing.rows[0].id])
        } else {
          await autoSaveEngine.createRule(userId, 'round_up', { destination_goal_id: null })
        }
        return res.json({ success: true, message: 'Round-up enabled!' })
      }
      if (action === 'create_goal') {
        await db.query(
          `INSERT INTO goals (id, user_id, name, target_amount, current_amount, category, priority)
           VALUES (gen_random_uuid(), $1, $2, $3, 0, 'other', 'medium')`,
          [userId, name, amount]
        )
        return res.json({ success: true, message: 'Goal created!' })
      }
      res.status(400).json({ error: 'Unknown action' })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async getAllBadges(req, res) {
    try {
      const badges = await gamificationEngine.getAllBadgesForUser(req.user.id)
      res.json(badges)
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

  async aiChat(req, res) {
    try {
      const userId = req.user.id
      const { message } = req.body
      const user = await db.query(`SELECT * FROM users WHERE id = $1`, [userId])
      const analysis = await aiEngine.analyseSpendingPatterns(userId, 30)
      const goals = await db.query(`SELECT name, target_amount, current_amount FROM goals WHERE user_id = $1 AND is_active = true`, [userId])
      const streak = await db.query(`SELECT current_streak FROM savings_streaks WHERE user_id = $1`, [userId])

      const context = `User: ${user.rows[0].full_name}, Income: RM${user.rows[0].monthly_income}/month, Monthly spending: RM${analysis.monthlyAverage.toFixed(0)}, Savings streak: ${streak.rows[0]?.current_streak || 0} days, Goals: ${goals.rows.map(g => g.name + ' RM'+g.current_amount+'/'+g.target_amount).join(', ')}`

      const youraiService = require('../services/YourAIService')
      const reply = await youraiService.chat(
        `You are GuGa, a friendly Malaysian financial advisor chatbot for the GuGa Saves app. You have access to the user's real financial data. Be concise (2-3 sentences max), practical, and encouraging. Use RM currency. Occasionally use Manglish. Context: ${context}`,
        message
      )
      res.json({ reply })
    } catch (error) {
      res.json({ reply: "Sorry, I'm having trouble connecting right now. Try again in a moment!" })
    }
  }

  async aiSuggestBudgets(req, res) {
    const userId = req.user.id
    const analysis = await aiEngine.analyseSpendingPatterns(userId, 60)
    const user = await db.query(`SELECT monthly_income FROM users WHERE id = $1`, [userId])
    const income = user.rows[0]?.monthly_income || 0

    const youraiService = require('../services/YourAIService')
    const raw = await youraiService.chat(
      'You are a budget advisor. Respond ONLY in valid JSON array format.',
      `Income: RM${income}/month. Current spending by category: ${Object.entries(analysis.categoryBreakdown).map(([k,v]) => k+': RM'+v.total.toFixed(0)).join(', ')}. Suggest monthly budget limits for each category. Respond as JSON: [{"category":"...","limit":number,"reason":"..."}]`
    )
    try {
      res.json(JSON.parse(raw))
    } catch {
      const cats = Object.keys(analysis.categoryBreakdown)
      res.json(cats.map(c => ({ category: c, limit: Math.round(income * 0.15), reason: 'Default 15% allocation' })))
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
