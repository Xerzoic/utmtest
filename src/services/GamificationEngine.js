const db = require('../database/connection')
const config = require('../config')
const nudgeEngine = require('./NudgeEngine')
const ilmuAIService = require('./IlmuAIService')

class GamificationEngine {
  constructor() {
    this.questPool = [
      { key: 'log_expense', title: 'Log an Expense', desc: 'Record at least 1 expense today', xp: 30, target: 1 },
      { key: 'save_5', title: 'Save RM5', desc: 'Save RM5 via auto-save or round-ups', xp: 50, target: 5 },
      { key: 'stay_under_50', title: 'Frugal Day', desc: 'Keep daily spending under RM50', xp: 40, target: 50 },
      { key: 'log_3_expenses', title: 'Triple Tracker', desc: 'Log 3 expenses in one day', xp: 45, target: 3 },
      { key: 'check_insights', title: 'Knowledge Seeker', desc: 'View your AI insights', xp: 20, target: 1 },
      { key: 'set_goal', title: 'Goal Setter', desc: 'Create a new savings goal', xp: 50, target: 1 },
      { key: 'zero_spend', title: 'Zero Hero', desc: 'Complete a zero-spend day', xp: 60, target: 0 },
      { key: 'join_group', title: 'Social Saver', desc: 'Join a savings clan', xp: 35, target: 1 },
    ]
    this.allBadges = {
      first_save: { name: 'First Step', description: 'Made your first automated save', icon: 'star' },
      streak_7: { name: 'Week Warrior', description: 'Saved 7 days in a row', icon: 'fire' },
      streak_21: { name: 'Habit Master', description: '21-day savings streak - you built a habit!', icon: 'crown' },
      streak_30: { name: 'Monthly Champion', description: '30-day savings streak', icon: 'diamond' },
      milestone_500: { name: 'First K Plus', description: 'Reached RM500 in total savings', icon: 'badge' },
      milestone_1000: { name: 'Grand RM1K', description: 'Reached RM1,000 in savings', icon: 'trophy' },
      milestone_5000: { name: 'Five Grand', description: 'RM5,000 saved - serious commitment', icon: 'medal' },
      milestone_10000: { name: 'Ten K Club', description: 'RM10,000 - top tier saver', icon: 'star' },
      goal_complete: { name: 'Goal Crusher', description: 'Completed your first savings goal', icon: 'check' },
      group_joiner: { name: 'Team Player', description: 'Joined a savings group', icon: 'users' },
      commitment_kept: { name: 'Man of Word', description: 'Kept a group savings commitment', icon: 'handshake' },
      round_up_100: { name: 'Penny Saver', description: 'Saved RM100 through round-ups', icon: 'coins' },
      salary_saver: { name: 'Paycheck Pro', description: 'Used salary-trigger for 3 months', icon: 'calendar' },
      budget_master: { name: 'Budget Master', description: 'Stayed under all budgets for a month', icon: 'shield' },
      no_spend_day: { name: 'Zero Hero', description: 'Completed a zero-spend day', icon: 'zap' },
    }
  }

  async awardSaveXP(userId, amount) {
    const xpEarned = config.gamification.xpPerSave + Math.floor(amount)

    const result = await db.query(
      `UPDATE gamification_profiles
       SET xp = xp + $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING xp, level`,
      [xpEarned, userId]
    )

    if (!result.rows.length) {
      await db.query(
        `INSERT INTO gamification_profiles (user_id, xp, level) VALUES ($1, $2, 1)`,
        [userId, xpEarned]
      )
    }

    await this.checkLevelUp(userId)

    return { xpEarned, totalXP: result.rows[0]?.xp || xpEarned }
  }

  async awardStreakXP(userId, days) {
    const xpEarned = config.gamification.xpPerStreakDay * Math.min(days, 7)

    await db.query(
      `UPDATE gamification_profiles
       SET xp = xp + $1, updated_at = NOW()
       WHERE user_id = $2`,
      [xpEarned, userId]
    )

    await this.checkLevelUp(userId)
    return { xpEarned }
  }

  async awardMilestoneXP(userId) {
    await db.query(
      `UPDATE gamification_profiles
       SET xp = xp + $1, updated_at = NOW()
       WHERE user_id = $2`,
      [config.gamification.xpPerMilestone, userId]
    )

    await this.checkLevelUp(userId)
    return { xpEarned: config.gamification.xpPerMilestone }
  }

  async awardGoalCompleteXP(userId) {
    await db.query(
      `UPDATE gamification_profiles
       SET xp = xp + $1, updated_at = NOW()
       WHERE user_id = $2`,
      [config.gamification.xpPerGoalComplete, userId]
    )

    await this.checkLevelUp(userId)

    await this.awardBadge(userId, 'goal_complete', 'Goal Crusher', 'Completed your first savings goal', 'check')

    return { xpEarned: config.gamification.xpPerGoalComplete }
  }

  async checkLevelUp(userId) {
    const profile = await db.query(
      `SELECT xp, level FROM gamification_profiles WHERE user_id = $1`,
      [userId]
    )

    if (!profile.rows.length) return

    const { xp, level: currentLevel } = profile.rows[0]
    const thresholds = config.gamification.levelThresholds

    let newLevel = currentLevel
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (xp >= thresholds[i]) {
        newLevel = i + 1
        break
      }
    }

    if (newLevel > currentLevel) {
      await db.query(
        `UPDATE gamification_profiles SET level = $1, total_badges = total_badges + 1 WHERE user_id = $2`,
        [newLevel, userId]
      )

      await nudgeEngine.createNudge(
        userId,
        'level_up',
        `Level Up! You're now Level ${newLevel}`,
        `Congratulations! Your financial discipline has earned you a level up. Keep building those healthy habits!`,
        { priority: 'high', context: { new_level: newLevel, xp } }
      )
    }
  }

  async awardBadge(userId, badgeKey, name, description, icon) {
    const existing = await db.query(
      `SELECT * FROM badges WHERE user_id = $1 AND badge_key = $2`,
      [userId, badgeKey]
    )

    if (existing.rows.length) return null

    const badgeInfo = this.allBadges[badgeKey] || { name, description, icon }

    await db.query(
      `INSERT INTO badges (user_id, badge_key, badge_name, badge_description, badge_icon)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, badgeKey, badgeInfo.name, badgeInfo.description, badgeInfo.icon]
    )

    await db.query(
      `UPDATE gamification_profiles SET total_badges = total_badges + 1, updated_at = NOW() WHERE user_id = $1`,
      [userId]
    )

    await nudgeEngine.createNudge(
      userId,
      'badge_earned',
      `Badge Earned: ${badgeInfo.name}`,
      badgeInfo.description,
      { priority: 'normal', context: { badge_key: badgeKey } }
    )

    return { badgeKey, name: badgeInfo.name }
  }

  async createSavingsGroup(name, description, createdById, goalType, targetAmount) {
    const result = await db.query(
      `INSERT INTO savings_groups (id, name, description, created_by, goal_type, target_amount)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
       RETURNING *`,
      [name, description, createdById, goalType, targetAmount]
    )

    const group = result.rows[0]

    await db.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [group.id, createdById]
    )

    return group
  }

  async joinSavingsGroup(groupId, userId) {
    const members = await db.query(
      `SELECT COUNT(*) AS count FROM group_members WHERE group_id = $1`,
      [groupId]
    )

    if (parseInt(members.rows[0].count) >= config.gamification.maxGroupSize) {
      throw new Error('Group is full (max ' + config.gamification.maxGroupSize + ' members)')
    }

    await db.query(
      `INSERT INTO group_members (id, group_id, user_id, role) VALUES (gen_random_uuid(), $1, $2, 'member')
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [groupId, userId]
    )

    await this.awardBadge(userId, 'group_joiner', 'Team Player', 'Joined a savings group', 'users')

    return { joined: true }
  }

  async makeCommitment(groupId, userId, commitmentType, targetAmount, deadline) {
    await db.query(
      `INSERT INTO group_commitments (group_id, user_id, commitment_type, target_amount, deadline)
       VALUES ($1, $2, $3, $4, $5)`,
      [groupId, userId, commitmentType, targetAmount, deadline]
    )

    await nudgeEngine.createNudge(
      userId,
      'commitment_made',
      'Commitment Logged',
      `You've committed to ${commitmentType}. The group is now holding you accountable!`,
      { priority: 'normal' }
    )

    return { committed: true }
  }

  async getGroupLeaderboard(groupId) {
    const result = await db.query(
      `SELECT u.full_name, u.id as user_id,
              COALESCE(SUM(ast.amount), 0) as total_saved,
              ss.current_streak,
              gp.level,
              gp.xp
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       LEFT JOIN autosave_transactions ast ON ast.user_id = gm.user_id
       LEFT JOIN savings_streaks ss ON ss.user_id = gm.user_id
       LEFT JOIN gamification_profiles gp ON gp.user_id = gm.user_id
       WHERE gm.group_id = $1
       GROUP BY u.id, ss.current_streak, gp.level, gp.xp
       ORDER BY total_saved DESC`,
      [groupId]
    )

    return result.rows
  }

  async generateDailyQuests(userId) {
    const today = new Date().toISOString().split('T')[0]
    const existing = await db.query(
      `SELECT COUNT(*) as count FROM daily_quests WHERE user_id = $1 AND quest_date = $2`,
      [userId, today]
    )
    if (parseInt(existing.rows[0].count) > 0) return

    const startOfYear = new Date(new Date().getFullYear(), 0, 0)
    const diff = new Date() - startOfYear
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24))
    const poolSize = this.questPool.length
    const startIdx = (dayOfYear * 3) % poolSize
    const selected = []
    for (let i = 0; i < 3; i++) {
      selected.push(this.questPool[(startIdx + i) % poolSize])
    }
    for (const q of selected) {
      await db.query(
        `INSERT INTO daily_quests (id, user_id, quest_key, quest_title, quest_description, xp_reward, target_value, quest_date)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [userId, q.key, q.title, q.desc, q.xp, q.target, today]
      )
    }
  }

  async getDailyQuests(userId) {
    const today = new Date().toISOString().split('T')[0]
    await this.generateDailyQuests(userId)
    await this.refillQuests(userId, today)
    const quests = await db.query(
      `SELECT * FROM daily_quests WHERE user_id = $1 AND quest_date = $2 ORDER BY quest_key`,
      [userId, today]
    )
    return quests.rows
  }

  async completeQuest(userId, questKey) {
    const today = new Date().toISOString().split('T')[0]
    const quest = await db.query(
      `SELECT * FROM daily_quests WHERE user_id = $1 AND quest_key = $2 AND quest_date = $3`,
      [userId, questKey, today]
    )
    if (!quest.rows.length || quest.rows[0].is_completed) return null
    await db.query(
      `UPDATE daily_quests SET is_completed = 1, completed_at = datetime('now') WHERE id = $1`,
      [quest.rows[0].id]
    )
    await db.query(
      `UPDATE gamification_profiles SET xp = xp + $1 WHERE user_id = $2`,
      [quest.rows[0].xp_reward, userId]
    )
    await this.refillQuests(userId, today)
    await this.checkLevelUp(userId)
    return { xpGained: quest.rows[0].xp_reward, questKey }
  }

  async refillQuests(userId, today) {
    const active = await db.query(
      `SELECT quest_key FROM daily_quests WHERE user_id = $1 AND quest_date = $2 AND is_completed = 0`,
      [userId, today]
    )
    const activeKeySet = new Set(active.rows.map(r => r.quest_key))
    const pool = this.questPool.filter(q => !activeKeySet.has(q.key))
    const needed = 3 - active.rows.length
    for (let i = 0; i < needed && i < pool.length; i++) {
      const pick = Math.floor(Math.random() * (pool.length - i)) + i;
      [pool[i], pool[pick]] = [pool[pick], pool[i]]
      const q = pool[i]
      await db.query(
        `INSERT INTO daily_quests (id, user_id, quest_key, quest_title, quest_description, xp_reward, target_value, quest_date)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [userId, q.key, q.title, q.desc, q.xp, q.target, today]
      )
    }
  }

  async updateQuestProgress(userId, questKey, value) {
    const today = new Date().toISOString().split('T')[0]
    const quest = await db.query(
      `SELECT * FROM daily_quests WHERE user_id = $1 AND quest_key = $2 AND quest_date = $3`,
      [userId, questKey, today]
    )
    if (!quest.rows.length || quest.rows[0].is_completed) return null

    if (questKey === 'stay_under_50') {
      const dailyTotal = await db.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM daily_expenditures WHERE user_id = $1 AND expenditure_date = $2`,
        [userId, today]
      )
      const total = parseFloat(dailyTotal.rows[0].total)
      if (total < 50) {
        await db.query(
          `UPDATE daily_quests SET current_value = $1 WHERE id = $2`,
          [total, quest.rows[0].id]
        )
      }
      return
    }

    if (questKey === 'zero_spend') {
      const dailyTotal = await db.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM daily_expenditures WHERE user_id = $1 AND expenditure_date = $2`,
        [userId, today]
      )
      const total = parseFloat(dailyTotal.rows[0].total)
      if (total === 0) {
        return this.completeQuest(userId, questKey)
      }
      return
    }

    const currentValue = (quest.rows[0].current_value || 0) + value
    await db.query(
      `UPDATE daily_quests SET current_value = $1 WHERE id = $2`,
      [currentValue, quest.rows[0].id]
    )

    if (currentValue >= quest.rows[0].target_value) {
      return this.completeQuest(userId, questKey)
    }
  }

  async getGroupMessages(groupId, limit = 50) {
    const messages = await db.query(
      `SELECT gm.*, u.full_name, u.is_npc FROM group_messages gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1 ORDER BY gm.sent_at DESC LIMIT $2`,
      [groupId, limit]
    )
    return messages.rows.reverse()
  }

  async sendGroupMessage(groupId, userId, message) {
    const result = await db.query(
      `INSERT INTO group_messages (id, group_id, user_id, message)
       VALUES (gen_random_uuid(), $1, $2, $3) RETURNING *`,
      [groupId, userId, message]
    )
    const msg = result.rows[0]
    const user = await db.query(`SELECT full_name FROM users WHERE id = $1`, [userId])
    return { ...msg, full_name: user.rows[0]?.full_name }
  }

  async triggerNPCResponse(groupId) {
    if (Math.random() > 0.3) return
    const npcs = await db.query(
      `SELECT u.id, u.full_name FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = $1 AND u.is_npc = 1`,
      [groupId]
    )
    if (!npcs.rows.length) return
    const npc = npcs.rows[Math.floor(Math.random() * npcs.rows.length)]
    const groupInfo = await db.query(`SELECT name FROM savings_groups WHERE id = $1`, [groupId])
    const groupName = groupInfo.rows[0]?.name || 'savings group'
    try {
      const reply = await ilmuAIService.generateNPCMessage(npc.full_name, groupName)
      if (reply) {
        await db.query(
          `INSERT INTO group_messages (id, group_id, user_id, message)
           VALUES (gen_random_uuid(), $1, $2, $3)`,
          [groupId, npc.id, reply]
        )
      }
    } catch (e) {
      // NPC reply failed silently
    }
  }

  async getGroupMembers(groupId) {
    const members = await db.query(
      `SELECT u.id, u.full_name, u.monthly_income, u.is_npc, gm.role, gm.joined_at,
              gp.level, gp.xp, COALESCE(ss.current_streak, 0) as streak,
              COALESCE((SELECT SUM(amount) FROM autosave_transactions WHERE user_id = u.id), 0) as total_saved
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       LEFT JOIN gamification_profiles gp ON gp.user_id = u.id
       LEFT JOIN savings_streaks ss ON ss.user_id = u.id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at`,
      [groupId]
    )
    return members.rows
  }

  async getAllBadgesForUser(userId) {
    const earned = await db.query(`SELECT badge_key, earned_at FROM badges WHERE user_id = $1`, [userId])
    const earnedKeys = new Set(earned.rows.map(r => r.badge_key))
    const earnedMap = {}
    earned.rows.forEach(r => { earnedMap[r.badge_key] = r.earned_at })
    return Object.entries(this.allBadges).map(([key, badge]) => ({
      key, ...badge,
      earned: earnedKeys.has(key),
      earned_at: earnedMap[key] || null,
    }))
  }

  async checkAllBadges(userId) {
    const earned = []
    const existing = await db.query(`SELECT badge_key FROM badges WHERE user_id = $1`, [userId])
    const have = new Set(existing.rows.map(function(r) { return r.badge_key }))

    if (!have.has('first_save')) {
      const autoTxn = await db.query(
        `SELECT COUNT(*) as count FROM autosave_transactions WHERE user_id = $1`, [userId]
      )
      if (parseInt(autoTxn.rows[0].count) > 0) {
        const b = await this.awardBadge(userId, 'first_save')
        if (b) earned.push(b)
      }
    }

    if (!have.has('group_joiner')) {
      const groups = await db.query(
        `SELECT COUNT(*) as count FROM group_members WHERE user_id = $1`, [userId]
      )
      if (parseInt(groups.rows[0].count) > 0) {
        const b = await this.awardBadge(userId, 'group_joiner')
        if (b) earned.push(b)
      }
    }

    const streak = await db.query(
      `SELECT current_streak FROM savings_streaks WHERE user_id = $1`, [userId]
    )
    const s = streak.rows[0]?.current_streak || 0
    if (!have.has('streak_7') && s >= 7) {
      const b = await this.awardBadge(userId, 'streak_7')
      if (b) earned.push(b)
    }
    if (!have.has('streak_21') && s >= 21) {
      const b = await this.awardBadge(userId, 'streak_21')
      if (b) earned.push(b)
    }
    if (!have.has('streak_30') && s >= 30) {
      const b = await this.awardBadge(userId, 'streak_30')
      if (b) earned.push(b)
    }

    const savings = await db.query(
      `SELECT COALESCE(SUM(current_amount), 0) as total FROM goals WHERE user_id = $1`, [userId]
    )
    const total = parseFloat(savings.rows[0].total)
    if (!have.has('milestone_500') && total >= 500) {
      const b = await this.awardBadge(userId, 'milestone_500')
      if (b) earned.push(b)
    }
    if (!have.has('milestone_1000') && total >= 1000) {
      const b = await this.awardBadge(userId, 'milestone_1000')
      if (b) earned.push(b)
    }
    if (!have.has('milestone_5000') && total >= 5000) {
      const b = await this.awardBadge(userId, 'milestone_5000')
      if (b) earned.push(b)
    }
    if (!have.has('milestone_10000') && total >= 10000) {
      const b = await this.awardBadge(userId, 'milestone_10000')
      if (b) earned.push(b)
    }

    if (!have.has('round_up_100')) {
      const ru = await db.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM autosave_transactions WHERE user_id = $1 AND type = 'round_up'`, [userId]
      )
      if (parseFloat(ru.rows[0].total) >= 100) {
        const b = await this.awardBadge(userId, 'round_up_100')
        if (b) earned.push(b)
      }
    }

    return earned
  }

  async getProfile(userId) {
    const profile = await db.query(
      `SELECT * FROM gamification_profiles WHERE user_id = $1`,
      [userId]
    )

    const badges = await db.query(
      `SELECT * FROM badges WHERE user_id = $1 ORDER BY earned_at DESC`,
      [userId]
    )

    const streak = await db.query(
      `SELECT * FROM savings_streaks WHERE user_id = $1`,
      [userId]
    )

    const groups = await db.query(
      `SELECT sg.* FROM savings_groups sg
       JOIN group_members gm ON gm.group_id = sg.id
       WHERE gm.user_id = $1`,
      [userId]
    )

    const thresholds = config.gamification.levelThresholds
    const currentXP = profile.rows[0]?.xp || 0
    const currentLevel = profile.rows[0]?.level || 1
    const currentThreshold = thresholds[currentLevel - 1] || 0
    const nextThreshold = thresholds[currentLevel] || thresholds[thresholds.length - 1]
    const progressToNext = nextThreshold > currentThreshold
      ? ((currentXP - currentThreshold) / (nextThreshold - currentThreshold) * 100).toFixed(0)
      : 100

    return {
      xp: currentXP,
      level: currentLevel,
      progressToNext: parseInt(progressToNext),
      totalBadges: profile.rows[0]?.total_badges || 0,
      badges: badges.rows,
      streak: streak.rows[0] || { current_streak: 0, longest_streak: 0 },
      groups: groups.rows,
    }
  }
}

module.exports = new GamificationEngine()
