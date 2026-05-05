const db = require('../database/connection')
const config = require('../config')
const nudgeEngine = require('./NudgeEngine')

class GamificationEngine {
  constructor() {
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
      `INSERT INTO savings_groups (name, description, created_by, goal_type, target_amount)
       VALUES ($1, $2, $3, $4, $5)
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
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')
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
