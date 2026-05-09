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
      ? 'Debt risk events increased this week.'
      : (savingsRate >= 20 ? 'Healthy savings rate improved your score.' : 'Savings rate needs improvement.')
    const nextBestAction = debtPressure > 40
      ? 'Activate debt-trap protection and reduce discretionary spend by RM50 this week.'
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
    return result.rows[0]
  }

  async resolveCommitmentContract(userId, contractId, status, note) {
    await db.query(
      `UPDATE commitment_contracts SET status = $1, resolution_note = $2, resolved_at = datetime('now')
       WHERE id = $3 AND user_id = $4`,
      [status, note || '', contractId, userId]
    )
    return { success: true }
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
}

module.exports = new ResilienceEngine()
