const db = require('../database/connection')
const nudgeEngine = require('./NudgeEngine')

class ResilienceEngine {
  segmentPlaybooks = {
    student: {
      mode_key: 'exam_month',
      rules: { weekly_allowance_cap: 150, emergency_micro_save: 10, roundup_multiplier: 1.0 },
    },
    intern: {
      mode_key: 'internship_mode',
      rules: { stipend_split_percent: 20, transport_cap: 180, roundup_multiplier: 1.2 },
    },
    first_jobber: {
      mode_key: 'first_salary_mode',
      rules: { salary_split_percent: 25, lifestyle_cap_percent: 55, roundup_multiplier: 1.3 },
    },
    gig_worker: {
      mode_key: 'gig_stability_mode',
      rules: { buffer_target_months: 2, income_smoothing_percent: 18, roundup_multiplier: 1.1 },
    },
  }

  async upsertUserSegment(userId, answers) {
    const segmentType = this.inferSegment(answers)
    const confidence = this.segmentConfidence(answers)
    await db.query(
      `INSERT INTO user_segments (id, user_id, segment_type, confidence, onboarding_answers, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, datetime('now'))
       ON CONFLICT (user_id)
       DO UPDATE SET segment_type = excluded.segment_type, confidence = excluded.confidence, onboarding_answers = excluded.onboarding_answers, updated_at = datetime('now')`,
      [userId, segmentType, confidence, JSON.stringify(answers || {})]
    )
    await this.activatePlaybook(userId, segmentType)
    return { segment_type: segmentType, confidence }
  }

  inferSegment(answers = {}) {
    const track = (answers.track || '').toLowerCase()
    const incomeType = (answers.income_type || '').toLowerCase()
    if (track.includes('student')) return 'student'
    if (track.includes('intern')) return 'intern'
    if (incomeType.includes('gig') || incomeType.includes('freelance')) return 'gig_worker'
    return 'first_jobber'
  }

  segmentConfidence(answers = {}) {
    const keys = ['track', 'income_type', 'goal_priority']
    const count = keys.filter(k => answers[k]).length
    return Math.min(0.95, 0.55 + (count * 0.12))
  }

  async activatePlaybook(userId, segmentType) {
    const playbook = this.segmentPlaybooks[segmentType] || this.segmentPlaybooks.first_jobber
    await db.query(
      `INSERT INTO autopilot_profiles (id, user_id, mode_key, rule_bundle, is_active, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 1, datetime('now'))
       ON CONFLICT (user_id)
       DO UPDATE SET mode_key = excluded.mode_key, rule_bundle = excluded.rule_bundle, is_active = 1, updated_at = datetime('now')`,
      [userId, playbook.mode_key, JSON.stringify(playbook.rules)]
    )
    return playbook
  }

  async computeResilienceScore(userId) {
    const user = await db.query(`SELECT monthly_income FROM users WHERE id = $1`, [userId])
    const income = parseFloat(user.rows[0]?.monthly_income || 0)
    const monthlySpend = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
       WHERE user_id = $1 AND type = 'debit' AND transaction_date >= datetime('now', '-30 days')`,
      [userId]
    )
    const spend = parseFloat(monthlySpend.rows[0]?.total || 0)
    const savingsRate = income > 0 ? Math.max(0, ((income - spend) / income) * 100) : 0

    const emergency = await db.query(
      `SELECT COALESCE(SUM(current_amount), 0) AS total FROM goals WHERE user_id = $1 AND category = 'emergency' AND is_active = 1`,
      [userId]
    )
    const emergencyFund = parseFloat(emergency.rows[0]?.total || 0)
    const emergencyRunwayMonths = spend > 0 ? emergencyFund / (spend || 1) : 0

    const riskCount = await db.query(
      `SELECT COUNT(*) AS count FROM debt_risk_events WHERE user_id = $1 AND is_active = 1 AND created_at >= datetime('now', '-30 days')`,
      [userId]
    )
    const debtPressure = Math.min(100, parseInt(riskCount.rows[0]?.count || 0, 10) * 20)

    const daily = await db.query(
      `SELECT date(transaction_date) AS d, COALESCE(SUM(amount), 0) AS total
       FROM transactions WHERE user_id = $1 AND type = 'debit' AND transaction_date >= datetime('now', '-30 days')
       GROUP BY date(transaction_date)`,
      [userId]
    )
    const totals = daily.rows.map(r => parseFloat(r.total || 0))
    const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0
    const variance = totals.length ? totals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / totals.length : 0
    const volatility = Math.min(100, Math.sqrt(variance))

    const streak = await db.query(`SELECT current_streak FROM savings_streaks WHERE user_id = $1`, [userId])
    const consistency = Math.min(100, parseInt(streak.rows[0]?.current_streak || 0, 10) * 5)

    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round((savingsRate * 0.35) + (Math.min(100, emergencyRunwayMonths * 20) * 0.2) + ((100 - debtPressure) * 0.2) + ((100 - volatility) * 0.1) + (consistency * 0.15))
      )
    )

    const movementReason = debtPressure > 40
      ? 'Debt risk events increased this week. Activate autopilot protection now.'
      : (savingsRate >= 20 ? 'Healthy savings rate improved your score.' : 'Savings rate needs improvement.')
    const nextBestAction = debtPressure > 40
      ? 'Activate autopilot debt-trap protection and reduce discretionary spend by RM50 this week.'
      : 'Enable an autopilot playbook and keep a 7-day streak.'

    await db.query(
      `INSERT INTO resilience_scores (id, user_id, score_date, score, savings_rate, emergency_runway_months, debt_pressure, spending_volatility, consistency, movement_reason, next_best_action)
       VALUES (gen_random_uuid(), $1, date('now'), $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, score_date)
       DO UPDATE SET score = excluded.score, savings_rate = excluded.savings_rate, emergency_runway_months = excluded.emergency_runway_months, debt_pressure = excluded.debt_pressure, spending_volatility = excluded.spending_volatility, consistency = excluded.consistency, movement_reason = excluded.movement_reason, next_best_action = excluded.next_best_action`,
      [userId, score, savingsRate, emergencyRunwayMonths, debtPressure, volatility, consistency, movementReason, nextBestAction]
    )

    return {
      score,
      savingsRate: Number(savingsRate.toFixed(1)),
      emergencyRunwayMonths: Number(emergencyRunwayMonths.toFixed(2)),
      debtPressure,
      spendingVolatility: Number(volatility.toFixed(1)),
      consistency,
      movementReason,
      nextBestAction,
    }
  }

  async detectDebtRisks(userId) {
    const txns = await db.query(
      `SELECT amount, category, merchant, description, transaction_date
       FROM transactions WHERE user_id = $1 AND type = 'debit' AND transaction_date >= datetime('now', '-30 days')`,
      [userId]
    )
    const salary = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
       WHERE user_id = $1 AND type = 'credit' AND category = 'salary' AND transaction_date >= datetime('now', '-30 days')`,
      [userId]
    )
    const salaryTotal = parseFloat(salary.rows[0]?.total || 0)
    const totalDebit = txns.rows.reduce((s, t) => s + parseFloat(t.amount || 0), 0)
    const lower = (v) => String(v || '').toLowerCase()

    const riskEvents = []
    const bnplCount = txns.rows.filter(t => /atome|grabpaylater|spaylater|paylater|bnpl/.test(`${lower(t.merchant)} ${lower(t.description)}`)).length
    if (bnplCount >= 2) riskEvents.push({ risk_type: 'bnpl', severity: bnplCount > 3 ? 'high' : 'medium', confidence: 0.72, trigger_context: { bnpl_count: bnplCount } })

    const paydayCount = txns.rows.filter(t => /pinjaman|loan|cash advance|credit card minimum/i.test(`${t.merchant || ''} ${t.description || ''}`)).length
    if (paydayCount >= 1) riskEvents.push({ risk_type: 'payday_signal', severity: paydayCount > 1 ? 'high' : 'medium', confidence: 0.68, trigger_context: { payday_count: paydayCount } })

    if (salaryTotal > 0) {
      const utilization = (totalDebit / salaryTotal) * 100
      if (utilization >= 90) riskEvents.push({ risk_type: 'utilization', severity: utilization > 105 ? 'high' : 'medium', confidence: 0.75, trigger_context: { utilization: Number(utilization.toFixed(1)) } })
      const projected30Day = totalDebit * 1.1
      if (projected30Day > salaryTotal) riskEvents.push({ risk_type: 'cashflow_shortfall', severity: 'high', confidence: 0.79, trigger_context: { projected_spend: Number(projected30Day.toFixed(2)), salary: salaryTotal } })
    }

    await db.query(`UPDATE debt_risk_events SET is_active = 0 WHERE user_id = $1`, [userId])
    for (const risk of riskEvents) {
      await db.query(
        `INSERT INTO debt_risk_events (id, user_id, risk_type, severity, confidence, trigger_context, is_active)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 1)`,
        [userId, risk.risk_type, risk.severity, risk.confidence, JSON.stringify(risk.trigger_context || {})]
      )
    }

    if (riskEvents.length) {
      await nudgeEngine.createNudge(
        userId,
        'debt_prevention',
        'Before You Spend: Debt Trap Warning',
        'We detected elevated debt risk. Activate temporary caps or increase auto-save protection now.',
        { priority: 'high', context: { risk_count: riskEvents.length } }
      )
    }

    return riskEvents
  }

  async getBeforeSpendActions(userId) {
    const profile = await db.query(`SELECT * FROM autopilot_profiles WHERE user_id = $1`, [userId])
    const activeMode = profile.rows[0]?.mode_key || 'first_salary_mode'
    return [
      { key: 'defer_purchase', label: 'Defer purchase for 48 hours', impact: 'Reduces impulse debt risk by ~20%' },
      { key: 'reduce_category_cap', label: 'Reduce food/shopping cap by RM40', impact: 'Lowers projected shortfall this month' },
      { key: 'increase_roundup', label: 'Increase round-up multiplier by 0.2x', impact: `Boosts micro-saving in ${activeMode}` },
    ]
  }

  async logIntervention(userId, payload) {
    const { intervention_type, variant_key, channel = 'in_app', status = 'delivered', context = {} } = payload
    const result = await db.query(
      `INSERT INTO intervention_logs (id, user_id, intervention_type, variant_key, channel, status, context)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, intervention_type, variant_key || null, channel, status, JSON.stringify(context)]
    )
    return result.rows[0]
  }

  async updateInterventionStatus(userId, logId, status) {
    const fieldMap = { viewed: 'viewed_at', accepted: 'accepted_at' }
    const field = fieldMap[status]
    if (!field) return null
    await db.query(`UPDATE intervention_logs SET status = $1, ${field} = datetime('now') WHERE id = $2 AND user_id = $3`, [status, logId, userId])
    return { success: true }
  }

  async updateOutcomeMetrics(userId) {
    const logs = await db.query(
      `SELECT id, delivered_at, context FROM intervention_logs WHERE user_id = $1 ORDER BY delivered_at DESC LIMIT 100`,
      [userId]
    )
    for (const log of logs.rows) {
      const at = new Date(log.delivered_at).getTime()
      const spendD1 = await this._windowSpend(userId, at, 1)
      const spendD7 = await this._windowSpend(userId, at, 7)
      const saveD30 = await this._windowSave(userId, at, 30)
      await db.query(
        `UPDATE intervention_logs SET outcome_d1 = $1, outcome_d7 = $2, outcome_d30 = $3 WHERE id = $4`,
        [spendD1, spendD7, saveD30, log.id]
      )
    }
    return { updated: logs.rows.length }
  }

  async _windowSpend(userId, deliveredAtMs, days) {
    const from = new Date(deliveredAtMs).toISOString()
    const to = new Date(deliveredAtMs + (days * 24 * 60 * 60 * 1000)).toISOString()
    const result = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
       WHERE user_id = $1 AND type = 'debit' AND transaction_date >= $2 AND transaction_date < $3`,
      [userId, from, to]
    )
    return Number(parseFloat(result.rows[0].total || 0).toFixed(2))
  }

  async _windowSave(userId, deliveredAtMs, days) {
    const from = new Date(deliveredAtMs).toISOString()
    const to = new Date(deliveredAtMs + (days * 24 * 60 * 60 * 1000)).toISOString()
    const result = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM autosave_transactions
       WHERE user_id = $1 AND executed_at >= $2 AND executed_at < $3`,
      [userId, from, to]
    )
    return Number(parseFloat(result.rows[0].total || 0).toFixed(2))
  }

  async getOutcomeSummary(userId) {
    const metrics = await db.query(
      `SELECT
          COUNT(*) AS total_interventions,
          COALESCE(AVG(CASE WHEN accepted_at IS NOT NULL THEN 1.0 ELSE 0.0 END), 0) AS acceptance_rate,
          COALESCE(AVG(outcome_d7), 0) AS avg_spend_d7,
          COALESCE(AVG(outcome_d30), 0) AS avg_save_d30
       FROM intervention_logs WHERE user_id = $1`,
      [userId]
    )
    return {
      totalInterventions: parseInt(metrics.rows[0].total_interventions || 0, 10),
      acceptanceRate: Number((parseFloat(metrics.rows[0].acceptance_rate || 0) * 100).toFixed(1)),
      averageSpendD7: Number(parseFloat(metrics.rows[0].avg_spend_d7 || 0).toFixed(2)),
      averageSaveD30: Number(parseFloat(metrics.rows[0].avg_save_d30 || 0).toFixed(2)),
    }
  }

  async getAdaptiveNudgePolicy(userId) {
    const existing = await db.query(`SELECT * FROM nudge_experiments WHERE user_id = $1`, [userId])
    if (!existing.rows.length) {
      const defaults = [
        { experiment_key: 'overspend', variant_key: 'supportive_push_9pm', channel: 'push', tone: 'supportive', delivery_hour: 21 },
        { experiment_key: 'overspend', variant_key: 'direct_inapp_6pm', channel: 'in_app', tone: 'direct', delivery_hour: 18 },
      ]
      for (const d of defaults) {
        await db.query(
          `INSERT INTO nudge_experiments (id, user_id, experiment_key, variant_key, channel, tone, delivery_hour)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
          [userId, d.experiment_key, d.variant_key, d.channel, d.tone, d.delivery_hour]
        )
      }
    }
    const rows = await db.query(
      `SELECT * FROM nudge_experiments WHERE user_id = $1 ORDER BY reward_score DESC, delivered_count ASC`,
      [userId]
    )
    return rows.rows
  }

  async chooseNudgeVariant(userId, experimentKey = 'overspend') {
    const variants = await this.getAdaptiveNudgePolicy(userId)
    const candidates = variants.filter(v => v.experiment_key === experimentKey && !v.do_not_disturb)
    const byReward = candidates.sort((a, b) => (b.reward_score || 0) - (a.reward_score || 0))
    return byReward[0] || null
  }

  async recordNudgeExposure(userId, experimentKey, variantKey, accepted = false) {
    await db.query(
      `UPDATE nudge_experiments
       SET delivered_count = delivered_count + 1,
           accepted_count = accepted_count + CASE WHEN $4 THEN 1 ELSE 0 END,
           reward_score = (CAST(accepted_count + CASE WHEN $4 THEN 1 ELSE 0 END AS REAL) / CAST(delivered_count + 1 AS REAL)) * 100,
           updated_at = datetime('now')
       WHERE user_id = $1 AND experiment_key = $2 AND variant_key = $3 AND do_not_disturb = 0`,
      [userId, experimentKey, variantKey, accepted]
    )
    return { success: true }
  }

  async createMicroLearningCard(userId, triggerType, title, content, ctaLabel, ctaAction) {
    const result = await db.query(
      `INSERT INTO micro_learning_cards (id, user_id, trigger_type, title, content, cta_label, cta_action)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, triggerType, title, content, ctaLabel, ctaAction]
    )
    return result.rows[0]
  }

  async listMicroLearningCards(userId) {
    const rows = await db.query(
      `SELECT * FROM micro_learning_cards WHERE user_id = $1 ORDER BY is_completed ASC, created_at DESC LIMIT 20`,
      [userId]
    )
    return rows.rows
  }

  async completeMicroCard(userId, cardId) {
    await db.query(
      `UPDATE micro_learning_cards SET is_completed = 1, completed_at = datetime('now') WHERE id = $1 AND user_id = $2`,
      [cardId, userId]
    )
    return { success: true }
  }

  async createCommitmentContract(userId, groupId, contractType, targetValue, stakeAmount, dueDate) {
    const result = await db.query(
      `INSERT INTO commitment_contracts (id, group_id, user_id, contract_type, target_value, stake_amount, due_date)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [groupId, userId, contractType, targetValue, stakeAmount || 0, dueDate || null]
    )

    try {
      const petEngine = require('./PetEngine')
      await petEngine.triggerPetReaction(userId, 'contract_created', { contract_type: contractType })
    } catch (e) { /* Pet errors non-blocking */ }

    return result.rows[0]
  }

  async resolveCommitmentContract(userId, contractId, status, note) {
    const contract = await db.query(
      `SELECT * FROM commitment_contracts WHERE id = $1 AND user_id = $2`,
      [contractId, userId]
    )
    if (!contract.rows.length) return { error: 'Contract not found' }
    const c = contract.rows[0]

    let redirectGoalId = null
    let lockUntil = null

    if (status === 'failed' && parseFloat(c.stake_amount || 0) > 0) {
      const stake = parseFloat(c.stake_amount)
      let goal = await db.query(
        `SELECT id FROM goals WHERE user_id = $1 AND category = 'emergency' AND is_active = 1 LIMIT 1`,
        [userId]
      )

      if (goal.rows.length) {
        await db.query(
          `UPDATE goals SET current_amount = current_amount + $1, updated_at = datetime('now') WHERE id = $2`,
          [stake, goal.rows[0].id]
        )
        redirectGoalId = goal.rows[0].id
      } else {
        const result = await db.query(
          `INSERT INTO goals (id, user_id, name, target_amount, current_amount, category, priority)
           VALUES (gen_random_uuid(), $1, 'Emergency Fund (Redirected Stake)', $2, $3, 'emergency', 'high')
           RETURNING id`,
          [userId, Math.max(stake, 500), stake]
        )
        redirectGoalId = result.rows[0].id
      }

      lockUntil = new Date()
      lockUntil.setDate(lockUntil.getDate() + 30)
      await db.query(
        `UPDATE goals SET updated_at = datetime('now') WHERE id = $1`,
        [redirectGoalId]
      )
    }

    await db.query(
      `UPDATE commitment_contracts SET status = $1, resolution_note = $2, resolved_at = datetime('now'),
       stake_redirect_goal_id = $5, stake_locked_until = $6
       WHERE id = $3 AND user_id = $4`,
      [status, note || '', contractId, userId, redirectGoalId, lockUntil ? lockUntil.toISOString().split('T')[0] : null]
    )

    // Pet reaction
    try {
      const petEngine = require('./PetEngine')
      if (status === 'completed') {
        await petEngine.triggerPetReaction(userId, 'contract_completed', { contract_type: c.contract_type })
      } else if (status === 'failed') {
        await petEngine.triggerPetReaction(userId, 'contract_failed', { contract_type: c.contract_type, stake: c.stake_amount })
      }
    } catch (e) { /* Pet errors non-blocking */ }

    return { success: true, redirect_goal_id: redirectGoalId, locked_until: lockUntil }
  }

  async listCommitmentContracts(userId, groupId) {
    const params = [userId]
    let where = 'user_id = $1'
    if (groupId) {
      where += ' AND group_id = $2'
      params.push(groupId)
    }
    const result = await db.query(
      `SELECT * FROM commitment_contracts WHERE ${where} ORDER BY created_at DESC LIMIT 50`,
      params
    )
    return result.rows
  }

  async getRecommendedContracts(userId) {
    const score = await this.computeResilienceScore(userId)
    const existing = await this.listCommitmentContracts(userId)
    const activeTypes = new Set(existing.filter(c => c.status === 'active').map(c => c.contract_type))
    const recommendations = []

    if (score.debtPressure > 40 && !activeTypes.has('no_new_debt')) {
      recommendations.push({
        contract_type: 'no_new_debt',
        target_value: 0,
        stake_amount: 10,
        due_date_offset_days: 30,
        reason: 'High debt pressure detected — commit to no new BNPL/loans this month',
        label: 'No New Debt This Month',
      })
    }

    if (score.spendingVolatility > 40 && !activeTypes.has('weekend_cap')) {
      recommendations.push({
        contract_type: 'weekend_cap',
        target_value: 50,
        stake_amount: 5,
        due_date_offset_days: 7,
        reason: 'Your spending is volatile on weekends — cap weekend spend at RM50',
        label: 'Weekend Spending ≤ RM50',
      })
    }

    if (score.savingsRate < 15) {
      const suggestedSave = Math.max(20, Math.round((score.savingsRate < 5 ? 50 : 30)))
      const key = `save_${suggestedSave}_weekly`
      if (!activeTypes.has(key)) {
        recommendations.push({
          contract_type: key,
          target_value: suggestedSave,
          stake_amount: Math.round(suggestedSave * 0.15),
          due_date_offset_days: 7,
          reason: `Savings rate is only ${score.savingsRate}% — try saving RM${suggestedSave} this week`,
          label: `Save RM${suggestedSave} This Week`,
        })
      }
    }

    return recommendations
  }

  async acceptContractRecommendation(userId, recommendation) {
    const groups = await db.query(
      `SELECT id FROM savings_groups WHERE created_by = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    )
    const groupId = groups.rows[0]?.id
    if (!groupId) return { error: 'Join or create a savings group first' }

    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + (recommendation.due_date_offset_days || 7))
    const dueDateStr = dueDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })

    const contract = await this.createCommitmentContract(
      userId, groupId, recommendation.contract_type,
      recommendation.target_value, recommendation.stake_amount, dueDateStr
    )

    await this.logIntervention(userId, {
      intervention_type: 'contract_recommendation_accepted',
      variant_key: recommendation.contract_type,
      status: 'accepted',
      context: { recommendation },
    })

    return contract
  }

  async checkExpiringContracts(userId) {
    const now = new Date()
    const nearExpiry = await db.query(
      `SELECT * FROM commitment_contracts WHERE user_id = $1 AND status = 'active'
       AND due_date IS NOT NULL AND due_date <= datetime('now', '+4 hours') AND due_date > datetime('now')`,
      [userId]
    )
    const petEngine = require('./PetEngine')
    for (const c of nearExpiry.rows) {
      const hours = Math.max(1, Math.round((new Date(c.due_date) - now) / (1000 * 60 * 60)))
      await petEngine.triggerPetReaction(userId, 'contract_expiring', { contract_type: c.contract_type, hours: String(hours) })
    }
    return { checked: nearExpiry.rows.length }
  }

  async checkAllExpiringContracts() {
    const users = await db.query(`SELECT DISTINCT user_id FROM commitment_contracts WHERE status = 'active' AND due_date IS NOT NULL AND due_date <= datetime('now', '+4 hours') AND due_date > datetime('now')`)
    for (const row of users.rows) {
      await this.checkExpiringContracts(row.user_id)
    }
    return { checked: users.rows.length }
  }

  async autoArbitrateContracts(userId) {
    const active = await db.query(
      `SELECT * FROM commitment_contracts WHERE user_id = $1 AND status = 'active'
       AND due_date IS NOT NULL AND due_date <= datetime('now', '+8 hours')`,
      [userId]
    )
    const results = []
    for (const c of active.rows) {
      const outcome = await this._verifyContract(userId, c)
      if (outcome.autoCompleted) {
        await this.resolveCommitmentContract(userId, c.id, 'completed', 'Auto-verified by AI arbitration')
        await nudgeEngine.createNudge(
          userId, 'contract_arbitration',
          'Contract Auto-Verified',
          `Your "${c.contract_type}" contract was automatically verified. Well done!`,
          { priority: 'normal', context: { contract_id: c.id, contract_type: c.contract_type } }
        )
        try {
          const petEngine = require('./PetEngine')
          await petEngine.awardContractXp(userId)
        } catch (e) {}
        results.push({ contractId: c.id, autoCompleted: true, reason: outcome.reason })
      } else if (outcome.autoFailed) {
        await this.resolveCommitmentContract(userId, c.id, 'failed', 'Auto-failed by AI arbitration: ' + outcome.reason)
        await nudgeEngine.createNudge(
          userId, 'contract_arbitration',
          'Contract Auto-Failed',
          `Your "${c.contract_type}" contract was not fulfilled. Stake redirected to emergency savings.`,
          { priority: 'high', context: { contract_id: c.id, contract_type: c.contract_type } }
        )
        results.push({ contractId: c.id, autoCompleted: false, reason: outcome.reason })
      }
    }
    return results
  }

  async _verifyContract(userId, contract) {
    const aiEngine = require('./AIEngine')
    const since = contract.created_at
      ? new Date(contract.created_at).toISOString().split('T')[0]
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    let violationFound = false
    let fulfilmentFound = false
    let violationReason = ''

    const txns = await db.query(
      `SELECT * FROM transactions WHERE user_id = $1 AND type = 'debit'
       AND transaction_date >= $2`,
      [userId, since]
    )

    if (contract.contract_type === 'no_new_debt') {
      for (const t of txns.rows) {
        const cat = await aiEngine.categoriseTransaction({ merchant: t.merchant, description: t.description })
        if (/bnpl|loan|paylater|pinjaman/i.test(cat)) {
          violationFound = true
          violationReason = `BNPL/loan transaction detected: ${t.merchant || t.description}`
          break
        }
      }
      fulfilmentFound = !violationFound
    } else if (contract.contract_type === 'weekend_cap') {
      const maxAllowed = parseFloat(contract.target_value || 50)
      for (const t of txns.rows) {
        const d = new Date(t.transaction_date)
        if (d.getDay() === 0 || d.getDay() === 6) {
          if (parseFloat(t.amount) > maxAllowed) {
            violationFound = true
            violationReason = `Weekend spend of RM${t.amount} exceeds RM${maxAllowed} cap at ${t.merchant}`
            break
          }
        }
      }
      fulfilmentFound = !violationFound
    } else if (contract.contract_type && contract.contract_type.startsWith('save_')) {
      const targetSave = parseFloat(contract.target_value || 0)
      const credits = await db.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
         WHERE user_id = $1 AND type = 'credit' AND category = 'savings'
         AND transaction_date >= $2`,
        [userId, since]
      )
      const saved = parseFloat(credits.rows[0]?.total || 0)
      if (saved >= targetSave) {
        fulfilmentFound = true
      } else {
        violationFound = true
        violationReason = `Only saved RM${saved.toFixed(2)} of RM${targetSave} target`
      }
    }

    if (contract.due_date) {
      const now = new Date()
      const due = new Date(contract.due_date)
      if (now > due && !fulfilmentFound) {
        return { autoFailed: true, reason: 'Contract expired without fulfilment: ' + violationReason }
      }
    }

    if (fulfilmentFound) {
      return { autoCompleted: true, reason: 'Contract conditions met based on transaction history' }
    }

    return { autoCompleted: false, autoFailed: false, reason: 'Pending — deadline not yet reached' }
  }

  async runAutoArbitration() {
    const users = await db.query(
      `SELECT DISTINCT user_id FROM commitment_contracts WHERE status = 'active' AND due_date IS NOT NULL`
    )
    const all = []
    for (const row of users.rows) {
      const results = await this.autoArbitrateContracts(row.user_id)
      all.push({ userId: row.user_id, results })
    }
    return all
  }

  // === COOL-DOWN LIST (48-hour deferral) ===

  async predictPurchaseImpact(userId, amount) {
    if (!amount || amount <= 0) return { impact: 'low', message: 'Enter an amount to see the impact prediction' }
    const score = await this.computeResilienceScore(userId)
    const income = await db.query(`SELECT monthly_income FROM users WHERE id = $1`, [userId])
    const monthlyIncome = parseFloat(income.rows[0]?.monthly_income || 0)
    const remainingBudget = monthlyIncome > 0 ? monthlyIncome - (monthlyIncome * (score.savingsRate / 100)) : 0
    const projectedEndBalance = remainingBudget - amount
    const impact = projectedEndBalance <= 0
      ? 'critical'
      : projectedEndBalance < remainingBudget * 0.2
        ? 'high'
        : projectedEndBalance < remainingBudget * 0.5
          ? 'medium'
          : 'low'
    const messages = {
      critical: `AI predicts this RM${amount} spend will zero out your month-end balance. 20% of users who wait 48h abandon similar purchases.`,
      high: `This RM${amount} spend would leave you with only RM${projectedEndBalance.toFixed(0)} for the rest of the month. Consider a 48h cool-down.`,
      medium: `This RM${amount} purchase is manageable but represents ${(amount / Math.max(remainingBudget, 1) * 100).toFixed(0)}% of your remaining budget.`,
      low: `This RM${amount} spend looks safe. Your remaining budget allows it comfortably.`,
    }
    return { impact, message: messages[impact], projectedEndBalance: Math.max(0, projectedEndBalance).toFixed(2) }
  }

  async addToCooldown(userId, merchant, amount, description, predictedImpact) {
    const deferredUntil = new Date()
    deferredUntil.setHours(deferredUntil.getHours() + 48)
    const deferredStr = deferredUntil.toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }) + ' ' +
      deferredUntil.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kuala_Lumpur' })

    const result = await db.query(
      `INSERT INTO cool_down_entries (user_id, merchant, amount, description, predicted_impact, deferred_until)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, merchant || 'Purchase', parseFloat(amount), description || '', predictedImpact || '', deferredStr]
    )

    await nudgeEngine.createNudge(
      userId, 'cool_down_added',
      'Purchase Added to Cool-Down',
      `RM${amount} ${merchant ? 'at ' + merchant : ''} — revisit in 48h before deciding.`,
      { priority: 'normal', context: { entry_id: result.rows[0].id, amount, merchant } }
    )

    return result.rows[0]
  }

  async getCooldownList(userId) {
    await db.query(
      `UPDATE cool_down_entries SET status = 'expired', abandoned_at = datetime('now', '+8 hours')
       WHERE user_id = $1 AND status = 'pending' AND datetime(deferred_until) < datetime('now', '+8 hours')`,
      [userId]
    )
    const rows = await db.query(
      `SELECT * FROM cool_down_entries WHERE user_id = $1 ORDER BY
        CASE status WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'abandoned' THEN 2 WHEN 'expired' THEN 3 END,
        created_at DESC`,
      [userId]
    )
    return rows.rows
  }

  async confirmCooldownEntry(userId, entryId) {
    const entry = await db.query(
      `UPDATE cool_down_entries SET status = 'confirmed', confirmed_at = datetime('now', '+8 hours')
       WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING *`,
      [entryId, userId]
    )
    if (!entry.rows.length) return { error: 'Entry not found or already processed' }
    return entry.rows[0]
  }

  async abandonCooldownEntry(userId, entryId) {
    const entry = await db.query(
      `UPDATE cool_down_entries SET status = 'abandoned', abandoned_at = datetime('now', '+8 hours')
       WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING *`,
      [entryId, userId]
    )
    if (!entry.rows.length) return { error: 'Entry not found or already processed' }
    return entry.rows[0]
  }

  async autoApplyDeferral(userId, amount, merchant, description) {
    const prediction = await this.predictPurchaseImpact(userId, amount)
    if (prediction.impact === 'critical' || prediction.impact === 'high') {
      const entry = await this.addToCooldown(userId, merchant, amount, description, prediction.message)
      return { deferred: true, entry, prediction }
    }
    return { deferred: false, prediction }
  }

  // === DYNAMIC BUDGET RESET ===

  async applyBudgetReset(userId, overspentAmount) {
    const settings = await db.query(
      `SELECT * FROM autopilot_settings WHERE user_id = $1 AND is_active = 1`,
      [userId]
    )
    if (!settings.rows.length) return { error: 'Autopilot not active' }

    const s = settings.rows[0]
    const currentDailyTotal = parseFloat(s.daily_spending_total || 0)
    const reductionFactor = Math.min(0.5, Math.max(0.1, (parseFloat(overspentAmount || 0) / Math.max(currentDailyTotal, 1))))
    const newDailyTotal = Math.round(currentDailyTotal * (1 - reductionFactor) * 100) / 100

    await db.query(
      `UPDATE autopilot_settings SET daily_spending_total = $1, updated_at = datetime('now') WHERE user_id = $2`,
      [newDailyTotal, userId]
    )

    const oldDaily = currentDailyTotal / 30
    const newDaily = newDailyTotal / 30

    await nudgeEngine.createNudge(
      userId, 'budget_reset',
      'Budget Auto-Adjusted',
      `Overspending detected. Daily limit reduced from RM${oldDaily.toFixed(0)} to RM${newDaily.toFixed(0)} for the rest of the month to protect your essentials.`,
      { priority: 'high', context: { old_daily_total: currentDailyTotal, new_daily_total: newDailyTotal, overspent: overspentAmount } }
    )

    try {
      const petEngine = require('./PetEngine')
      await petEngine.triggerPetReaction(userId, 'budget_reset', { oldLimit: oldDaily.toFixed(0), newLimit: newDaily.toFixed(0) })
    } catch (e) {}

    return { oldDailyTotal: currentDailyTotal, newDailyTotal, oldDailyLimit: Number(oldDaily.toFixed(2)), newDailyLimit: Number(newDaily.toFixed(2)) }
  }

  async tryAutoBudgetReset(userId) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })
    const dailyLog = await db.query(
      `SELECT * FROM autopilot_daily_logs WHERE user_id = $1 AND log_date = $2`,
      [userId, today]
    )
    if (!dailyLog.rows.length) return null

    const log = dailyLog.rows[0]
    const spent = parseFloat(log.spent || 0)
    const limit = parseFloat(log.daily_limit || 0)
    if (limit > 0 && spent > limit) {
      const overspent = spent - limit
      return await this.applyBudgetReset(userId, overspent)
    }
    return null
  }

  // === SAVINGS MULTIPLIER ADJUSTMENT ===

  async adjustRoundUpMultiplier(userId, newMultiplier) {
    const existing = await db.query(
      `SELECT * FROM autosave_rules WHERE user_id = $1 AND rule_type = 'round_up' AND is_active = 1`,
      [userId]
    )
    if (existing.rows.length) {
      const oldMultiplier = parseFloat(existing.rows[0].roundup_multiplier || 1.0)
      await db.query(
        `UPDATE autosave_rules SET roundup_multiplier = $1, updated_at = datetime('now') WHERE id = $2`,
        [newMultiplier, existing.rows[0].id]
      )
      await nudgeEngine.createNudge(
        userId, 'multiplier_adjusted',
        'Round-Up Multiplier Increased',
        `Your round-up savings rate was boosted from ${oldMultiplier.toFixed(1)}x to ${newMultiplier.toFixed(1)}x to help rebuild your buffer faster.`,
        { priority: 'normal', context: { old_multiplier: oldMultiplier, new_multiplier: newMultiplier } }
      )
      try {
        const petEngine = require('./PetEngine')
        await petEngine.triggerPetReaction(userId, 'multiplier_adjusted', { oldMul: oldMultiplier.toFixed(1), newMul: newMultiplier.toFixed(1) })
      } catch (e) {}
      return { oldMultiplier, newMultiplier }
    }
    return { error: 'No active round-up rule found' }
  }

  async tryAutoIncreaseMultiplier(userId) {
    const risks = await this.detectDebtRisks(userId)
    if (risks.length > 0) {
      return await this.adjustRoundUpMultiplier(userId, 2.0)
    }
    return { noAction: true }
  }

  async tryAutoResetMultiplier(userId) {
    const rules = await db.query(
      `SELECT * FROM autosave_rules WHERE user_id = $1 AND rule_type = 'round_up' AND is_active = 1 AND roundup_multiplier > 1.0`,
      [userId]
    )
    if (!rules.rows.length) return { noAction: true }
    const daysSince = rules.rows.length ? Math.round((Date.now() - new Date(rules.rows[0].updated_at || rules.rows[0].created_at).getTime()) / (1000 * 60 * 60 * 24)) : 0
    if (daysSince >= 7) {
      return await this.adjustRoundUpMultiplier(userId, 1.0)
    }
    return { noAction: true, daysRemaining: 7 - daysSince }
  }

  // === ENHANCE BEFORE-SPEND ACTIONS ===

  async getBeforeSpendActions(userId) {
    const profile = await db.query(`SELECT * FROM autopilot_profiles WHERE user_id = $1`, [userId])
    const activeMode = profile.rows[0]?.mode_key || 'first_salary_mode'
    return [
      { key: 'defer_purchase', label: 'Defer purchase for 48 hours', impact: 'Reduces impulse debt risk by ~20%' },
      { key: 'reduce_category_cap', label: 'Reduce food/shopping cap by RM40', impact: 'Lowers projected shortfall this month' },
      { key: 'increase_roundup', label: 'Increase round-up multiplier by 0.2x', impact: `Boosts micro-saving in ${activeMode}` },
    ]
  }

  async computeRunwayBreakdown(userId) {
    const monthlySpend = await db.query(
      `SELECT COALESCE(AVG(monthly), 0) AS avg_monthly FROM (
        SELECT strftime('%Y-%m', transaction_date) AS month, COALESCE(SUM(amount), 0) AS monthly
        FROM transactions WHERE user_id = $1 AND type = 'debit' AND transaction_date >= datetime('now', '-90 days')
        GROUP BY strftime('%Y-%m', transaction_date)
      )`,
      [userId]
    )
    const avgMonthlySpend = parseFloat(monthlySpend.rows[0]?.avg_monthly || 0)

    const emergency = await db.query(
      `SELECT COALESCE(SUM(current_amount), 0) AS total FROM goals WHERE user_id = $1 AND category = 'emergency' AND is_active = 1`,
      [userId]
    )
    const emergencyFund = parseFloat(emergency.rows[0]?.total || 0)

    const dailyAvg = avgMonthlySpend > 0 ? avgMonthlySpend / 30 : 0
    const survivalDays = dailyAvg > 0 ? Math.floor(emergencyFund / dailyAvg) : 0

    const spend30 = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE user_id = $1 AND type = 'debit' AND transaction_date >= datetime('now', '-30 days')`,
      [userId]
    )
    const last30Spend = parseFloat(spend30.rows[0]?.total || 0)

    return {
      emergencyFund: Number(emergencyFund.toFixed(2)),
      avgMonthlySpend: Number(avgMonthlySpend.toFixed(2)),
      last30DaysSpend: Number(last30Spend.toFixed(2)),
      dailyAvg: Number(dailyAvg.toFixed(2)),
      survivalDays,
      breakdownText: emergencyFund > 0 && avgMonthlySpend > 0
        ? `Based on your average monthly spending of RM${avgMonthlySpend.toFixed(0)} over the last 3 months, your current savings of RM${emergencyFund.toFixed(0)} can sustain you for exactly ${survivalDays} days.`
        : emergencyFund > 0
          ? `Your emergency fund of RM${emergencyFund.toFixed(0)} is ready. Start logging expenses to see your exact runway.`
          : `Set up an emergency fund goal to calculate your financial runway.`,
    }
  }
}

module.exports = new ResilienceEngine()
