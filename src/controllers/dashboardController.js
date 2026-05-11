const db = require('../database/connection')
const aiEngine = require('../services/AIEngine')
const nudgeEngine = require('../services/NudgeEngine')
const autoSaveEngine = require('../services/AutoSaveEngine')
const gamificationEngine = require('../services/GamificationEngine')
const resilienceEngine = require('../services/ResilienceEngine')
const petEngine = require('../services/PetEngine')

function myDate(offsetDays) {
  var d = new Date();
  if (offsetDays) d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

class DashboardController {
  async getDashboard(req, res) {
    try {
      const userId = req.user.id

      const [user, goals, streak, profile, budgets, recentNudges, autoSaveSummary] = await Promise.all([
        db.query(`SELECT id, full_name, email, phone, gxbank_account_id, monthly_income, risk_profile FROM users WHERE id = $1`, [userId]),
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

      query += ` ORDER BY transaction_date DESC, created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
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

      var txnDate = transaction_date ? String(transaction_date) : myDate()
      var result = await db.query(
        `INSERT INTO transactions (user_id, gxbank_txn_id, amount, type, category, merchant, description, transaction_date, is_recurring)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [userId, 'TXN-' + Date.now(), amount, type, txnCategory, merchant, description, txnDate, is_recurring ? 1 : 0]
      )

      const txn = result.rows[0]

      var goal = await db.query(`SELECT id, current_amount FROM goals WHERE user_id = $1 AND is_active = true ORDER BY priority LIMIT 1`, [userId])
      if (goal.rows.length > 0) {
        var g = goal.rows[0]
        var newAmount = type === 'credit' ? parseFloat(g.current_amount) + parseFloat(amount) : Math.max(0, parseFloat(g.current_amount) - parseFloat(amount))
        await db.query(`UPDATE goals SET current_amount = $1, updated_at = datetime('now') WHERE id = $2`, [newAmount, g.id])
      }

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
      const { amount, category, note, expenditure_date, merchant } = req.body

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

      const merchantName = merchant || 'Manual Entry'
      const txnResult = await db.query(
        `INSERT INTO transactions (id, user_id, gxbank_txn_id, amount, type, category, merchant, description, transaction_date)
         VALUES (gen_random_uuid(), $1, $2, $3, 'debit', $4, $5, $6, COALESCE($7, date('now'))) RETURNING *`,
        [userId, `EXP-${Date.now()}`, amount, category, merchantName, note || 'Daily expenditure', expenditure_date]
      )

      const txn = txnResult.rows[0]
      await autoSaveEngine.executeRoundUp(txn.id)

      var parts = myDate().split('-')
      var month = parseInt(parts[1])
      var year = parseInt(parts[0])
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

      // Trigger pet reaction based on daily spending vs budget
      try {
        const today = myDate()
        const dailyLog = await db.query(
          `SELECT * FROM autopilot_daily_logs WHERE user_id = $1 AND log_date = $2`, [userId, today]
        )
        if (dailyLog.rows.length) {
          const spent = parseFloat(dailyLog.rows[0].spent || 0)
          const limit = parseFloat(dailyLog.rows[0].daily_limit || 0)
          if (limit > 0 && spent > limit) {
            await petEngine.triggerPetReaction(userId, 'overspend', { over: (spent - limit).toFixed(2) })
          }
        }
        // Check budget warning for this category
        const budgetCheck = await db.query(
          `SELECT monthly_limit, current_spent FROM budgets WHERE user_id = $1 AND category = $2 AND period_month = $3 AND period_year = $4`,
          [userId, category, month, year]
        )
        if (budgetCheck.rows.length) {
          const b = budgetCheck.rows[0]
          const pct = b.monthly_limit > 0 ? Math.round((b.current_spent / b.monthly_limit) * 100) : 0
          if (pct >= 80) {
            await petEngine.triggerPetReaction(userId, 'budget_warning', { category, percent: pct })
          }
        }
      } catch (petErr) { /* Pet errors should not block expense logging */ }

      res.status(201).json(response)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async getDailyExpenditures(req, res) {
    try {
      const userId = req.user.id
      const date = req.query.date || myDate()

      const expenditures = await db.query(
        `SELECT * FROM daily_expenditures WHERE user_id = $1 AND expenditure_date = $2 ORDER BY created_at DESC`,
        [userId, date]
      )

      const expTotal = await db.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM daily_expenditures WHERE user_id = $1 AND expenditure_date = $2`,
        [userId, date]
      )
      const txnTotal = await db.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = $1 AND type = 'debit' AND date(transaction_date) = $2`,
        [userId, date]
      )

      res.json({
        expenditures: expenditures.rows,
        totalToday: parseFloat(expTotal.rows[0].total) + parseFloat(txnTotal.rows[0].total)
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
      const parts = month.split('-')
      let lastMonthYear = parseInt(parts[0])
      let lastMonthNum = parseInt(parts[1]) - 1
      if (lastMonthNum === 0) { lastMonthNum = 12; lastMonthYear-- }
      const lastMonthStr = lastMonthYear + '-' + (lastMonthNum < 10 ? '0' : '') + lastMonthNum
      const incomeResult = await db.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = $1 AND type = 'credit' AND strftime('%Y-%m', transaction_date) = $2`,
        [userId, lastMonthStr]
      )
      const lastMonthIncome = parseFloat(incomeResult.rows[0]?.total || 0)

      const result = days.rows.map(function(d) {
        const spent = parseFloat(d.spent)
        let status = 'green'
        if (spent > dailyBudget) status = 'red'
        else if (spent > dailyBudget * 0.5) status = 'yellow'
        return { date: d.date, spent, saved: parseFloat(d.saved), status }
      })
      res.json({ days: result, dailyBudget, lastMonthIncome })
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
        var parts = myDate().split('-')
        var month = parseInt(parts[1])
        var year = parseInt(parts[0])
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

  async upsertOnboardingSegment(req, res) {
    try {
      const userId = req.user.id
      const segment = await resilienceEngine.upsertUserSegment(userId, req.body || {})
      res.json(segment)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getResilienceScore(req, res) {
    try {
      const userId = req.user.id
      const score = await resilienceEngine.computeResilienceScore(userId)
      res.json(score)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getRunwayBreakdown(req, res) {
    try {
      const userId = req.user.id
      const breakdown = await resilienceEngine.computeRunwayBreakdown(userId)
      res.json(breakdown)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getDebtRisks(req, res) {
    try {
      const userId = req.user.id
      const risks = await resilienceEngine.detectDebtRisks(userId)
      const actions = await resilienceEngine.getBeforeSpendActions(userId)
      // Auto-increase round-up multiplier when risks detected
      if (risks.length > 0) {
        try {
          await resilienceEngine.adjustRoundUpMultiplier(userId, 2.0)
        } catch (e) { /* non-blocking */ }
      }
      res.json({ risks, beforeSpendActions: actions })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getAdaptiveNudges(req, res) {
    try {
      const userId = req.user.id
      const selected = await resilienceEngine.chooseNudgeVariant(userId, req.query.experiment_key || 'overspend')
      const variants = await resilienceEngine.getAdaptiveNudgePolicy(userId)
      res.json({ selected, variants })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async logIntervention(req, res) {
    try {
      const userId = req.user.id
      const log = await resilienceEngine.logIntervention(userId, req.body || {})
      res.status(201).json(log)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async updateInterventionStatus(req, res) {
    try {
      const userId = req.user.id
      const { logId } = req.params
      const { status } = req.body
      const result = await resilienceEngine.updateInterventionStatus(userId, logId, status)
      res.json(result)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getInterventionOutcomes(req, res) {
    try {
      const userId = req.user.id
      await resilienceEngine.updateOutcomeMetrics(userId)
      const summary = await resilienceEngine.getOutcomeSummary(userId)
      res.json(summary)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async listMicroLearningCards(req, res) {
    try {
      const userId = req.user.id
      const cards = await resilienceEngine.listMicroLearningCards(userId)
      res.json(cards)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async createMicroLearningCard(req, res) {
    try {
      const userId = req.user.id
      const { trigger_type, title, content, cta_label, cta_action } = req.body
      const card = await resilienceEngine.createMicroLearningCard(userId, trigger_type, title, content, cta_label, cta_action)
      res.status(201).json(card)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async completeMicroLearningCard(req, res) {
    try {
      const userId = req.user.id
      const { cardId } = req.params
      const result = await resilienceEngine.completeMicroCard(userId, cardId)
      res.json(result)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async createCommitmentContract(req, res) {
    try {
      const userId = req.user.id
      const { group_id, contract_type, target_value, stake_amount, due_date } = req.body
      const contract = await resilienceEngine.createCommitmentContract(userId, group_id, contract_type, target_value, stake_amount, due_date)
      res.status(201).json(contract)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async listCommitmentContracts(req, res) {
    try {
      const userId = req.user.id
      const contracts = await resilienceEngine.listCommitmentContracts(userId, req.query.group_id)
      res.json(contracts)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  // === COOL-DOWN LIST ===
  async predictPurchaseImpact(req, res) {
    try {
      const userId = req.user.id
      const { amount } = req.body
      const result = await resilienceEngine.predictPurchaseImpact(userId, amount)
      res.json(result)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async addToCooldown(req, res) {
    try {
      const userId = req.user.id
      const { merchant, amount, description, predicted_impact } = req.body
      const entry = await resilienceEngine.addToCooldown(userId, merchant, amount, description, predicted_impact)
      res.status(201).json(entry)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async getCooldownList(req, res) {
    try {
      const userId = req.user.id
      const list = await resilienceEngine.getCooldownList(userId)
      res.json(list)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async confirmCooldownEntry(req, res) {
    try {
      const userId = req.user.id
      const { entryId } = req.params
      const result = await resilienceEngine.confirmCooldownEntry(userId, entryId)
      res.json(result)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async abandonCooldownEntry(req, res) {
    try {
      const userId = req.user.id
      const { entryId } = req.params
      const result = await resilienceEngine.abandonCooldownEntry(userId, entryId)
      res.json(result)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  // === DYNAMIC BUDGET RESET ===
  async applyBudgetReset(req, res) {
    try {
      const userId = req.user.id
      const { overspent_amount } = req.body
      const result = await resilienceEngine.applyBudgetReset(userId, overspent_amount)
      res.json(result)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async tryAutoBudgetReset(req, res) {
    try {
      const userId = req.user.id
      const result = await resilienceEngine.tryAutoBudgetReset(userId)
      res.json(result || { noAction: true })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  // === MULTIPLIER ADJUSTMENT ===
  async adjustRoundUpMultiplier(req, res) {
    try {
      const userId = req.user.id
      const { multiplier } = req.body
      const result = await resilienceEngine.adjustRoundUpMultiplier(userId, multiplier || 2.0)
      res.json(result)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async tryAutoIncreaseMultiplier(req, res) {
    try {
      const userId = req.user.id
      const result = await resilienceEngine.tryAutoIncreaseMultiplier(userId)
      res.json(result)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async resolveCommitmentContract(req, res) {
    try {
      const userId = req.user.id
      const { contractId } = req.params
      const { status, resolution_note } = req.body
      const result = await resilienceEngine.resolveCommitmentContract(userId, contractId, status, resolution_note)
      // Award pet XP on completion
      if (status === 'completed') {
        try {
          await petEngine.awardContractXp(userId)
        } catch (e) {}
      }
      res.json(result)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getContractRecommendations(req, res) {
    try {
      const userId = req.user.id
      const recommendations = await resilienceEngine.getRecommendedContracts(userId)
      res.json(recommendations)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async acceptContractRecommendation(req, res) {
    try {
      const userId = req.user.id
      const recommendation = req.body
      const contract = await resilienceEngine.acceptContractRecommendation(userId, recommendation)
      if (contract.error) return res.status(400).json(contract)
      res.status(201).json(contract)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async checkExpiringContracts(req, res) {
    try {
      const userId = req.user.id
      const result = await resilienceEngine.checkExpiringContracts(userId)
      res.json(result)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async autoArbitrateContracts(req, res) {
    try {
      const userId = req.user.id
      const results = await resilienceEngine.autoArbitrateContracts(userId)
      res.json(results)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async runAutoArbitrationAll(req, res) {
    try {
      const results = await resilienceEngine.runAutoArbitration()
      res.json(results)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getGXBankIntegrationStory(req, res) {
    try {
      const mapping = [
        { gxbank_capability: 'Transactions feed', used_for: 'Debt-risk detection + resilience scoring' },
        { gxbank_capability: 'DuitNow transfers', used_for: 'Auto-save transfers + social commitment settlements' },
        { gxbank_capability: 'Goal pockets', used_for: 'Emergency fund runway and next-best-action routing' },
        { gxbank_capability: 'Card controls', used_for: 'Before-you-spend guardrails and risky merchant throttling' },
        { gxbank_capability: 'Push notifications', used_for: 'Real-time adaptive nudges with fatigue controls' },
      ]
      res.json({
        title: 'Powered by GXBank rails',
        mapping,
        judgeDemoFlow: [
          'Onboard and infer user segment',
          'Detect debt trap risk from live transaction behavior',
          'Trigger before-you-spend intervention',
          'Show resilience score movement + closed-loop outcomes',
        ],
      })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  }

  async getFixedExpenses(req, res) {
    try {
      const userId = req.user.id
      var result = await db.query(`SELECT * FROM fixed_expenses WHERE user_id = $1 ORDER BY due_day, name`, [userId])
      res.json(result.rows)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async addFixedExpense(req, res) {
    try {
      const userId = req.user.id
      var { name, amount, category, due_day } = req.body
      if (!name || !amount) return res.status(400).json({ error: 'Name and amount required' })
      var result = await db.query(
        `INSERT INTO fixed_expenses (id, user_id, name, amount, category, due_day) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING *`,
        [userId, name, amount, category || 'other', due_day || null]
      )
      res.status(201).json(result.rows[0])
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async deleteFixedExpense(req, res) {
    try {
      const userId = req.user.id
      var { id } = req.params
      await db.query(`DELETE FROM fixed_expenses WHERE id = $1 AND user_id = $2`, [id, userId])
      res.json({ success: true })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async recordFixedExpenses(req, res) {
    try {
      const userId = req.user.id
      const fixed = await db.query(`SELECT * FROM fixed_expenses WHERE user_id = $1`, [userId])
      const month = myDate().slice(0, 7)
      var count = 0
      for (var f of fixed.rows) {
        var existing = await db.query(
          `SELECT id FROM transactions WHERE user_id = $1 AND merchant = $2 AND strftime('%Y-%m', transaction_date) = $3`,
          [userId, 'Fixed: ' + f.name, month]
        )
        if (existing.rows.length === 0) {
          await db.query(
            `INSERT INTO transactions (user_id, gxbank_txn_id, amount, type, category, merchant, description, transaction_date)
             VALUES ($1, $2, $3, 'debit', $4, $5, $6, $7)`,
            [userId, 'FIX-' + Date.now() + '-' + count, f.amount, f.category || 'bills', 'Fixed: ' + f.name, 'Monthly ' + f.name, myDate()]
          )
          count++
        }
      }
      res.json({ success: true, recorded: count })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async getAutopilotStatus(req, res) {
    try {
      const userId = req.user.id
      const settings = await db.query(`SELECT * FROM autopilot_settings WHERE user_id = $1`, [userId])
      const today = myDate()
      const dailyLog = await db.query(
        `SELECT * FROM autopilot_daily_logs WHERE user_id = $1 AND log_date = $2`, [userId, today]
      )
      const piggyTotal = await db.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM piggy_bank_entries WHERE user_id = $1`, [userId]
      )
      const lastMonthIncome = await db.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = $1 AND type = 'credit' AND strftime('%Y-%m', transaction_date) = strftime('%Y-%m', 'now', '-1 month')`,
        [userId]
      )
      res.json({
        settings: settings.rows[0] || null,
        dailyLog: dailyLog.rows[0] || null,
        piggyBankTotal: parseFloat(piggyTotal.rows[0].total),
        lastMonthIncome: parseFloat(lastMonthIncome.rows[0].total)
      })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async setupAutopilot(req, res) {
    try {
      const userId = req.user.id
      var { lastMonthIncome, emergencyFundPct, savingsGoalsPct, fixedBillsMonthly } = req.body
      if (!lastMonthIncome) return res.status(400).json({ error: 'lastMonthIncome is required' })
      emergencyFundPct = emergencyFundPct || 10
      savingsGoalsPct = savingsGoalsPct || 10
      fixedBillsMonthly = fixedBillsMonthly || 0

      const savingsPct = emergencyFundPct + savingsGoalsPct
      const dailyTotal = lastMonthIncome - (lastMonthIncome * savingsPct / 100) - fixedBillsMonthly

      await db.query(
        `INSERT INTO autopilot_settings (id, user_id, is_active, last_month_income, emergency_fund_pct, savings_goals_pct, fixed_bills_monthly, daily_spending_total)
         VALUES (gen_random_uuid(), $1, true, $2, $3, $4, $5, $6)
         ON CONFLICT(user_id) DO UPDATE SET
           last_month_income = $2, emergency_fund_pct = $3, savings_goals_pct = $4,
           fixed_bills_monthly = $5, daily_spending_total = $6, is_active = true,
           updated_at = datetime('now')`,
        [userId, lastMonthIncome, emergencyFundPct, savingsGoalsPct, fixedBillsMonthly, dailyTotal]
      )

      const settings = await db.query(`SELECT * FROM autopilot_settings WHERE user_id = $1`, [userId])
      res.json({ success: true, settings: settings.rows[0] })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async toggleAutopilot(req, res) {
    try {
      const userId = req.user.id
      var { isActive } = req.body
      await db.query(
        `UPDATE autopilot_settings SET is_active = $1, updated_at = datetime('now') WHERE user_id = $2`,
        [isActive ? 1 : 0, userId]
      )
      res.json({ success: true })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async quickEnableAutopilot(req, res) {
    try {
      const userId = req.user.id
      // Get last month income
      const lastMonthIncome = await db.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
         WHERE user_id = $1 AND type = 'credit'
         AND strftime('%Y-%m', transaction_date) = strftime('%Y-%m', 'now', '-1 month')`,
        [userId]
      )
      const income = Math.max(parseFloat(lastMonthIncome.rows[0]?.total || 0), 1)
      // Withhold 20%: 10% emergency, 10% savings goals
      const emergencyPct = 10
      const savingsPct = 10
      const savingsTotal = emergencyPct + savingsPct
      const bills = 0
      const dailyTotal = income - (income * savingsTotal / 100) - bills
      await db.query(
        `INSERT INTO autopilot_settings (id, user_id, is_active, last_month_income, emergency_fund_pct, savings_goals_pct, fixed_bills_monthly, daily_spending_total)
         VALUES (gen_random_uuid(), $1, 1, $2, $3, $4, $5, $6)
         ON CONFLICT(user_id) DO UPDATE SET
           is_active = 1, last_month_income = $2, emergency_fund_pct = $3,
           savings_goals_pct = $4, fixed_bills_monthly = $5, daily_spending_total = $6,
           updated_at = datetime('now')`,
        [userId, income, emergencyPct, savingsPct, bills, dailyTotal]
      )
      res.json({ success: true, message: 'Autopilot enabled! 20% of income will be auto-allocated to savings.', settings: { income, emergencyPct, savingsPct, dailyTotal } })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async getDailyLimit(req, res) {
    try {
      const userId = req.user.id
      const settings = await db.query(`SELECT * FROM autopilot_settings WHERE user_id = $1 AND is_active = true`, [userId])
      if (!settings.rows.length) return res.status(400).json({ error: 'Autopilot not set up' })

      const s = settings.rows[0]
      const today = myDate()
      const daysInMonth = new Date().getDate()
      const baseDaily = s.daily_spending_total / daysInMonth

      const yesterday = myDate(-1)
      const yesterdayLog = await db.query(
        `SELECT * FROM autopilot_daily_logs WHERE user_id = $1 AND log_date = $2`, [userId, yesterday]
      )

      let rollover = 0
      if (yesterdayLog.rows.length) {
        const y = yesterdayLog.rows[0]
        rollover = Math.max(0, parseFloat(y.daily_limit) - parseFloat(y.spent))
      }

      const todayLimit = baseDaily + rollover

      await db.query(
        `INSERT INTO autopilot_daily_logs (id, user_id, log_date, daily_limit, rolled_over)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)
         ON CONFLICT(user_id, log_date) DO UPDATE SET daily_limit = $3, rolled_over = $4`,
        [userId, today, todayLimit, rollover]
      )

      const todayLog = await db.query(
        `SELECT * FROM autopilot_daily_logs WHERE user_id = $1 AND log_date = $2`, [userId, today]
      )

      res.json({
        dailyLimit: todayLimit,
        baseDaily: baseDaily,
        rollover: rollover,
        spent: parseFloat(todayLog.rows[0]?.spent || 0),
        remaining: todayLimit - parseFloat(todayLog.rows[0]?.spent || 0),
        logDate: today
      })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async recordDailySpending(req, res) {
    try {
      const userId = req.user.id
      var { amount } = req.body
      if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' })

      const today = myDate()
      await db.query(
        `UPDATE autopilot_daily_logs SET spent = spent + $1 WHERE user_id = $2 AND log_date = $3`,
        [amount, userId, today]
      )

      const log = await db.query(
        `SELECT * FROM autopilot_daily_logs WHERE user_id = $1 AND log_date = $2`, [userId, today]
      )

      // Auto-trigger budget reset if overspending detected
      try {
        if (log.rows.length) {
          const spent = parseFloat(log.rows[0].spent || 0)
          const limit = parseFloat(log.rows[0].daily_limit || 0)
          if (limit > 0 && spent > limit) {
            await resilienceEngine.applyBudgetReset(userId, spent - limit)
          }
        }
      } catch (e) { /* non-blocking */ }

      res.json({ success: true, spent: parseFloat(log.rows[0]?.spent || 0) })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async getPiggyBank(req, res) {
    try {
      const userId = req.user.id
      const entries = await db.query(
        `SELECT * FROM piggy_bank_entries WHERE user_id = $1 ORDER BY created_at DESC`, [userId]
      )
      const total = await db.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM piggy_bank_entries WHERE user_id = $1`, [userId]
      )
      res.json({ entries: entries.rows, total: parseFloat(total.rows[0].total) })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async addPiggyBankRoundUp(req, res) {
    try {
      const userId = req.user.id
      var { amount, sourceTxnId, description } = req.body
      if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' })

      await db.query(
        `INSERT INTO piggy_bank_entries (id, user_id, amount, source_txn_id, description)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [userId, amount, sourceTxnId || null, description || 'Round-up']
      )

      const total = await db.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM piggy_bank_entries WHERE user_id = $1`, [userId]
      )

      res.json({ success: true, total: parseFloat(total.rows[0].total) })
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  // === PET SYSTEM ===
  async getPetStatus(req, res) {
    try {
      const userId = req.user.id
      // Also calculate EP on each status fetch
      await petEngine.calculateDailyEP(userId)
      await petEngine.generateMorningDialogue(userId)
      const status = await petEngine.getPetStatus(userId)
      res.json(status)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async calculatePetEP(req, res) {
    try {
      const userId = req.user.id
      const result = await petEngine.calculateDailyEP(userId)
      res.json(result)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async dismissPetDialogue(req, res) {
    try {
      const userId = req.user.id
      const { dialogueId } = req.params
      const result = await petEngine.dismissDialogue(userId, dialogueId)
      res.json(result)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async getPetRewards(req, res) {
    try {
      const userId = req.user.id
      const petState = await petEngine.ensurePetState(userId)
      const rewards = await petEngine._getRewards(userId, petState.stage)
      res.json(rewards)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async claimPetReward(req, res) {
    try {
      const userId = req.user.id
      const { rewardId } = req.params
      const result = await petEngine.claimReward(userId, rewardId)
      if (result.error) return res.status(400).json(result)
      res.json(result)
    } catch (error) { res.status(500).json({ error: error.message }) }
  }

  async getPetHistory(req, res) {
    try {
      const userId = req.user.id
      const history = await petEngine.getEPHistory(userId)
      res.json(history)
    } catch (error) { res.status(500).json({ error: error.message }) }
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
