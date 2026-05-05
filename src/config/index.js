require('dotenv').config()

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    name: process.env.DB_NAME || 'gxsave_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'gxsave-dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  gxbank: {
    apiUrl: process.env.GXBANK_API_URL || 'https://api.gxbank.com.my/v1',
    apiKey: process.env.GXBANK_API_KEY || 'sandbox-api-key',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder',
    model: process.env.OPENAI_MODEL || 'gpt-4',
  },
  nudges: {
    spendingAlertThreshold: 0.8,
    streakReminderHours: 24,
    milestoneIntervals: [500, 1000, 2500, 5000, 10000, 25000, 50000],
  },
  autosave: {
    roundUpEnabled: true,
    salaryTriggerPercentage: 0.10,
    maxDailyAutoSave: 100,
    minBalanceBuffer: 50,
  },
  gamification: {
    xpPerSave: 10,
    xpPerStreakDay: 25,
    xpPerMilestone: 100,
    xpPerGoalComplete: 200,
    levelThresholds: [0, 100, 300, 600, 1000, 1500, 2200, 3000, 4000, 5000],
    maxGroupSize: 10,
  },
}
