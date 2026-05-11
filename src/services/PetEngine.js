const db = require('../database/connection')
const resilienceEngine = require('./ResilienceEngine')

class PetEngine {
  stageThresholds = { seedling: 0, growing: 100, matured: 500 }

  moods = [
    { min: 80, key: 'thriving', emoji: '🌟', label: 'Thriving' },
    { min: 60, key: 'happy', emoji: '😊', label: 'Happy' },
    { min: 40, key: 'neutral', emoji: '😐', label: 'Neutral' },
    { min: 20, key: 'weak', emoji: '😔', label: 'Weak' },
    { min: 0, key: 'critical', emoji: '😢', label: 'Critical' },
  ]

  dialogueTemplates = {
    morning_thriving: ["Good morning! You have RM{dailyLimit} to spend today. Let's keep this momentum!", "Another day, another win! Your finances are looking great!"],
    morning_happy: ["Good morning! Your RM{dailyLimit} daily budget awaits. Let's make it count!", "Rise and shine! Yesterday was good, let's keep it up!"],
    morning_neutral: ["Morning! You have RM{dailyLimit} today. Small steps lead to big savings!", "Hey there! Let's try to stay within budget today, okay?"],
    morning_weak: ["Good morning... I'm feeling a bit under the weather. Can we watch our spending today?", "Hey... I could really use a no-spend day to recover. Can we try?"],
    morning_critical: ["I need your help... My health is really low. Please be careful with spending today.", "SOS! I'm struggling. A good day today would really help me recover!"],
    overspend: ["Ouch! We went RM{over} over today's budget. I'm feeling a bit weak…", "That last purchase pushed us over. Can we balance it out tomorrow?"],
    underspend: ["Nice! We stayed RM{saved} under budget today. I feel stronger!", "Great discipline today! I can feel myself growing."],
    streak_extend: ["Day {count}! You're on fire! I grew another leaf because of you!", "{count} days strong! Together we're building something amazing!"],
    streak_break: ["Oh no, the streak broke... But we can start fresh today!", "I lost a leaf... But every expert was once a beginner. Let's go again!"],
    salary_detected: ["Salary landed! RM{autoSaved} has been pre-deducted to your safety net. Smart move!", "Pay day! Your autopilot already saved RM{autoSaved}. Future you says thanks!"],
    debt_risk: ["Warning: I'm sensing financial pressure. Let's review together.", "I detected a risky pattern. Can we be extra careful this week?"],
    goal_progress: ["Your {goalName} just hit {percent}%! I can feel myself getting taller!", "Amazing progress on {goalName}! We're {percent}% there!"],
    budget_warning: ["Your {category} budget is {percent}% gone. Let's slow down on that!", "Watch out! {category} spending is getting close to the limit."],
    evolution: ["I EVOLVED! Thank you for taking such great care of me! 🎉", "Look at me now! Your consistent good habits helped me grow! ✨"],
    contract_created: ["A new contract! I'll be watching over this one. You've got this!", "Contract signed! I'll help you stay accountable for {contract_type}!"],
    contract_completed: ["Contract complete! You did it! Here's some XP for your effort 🎉", "Amazing! You fulfilled your {contract_type} contract! I'm so proud!"],
    contract_failed: ["Oh no, the {contract_type} contract didn't work out. The stake went to emergency savings though!", "We stumbled on {contract_type}. Let's learn and try again!"],
    contract_expiring: ["Your {contract_type} contract expires in {hours} hours! Better wrap it up!", "Time's almost up on {contract_type}! I'm getting nervous..."],
    budget_reset: ["Your daily limit just dropped from RM{oldLimit} to RM{newLimit} — let's make every ringgit count!", "I tightened the belt for us. Daily spend is now RM{newLimit} to protect your essentials."],
    multiplier_adjusted: ["I cranked up your round-up from {oldMul}x to {newMul}x — every sen you spend now works double duty!", "Round-up boost active! {newMul}x on every purchase means faster savings growth."],
  }

  async awardContractXp(userId) {
    await db.query(
      `UPDATE pet_state SET evolution_points = evolution_points + 10, updated_at = datetime('now') WHERE user_id = $1`,
      [userId]
    )
    return { xpAwarded: 10 }
  }

  _getMood(hp) {
    for (const m of this.moods) {
      if (hp >= m.min) return m
    }
    return this.moods[this.moods.length - 1]
  }

  _getStage(ep) {
    if (ep >= this.stageThresholds.matured) return 'matured'
    if (ep >= this.stageThresholds.growing) return 'growing'
    return 'seedling'
  }

  _pickDialogue(key, vars = {}) {
    const templates = this.dialogueTemplates[key]
    if (!templates || templates.length === 0) return null
    let msg = templates[Math.floor(Math.random() * templates.length)]
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), v)
    }
    return msg
  }

  async ensurePetState(userId) {
    const existing = await db.query(`SELECT * FROM pet_state WHERE user_id = $1`, [userId])
    if (existing.rows.length) return existing.rows[0]

    await db.query(
      `INSERT INTO pet_state (user_id, hp, evolution_points, stage, mood, active_days)
       VALUES ($1, 50, 0, 'seedling', 'happy', 0)`,
      [userId]
    )
    const result = await db.query(`SELECT * FROM pet_state WHERE user_id = $1`, [userId])
    return result.rows[0]
  }

  async getPetStatus(userId) {
    const petState = await this.ensurePetState(userId)
    const hp = await this._computeHP(userId)
    const mood = this._getMood(hp)
    const stage = this._getStage(petState.evolution_points)
    const ep = petState.evolution_points || 0

    // Update stored state
    await db.query(
      `UPDATE pet_state SET hp = $1, mood = $2, stage = $3, updated_at = datetime('now') WHERE user_id = $4`,
      [hp, mood.key, stage, userId]
    )

    // Get active dialogue
    const dialogue = await this._getActiveDialogue(userId)

    // Compute stage progress
    let nextThreshold = this.stageThresholds.growing
    let currentBase = 0
    if (stage === 'growing') {
      currentBase = this.stageThresholds.growing
      nextThreshold = this.stageThresholds.matured
    } else if (stage === 'matured') {
      currentBase = this.stageThresholds.matured
      nextThreshold = this.stageThresholds.matured // Already max
    }
    const stageProgress = stage === 'matured' ? 100 : Math.min(100, ((ep - currentBase) / (nextThreshold - currentBase)) * 100)

    // Get available rewards
    const rewards = await this._getRewards(userId, stage)

    return {
      hp: Math.max(0, Math.min(100, hp)),
      mood: mood.key,
      moodEmoji: mood.emoji,
      moodLabel: mood.label,
      stage,
      evolutionPoints: ep,
      stageProgress: Math.round(stageProgress),
      nextStageAt: stage === 'matured' ? null : nextThreshold,
      dialogue,
      rewards,
      components: await this._getHPComponents(userId),
    }
  }

  async _computeHP(userId) {
    // 1. Resilience Score (50%)
    let resilienceScore = 50
    try {
      const resilience = await resilienceEngine.computeResilienceScore(userId)
      resilienceScore = resilience.score || 50
    } catch (e) { /* Use default */ }

    // 2. Daily Quota Compliance (25%)
    let quotaCompliance = 50
    try {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })
      const settings = await db.query(`SELECT * FROM autopilot_settings WHERE user_id = $1 AND is_active = 1`, [userId])
      if (settings.rows.length) {
        const s = settings.rows[0]
        const daysInMonth = new Date().getDate() || 1
        const baseDaily = s.daily_spending_total / daysInMonth
        const dailyLog = await db.query(
          `SELECT * FROM autopilot_daily_logs WHERE user_id = $1 AND log_date = $2`, [userId, today]
        )
        if (dailyLog.rows.length) {
          const todaySpent = parseFloat(dailyLog.rows[0].spent || 0)
          const todayLimit = parseFloat(dailyLog.rows[0].daily_limit || baseDaily)
          quotaCompliance = todayLimit > 0 ? Math.min(100, Math.max(0, ((todayLimit - todaySpent) / todayLimit) * 100)) : 50
        } else {
          quotaCompliance = 80 // Autopilot active but no spending yet today = good
        }
      }
    } catch (e) { /* Use default */ }

    // 3. Streak Bonus (15%)
    let streakBonus = 0
    try {
      const streak = await db.query(`SELECT current_streak FROM savings_streaks WHERE user_id = $1`, [userId])
      streakBonus = Math.min(100, (parseInt(streak.rows[0]?.current_streak || 0, 10)) * 5)
    } catch (e) { /* Use default */ }

    // 4. Goal Momentum (10%)
    let goalMomentum = 0
    try {
      const goals = await db.query(
        `SELECT AVG(CASE WHEN target_amount > 0 THEN MIN(100.0, (current_amount * 100.0 / target_amount)) ELSE 0 END) AS avg_progress
         FROM goals WHERE user_id = $1 AND is_active = 1`, [userId]
      )
      goalMomentum = parseFloat(goals.rows[0]?.avg_progress || 0)
    } catch (e) { /* Use default */ }

    const hp = Math.round(
      (resilienceScore * 0.50) +
      (quotaCompliance * 0.25) +
      (streakBonus * 0.15) +
      (goalMomentum * 0.10)
    )

    return Math.max(0, Math.min(100, hp))
  }

  async _getHPComponents(userId) {
    let resilienceScore = 50, quotaCompliance = 50, streakBonus = 0, goalMomentum = 0
    try {
      const resilience = await resilienceEngine.computeResilienceScore(userId)
      resilienceScore = resilience.score || 50
    } catch (e) {}
    try {
      const streak = await db.query(`SELECT current_streak FROM savings_streaks WHERE user_id = $1`, [userId])
      streakBonus = Math.min(100, (parseInt(streak.rows[0]?.current_streak || 0, 10)) * 5)
    } catch (e) {}
    try {
      const goals = await db.query(
        `SELECT AVG(CASE WHEN target_amount > 0 THEN MIN(100.0, (current_amount * 100.0 / target_amount)) ELSE 0 END) AS avg_progress
         FROM goals WHERE user_id = $1 AND is_active = 1`, [userId]
      )
      goalMomentum = parseFloat(goals.rows[0]?.avg_progress || 0)
    } catch (e) {}
    return {
      resilienceScore: Math.round(resilienceScore),
      quotaCompliance: Math.round(quotaCompliance),
      streakBonus: Math.round(streakBonus),
      goalMomentum: Math.round(goalMomentum),
    }
  }

  async calculateDailyEP(userId) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })
    const petState = await this.ensurePetState(userId)

    // Check if EP already calculated for today
    const existing = await db.query(
      `SELECT * FROM pet_ep_log WHERE user_id = $1 AND ep_date = $2`, [userId, today]
    )
    if (existing.rows.length) return { epToday: existing.rows[0].ep_earned, totalEp: petState.evolution_points, alreadyCalculated: true }

    let ep = 0
    const breakdown = {}

    // Savings streak active (+2)
    const streak = await db.query(`SELECT current_streak FROM savings_streaks WHERE user_id = $1`, [userId])
    if (parseInt(streak.rows[0]?.current_streak || 0, 10) > 0) {
      ep += 2; breakdown.streak = 2
    }

    // Under daily budget (+3)
    const settings = await db.query(`SELECT * FROM autopilot_settings WHERE user_id = $1 AND is_active = 1`, [userId])
    if (settings.rows.length) {
      const dailyLog = await db.query(
        `SELECT * FROM autopilot_daily_logs WHERE user_id = $1 AND log_date = $2`, [userId, today]
      )
      if (dailyLog.rows.length) {
        const spent = parseFloat(dailyLog.rows[0].spent || 0)
        const limit = parseFloat(dailyLog.rows[0].daily_limit || 0)
        if (limit > 0 && spent <= limit) {
          ep += 3; breakdown.underBudget = 3
        }
      } else {
        ep += 3; breakdown.underBudget = 3 // No spending today = under budget
      }
      // Pre-deduction active (+2)
      ep += 2; breakdown.preDeduction = 2
    }

    // Contributed to any goal today (+3)
    const goalContrib = await db.query(
      `SELECT COUNT(*) as count FROM autosave_transactions WHERE user_id = $1 AND date(executed_at) = $2`,
      [userId, today]
    )
    if (parseInt(goalContrib.rows[0]?.count || 0, 10) > 0) {
      ep += 3; breakdown.goalContribution = 3
    }

    // Completed a daily quest (+1)
    const questComplete = await db.query(
      `SELECT COUNT(*) as count FROM daily_quests WHERE user_id = $1 AND quest_date = $2 AND is_completed = 1`,
      [userId, today]
    )
    if (parseInt(questComplete.rows[0]?.count || 0, 10) > 0) {
      ep += 1; breakdown.questCompleted = 1
    }

    // No debt risk events this week (+2, checked weekly on Sunday)
    const dayOfWeek = new Date().getDay()
    if (dayOfWeek === 0) {
      const debtRisks = await db.query(
        `SELECT COUNT(*) as count FROM debt_risk_events WHERE user_id = $1 AND is_active = 1 AND created_at >= datetime('now', '-7 days')`,
        [userId]
      )
      if (parseInt(debtRisks.rows[0]?.count || 0, 10) === 0) {
        ep += 2; breakdown.noDebtRisk = 2
      }
    }

    // Store EP log
    await db.query(
      `INSERT INTO pet_ep_log (id, user_id, ep_date, ep_earned, breakdown)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)
       ON CONFLICT(user_id, ep_date) DO UPDATE SET ep_earned = $3, breakdown = $4`,
      [userId, today, ep, JSON.stringify(breakdown)]
    )

    // Update total EP and check evolution
    const newTotalEp = (petState.evolution_points || 0) + ep
    const oldStage = this._getStage(petState.evolution_points || 0)
    const newStage = this._getStage(newTotalEp)
    const evolved = newStage !== oldStage

    // Update active_days
    const newActiveDays = (petState.active_days || 0) + (ep > 0 ? 1 : 0)

    await db.query(
      `UPDATE pet_state SET evolution_points = $1, stage = $2, active_days = $3, updated_at = datetime('now')
       ${evolved ? ", last_evolution_at = datetime('now')" : ''}
       WHERE user_id = $4`,
      [newTotalEp, newStage, newActiveDays, userId]
    )

    // If evolved, create rewards
    if (evolved) {
      await this._createEvolutionRewards(userId, newStage)
      // Create evolution dialogue
      await this._createDialogue(userId, 'evolution', this._pickDialogue('evolution'), 'thriving', 'high')
    }

    return {
      epToday: ep,
      totalEp: newTotalEp,
      breakdown,
      evolved,
      oldStage: evolved ? oldStage : null,
      newStage: evolved ? newStage : null,
    }
  }

  async _createDialogue(userId, triggerType, message, emotion, priority = 'normal') {
    if (!message) return null
    await db.query(
      `INSERT INTO pet_dialogues (id, user_id, trigger_type, message, emotion, priority, expires_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, datetime('now', '+4 hours'))`,
      [userId, triggerType, message, emotion, priority]
    )
  }

  async _getActiveDialogue(userId) {
    const result = await db.query(
      `SELECT * FROM pet_dialogues WHERE user_id = $1 AND is_dismissed = 0
       AND (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY priority DESC, created_at DESC LIMIT 1`,
      [userId]
    )
    return result.rows[0] || null
  }

  async dismissDialogue(userId, dialogueId) {
    await db.query(
      `UPDATE pet_dialogues SET is_dismissed = 1, dismissed_at = datetime('now')
       WHERE id = $1 AND user_id = $2`, [dialogueId, userId]
    )
    return { success: true }
  }

  async triggerPetReaction(userId, event, context = {}) {
    const petState = await this.ensurePetState(userId)
    const hp = petState.hp || 50
    const mood = this._getMood(hp)
    let dialogueKey = null
    let vars = context

    switch (event) {
      case 'overspend':
        dialogueKey = 'overspend'
        break
      case 'underspend':
        dialogueKey = 'underspend'
        break
      case 'streak_extend':
        dialogueKey = 'streak_extend'
        break
      case 'streak_break':
        dialogueKey = 'streak_break'
        break
      case 'salary_detected':
        dialogueKey = 'salary_detected'
        break
      case 'debt_risk':
        dialogueKey = 'debt_risk'
        break
      case 'goal_progress':
        dialogueKey = 'goal_progress'
        break
      case 'budget_warning':
        dialogueKey = 'budget_warning'
        break
      case 'contract_created':
        dialogueKey = 'contract_created'
        break
      case 'contract_completed':
        dialogueKey = 'contract_completed'
        break
      case 'contract_failed':
        dialogueKey = 'contract_failed'
        break
      case 'contract_expiring':
        dialogueKey = 'contract_expiring'
        break
      case 'budget_reset':
        dialogueKey = 'budget_reset'
        break
      case 'multiplier_adjusted':
        dialogueKey = 'multiplier_adjusted'
        break
    }

    if (dialogueKey) {
      // Limit to 3 dialogues per day
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })
      const todayCount = await db.query(
        `SELECT COUNT(*) as count FROM pet_dialogues WHERE user_id = $1 AND date(created_at) = $2`,
        [userId, today]
      )
      if (parseInt(todayCount.rows[0]?.count || 0, 10) < 3) {
        const message = this._pickDialogue(dialogueKey, vars)
        const emotion = hp >= 60 ? 'happy' : hp >= 40 ? 'neutral' : 'weak'
        await this._createDialogue(userId, event, message, emotion)
      }
    }
  }

  async _createEvolutionRewards(userId, stage) {
    if (stage === 'growing') {
      const rewards = [
        { reward_type: 'pockets_boost', reward_value: '+0.20% p.a.', tier: 1 },
        { reward_type: 'grab_voucher', reward_value: 'RM5', tier: 1 },
        { reward_type: 'shopee_voucher', reward_value: 'RM3', tier: 1 },
      ]
      for (const r of rewards) {
        await db.query(
          `INSERT INTO pet_rewards (id, user_id, reward_tier, reward_type, reward_value, voucher_code, status, expires_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'available', datetime('now', '+30 days'))`,
          [userId, r.tier, r.reward_type, r.reward_value, 'GG-' + r.reward_type.toUpperCase().slice(0, 4) + '-' + Date.now().toString(36).toUpperCase()]
        )
      }
    } else if (stage === 'matured') {
      const rewards = [
        { reward_type: 'pockets_boost', reward_value: '+0.50% p.a.', tier: 2 },
        { reward_type: 'grab_voucher', reward_value: 'RM15', tier: 2 },
        { reward_type: 'shopee_voucher', reward_value: 'RM10', tier: 2 },
        { reward_type: 'roundup_cashback', reward_value: '0.5% monthly', tier: 2 },
      ]
      for (const r of rewards) {
        await db.query(
          `INSERT INTO pet_rewards (id, user_id, reward_tier, reward_type, reward_value, voucher_code, status, expires_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'available', datetime('now', '+60 days'))`,
          [userId, r.tier, r.reward_type, r.reward_value, 'GG-' + r.reward_type.toUpperCase().slice(0, 4) + '-' + Date.now().toString(36).toUpperCase()]
        )
      }
    }
  }

  async _getRewards(userId, stage) {
    const result = await db.query(
      `SELECT * FROM pet_rewards WHERE user_id = $1 ORDER BY reward_tier, created_at DESC`,
      [userId]
    )
    return result.rows
  }

  async claimReward(userId, rewardId) {
    const reward = await db.query(
      `SELECT * FROM pet_rewards WHERE id = $1 AND user_id = $2 AND status = 'available'`,
      [rewardId, userId]
    )
    if (!reward.rows.length) return { error: 'Reward not available' }

    await db.query(
      `UPDATE pet_rewards SET status = 'claimed', claimed_at = datetime('now') WHERE id = $1`,
      [rewardId]
    )
    return { success: true, reward: reward.rows[0] }
  }

  async getEPHistory(userId) {
    const result = await db.query(
      `SELECT * FROM pet_ep_log WHERE user_id = $1 ORDER BY ep_date DESC LIMIT 30`,
      [userId]
    )
    return result.rows
  }

  async generateMorningDialogue(userId) {
    const hp = await this._computeHP(userId)
    const mood = this._getMood(hp)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })

    // Check if morning dialogue already created today
    const existing = await db.query(
      `SELECT id FROM pet_dialogues WHERE user_id = $1 AND trigger_type LIKE 'morning_%' AND date(created_at) = $2`,
      [userId, today]
    )
    if (existing.rows.length) return null

    // Get daily limit for variable substitution
    let dailyLimit = '0'
    try {
      const settings = await db.query(`SELECT * FROM autopilot_settings WHERE user_id = $1 AND is_active = 1`, [userId])
      if (settings.rows.length) {
        const daysInMonth = new Date().getDate() || 1
        dailyLimit = (settings.rows[0].daily_spending_total / daysInMonth).toFixed(2)
      }
    } catch (e) {}

    const key = `morning_${mood.key}`
    const message = this._pickDialogue(key, { dailyLimit })
    if (message) {
      await this._createDialogue(userId, key, message, mood.key)
    }
    return message
  }
}

module.exports = new PetEngine()
