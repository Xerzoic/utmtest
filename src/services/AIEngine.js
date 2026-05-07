const db = require('../database/connection')
const config = require('../config')
const nudgeEngine = require('./NudgeEngine')
const ilmuAI = require('./IlmuAIService')

class AIEngine {
  constructor() {
    this.categories = {
      food: { keywords: ['grabfood', 'foodpanda', 'teh tarik', 'mamak', 'restaurant', 'cafe', 'mcdonald', 'kfc', 'starbucks'] },
      transport: { keywords: ['grab', 'touch n go', 'petrol', 'shell', 'petronas', 'parking', 'lrt', 'mrt'] },
      shopping: { keywords: ['shopee', 'lazada', 'zalora', 'watsons', 'guardian', 'uniqlo', 'padini'] },
      entertainment: { keywords: ['tgv', 'gsc', 'netflix', 'spotify', 'steam', 'playstation'] },
      bills: { keywords: ['tnb', 'syabas', 'unifi', 'tm', 'celcom', 'digi', 'maxis', 'utility'] },
      healthcare: { keywords: ['hospital', 'clinic', 'pharmacy', 'watsons health'] },
      education: { keywords: ['udemy', 'coursera', 'book', 'tuition'] },
    }
  }

  async categoriseTransaction(transaction) {
    if (transaction.category) return transaction.category

    const merchant = transaction.merchant?.toLowerCase() || ''
    const description = transaction.description?.toLowerCase() || ''
    const combined = `${merchant} ${description}`

    for (const [category, config] of Object.entries(this.categories)) {
      if (config.keywords.some(kw => combined.includes(kw))) {
        return category
      }
    }

    return 'other'
  }

  async analyseSpendingPatterns(userId, days = 90) {
    const since = new Date()
    since.setDate(since.getDate() - days)

    const transactions = await db.query(
      `SELECT * FROM transactions
       WHERE user_id = $1 AND type = 'debit' AND transaction_date >= $2
       ORDER BY transaction_date DESC`,
      [userId, since.toISOString()]
    )

    const analysis = {
      totalSpent: 0,
      categoryBreakdown: {},
      merchantBreakdown: {},
      dailyAverage: 0,
      weeklyAverage: 0,
      monthlyAverage: 0,
      topMerchants: [],
      recurringPayments: [],
      anomalies: [],
      spendingTrend: 'stable',
      savingsPotential: 0,
    }

    for (const txn of transactions.rows) {
      analysis.totalSpent += parseFloat(txn.amount)

      if (!analysis.categoryBreakdown[txn.category]) {
        analysis.categoryBreakdown[txn.category] = { total: 0, count: 0, avg: 0 }
      }
      analysis.categoryBreakdown[txn.category].total += parseFloat(txn.amount)
      analysis.categoryBreakdown[txn.category].count++

      if (!analysis.merchantBreakdown[txn.merchant]) {
        analysis.merchantBreakdown[txn.merchant] = { total: 0, count: 0, category: txn.category }
      }
      analysis.merchantBreakdown[txn.merchant].total += parseFloat(txn.amount)
      analysis.merchantBreakdown[txn.merchant].count++
    }

    const dayCount = days || 1
    analysis.dailyAverage = analysis.totalSpent / dayCount
    analysis.weeklyAverage = analysis.dailyAverage * 7
    analysis.monthlyAverage = analysis.dailyAverage * 30

    analysis.topMerchants = Object.entries(analysis.merchantBreakdown)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([merchant, data]) => ({ merchant, ...data }))

    for (const [category, data] of Object.entries(analysis.categoryBreakdown)) {
      data.avg = data.total / Math.max(data.count, 1)
      data.percentage = ((data.total / analysis.totalSpent) * 100).toFixed(1)
    }

    analysis.recurringPayments = transactions.rows.filter(t => t.is_recurring)

    analysis.anomalies = this.detectAnomalies(transactions.rows, analysis.dailyAverage)

    analysis.spendingTrend = this.calculateTrend(transactions.rows, dayCount)

    analysis.savingsPotential = this.calculateSavingsPotential(analysis)

    return analysis
  }

  detectAnomalies(transactions, dailyAverage) {
    const anomalies = []
    const threshold = dailyAverage * 2.5

    for (const txn of transactions) {
      if (parseFloat(txn.amount) > threshold && txn.type === 'debit') {
        anomalies.push({
          transactionId: txn.id,
          merchant: txn.merchant,
          amount: parseFloat(txn.amount),
          date: txn.transaction_date,
          deviation: ((parseFloat(txn.amount) / dailyAverage) * 100 - 100).toFixed(0),
        })
      }
    }

    return anomalies
  }

  calculateTrend(transactions, dayCount) {
    if (transactions.length < 10) return 'insufficient_data'

    const midPoint = Math.floor(dayCount / 2)
    let firstHalf = 0
    let secondHalf = 0

    for (const txn of transactions) {
      const txnDay = (new Date() - new Date(txn.transaction_date)) / (1000 * 60 * 60 * 24)
      if (txnDay <= midPoint) {
        secondHalf += parseFloat(txn.amount)
      } else {
        firstHalf += parseFloat(txn.amount)
      }
    }

    if (firstHalf === 0) return 'stable'

    const change = ((secondHalf - firstHalf) / firstHalf) * 100

    if (change > 15) return 'increasing'
    if (change < -15) return 'decreasing'
    return 'stable'
  }

  calculateSavingsPotential(analysis) {
    let potential = 0

    const foodData = analysis.categoryBreakdown['food']
    if (foodData && foodData.percentage > 30) {
      potential += foodData.total * 0.15
    }

    const transportData = analysis.categoryBreakdown['transport']
    if (transportData && transportData.percentage > 20) {
      potential += transportData.total * 0.10
    }

    const entertainmentData = analysis.categoryBreakdown['entertainment']
    if (entertainmentData && entertainmentData.percentage > 10) {
      potential += entertainmentData.total * 0.20
    }

    const shoppingData = analysis.categoryBreakdown['shopping']
    if (shoppingData && shoppingData.percentage > 15) {
      potential += shoppingData.total * 0.15
    }

    return parseFloat(potential.toFixed(2))
  }

  async generatePersonalisedInsights(userId) {
    const analysis = await this.analyseSpendingPatterns(userId)
    const user = await db.query(`SELECT * FROM users WHERE id = $1`, [userId])
    const goals = await db.query(`SELECT * FROM goals WHERE user_id = $1 AND is_active = true`, [userId])
    const streak = await db.query(`SELECT * FROM savings_streaks WHERE user_id = $1`, [userId])

    if (!user.rows.length) return null

    const userData = user.rows[0]
    const savingsRate = userData.monthly_income > 0
      ? (((userData.monthly_income - analysis.monthlyAverage) / userData.monthly_income) * 100).toFixed(1)
      : 0

    const insights = {
      userId,
      generatedAt: new Date().toISOString(),
      summary: this.generateSummary(userData, analysis, savingsRate),
      tips: this.generateTips(userData, analysis, goals.rows, streak.rows[0]),
      risks: this.identifyRisks(userData, analysis, savingsRate),
      opportunities: this.identifyOpportunities(userData, analysis, goals.rows),
      savingsRate: parseFloat(savingsRate),
      financialHealth: this.assessFinancialHealth(userData, analysis, savingsRate),
    }

    await db.query(
       `INSERT INTO ai_insights (user_id, insight_type, content, generated_at, expires_at)
        VALUES ($1, 'full_analysis', $2, datetime('now'), datetime('now', '+24 hours'))
        ON CONFLICT (user_id, insight_type)
        DO UPDATE SET content = excluded.content, generated_at = datetime('now'), expires_at = datetime('now', '+24 hours')`,
      [userId, JSON.stringify(insights)]
    )

    const nudgeTitle = this.getInsightNudgeTitle(insights.financialHealth)
    const nudgeMessage = this.getInsightNudgeMessage(insights)

    await nudgeEngine.createNudge(
      userId,
      nudgeEngine.nudgeTypes.AI_INSIGHT,
      nudgeTitle,
      nudgeMessage,
      { channel: 'in_app', priority: insights.financialHealth === 'at_risk' ? 'high' : 'normal' }
    )

    return insights
  }

  generateSummary(user, analysis, savingsRate) {
    const parts = []

    if (savingsRate > 20) {
      parts.push(`You're saving ${savingsRate}% of your income - well above the recommended 20%.`)
    } else if (savingsRate > 10) {
      parts.push(`You're saving ${savingsRate}% of your income. Aim for 20% to build strong financial security.`)
    } else {
      parts.push(`Your savings rate is ${savingsRate}. The recommended target is 20% of income.`)
    }

    const topCategory = Object.entries(analysis.categoryBreakdown)
      .sort((a, b) => b[1].total - a[1].total)[0]

    if (topCategory) {
      parts.push(`${this.capitalize(topCategory[0])} is your largest expense at RM${topCategory[1].total.toFixed(0)} (${topCategory[1].percentage}%).`)
    }

    if (analysis.anomalies.length > 0) {
      parts.push(`We detected ${analysis.anomalies.length} unusual spending${analysis.anomalies.length > 1 ? 's' : ''} that's above your normal pattern.`)
    }

    return parts.join(' ')
  }

  generateTips(user, analysis, goals, streak) {
    const tips = []
    const currentStreak = streak?.current_streak || 0

    if (analysis.spendingTrend === 'increasing') {
      tips.push({
        type: 'spending_control',
        title: 'Spending is Trending Up',
        message: 'Your spending has increased 15%+ compared to last month. Set a weekly spending cap to bring it back down.',
        priority: 'high',
      })
    }

    const foodData = analysis.categoryBreakdown['food']
    if (foodData && foodData.percentage > 25) {
      tips.push({
        type: 'category_optimisation',
        title: 'Reduce Food Delivery',
        message: `You spend RM${foodData.total.toFixed(0)} on food (${foodData.percentage}% of total). Cooking just 2 more meals/week could save ~RM${(foodData.total * 0.15).toFixed(0)}/month.`,
        priority: 'medium',
      })
    }

    if (currentStreak > 0 && currentStreak % 7 === 0) {
      tips.push({
        type: 'positive_reinforcement',
        title: 'Keep the Streak Going!',
        message: `${currentStreak} days strong! You've proven you can build the habit. Try increasing your auto-save by 5%.`,
        priority: 'low',
      })
    }

    if (goals.length === 0) {
      tips.push({
        type: 'goal_setting',
        title: 'Set a Savings Goal',
        message: 'Users with active goals save 3x more than those without. Create your first goal to get started.',
        priority: 'high',
      })
    }

    const emergencies = goals.find(g => g.category === 'emergency')
    if (emergencies && emergencies.current_amount < user.monthly_income * 3) {
      tips.push({
        type: 'emergency_fund',
        title: 'Build Your Emergency Fund',
        message: `Your emergency fund (RM${emergencies.current_amount.toFixed(0)}) should cover at least 3 months of expenses (RM${(user.monthly_income * 3).toFixed(0)}). You're ${(emergencies.current_amount / (user.monthly_income * 3) * 100).toFixed(0)}% there.`,
        priority: 'high',
      })
    }

    if (analysis.savingsPotential > 0) {
      tips.push({
        type: 'savings_opportunity',
        title: 'Found RM' + analysis.savingsPotential.toFixed(0) + '/Month in Savings',
        message: `Based on your patterns, you could save an extra RM${analysis.savingsPotential.toFixed(0)}/month with small adjustments. Enable round-up savings to capture this effortlessly.`,
        priority: 'medium',
      })
    }

    return tips
  }

  identifyRisks(user, analysis, savingsRate) {
    const risks = []

    if (savingsRate < 10) {
      risks.push({
        type: 'low_savings_rate',
        severity: 'high',
        message: 'Savings rate is below 10%. Consider enabling automated savings to build the habit.',
      })
    }

    if (analysis.spendingTrend === 'increasing') {
      risks.push({
        type: 'spending_increase',
        severity: 'medium',
        message: 'Spending is trending upward. Without intervention, this could impact your goals.',
      })
    }

    if (analysis.anomalies.length > 3) {
      risks.push({
        type: 'frequent_unusual_spending',
        severity: 'medium',
        message: `${analysis.anomalies.length} unusual transactions detected. Review your spending habits.`,
      })
    }

    return risks
  }

  identifyOpportunities(user, analysis, goals) {
    const opportunities = []

    if (user.monthly_income > 0 && analysis.monthlyAverage < user.monthly_income * 0.7) {
      opportunities.push({
        type: 'increase_auto_save',
        title: 'Room to Save More',
        message: 'Your spending leaves room to increase your automated savings by 5-10%.',
        potentialExtra: ((user.monthly_income * 0.10)).toFixed(2),
      })
    }

    if (goals.length < 3) {
      opportunities.push({
        type: 'add_goal',
        title: 'Diversify Your Goals',
        message: 'Consider adding a travel or education goal alongside your savings.',
      })
    }

    return opportunities
  }

  assessFinancialHealth(user, analysis, savingsRate) {
    let score = 50

    if (savingsRate > 20) score += 20
    else if (savingsRate > 10) score += 10
    else score -= 10

    if (analysis.spendingTrend === 'decreasing') score += 10
    else if (analysis.spendingTrend === 'increasing') score -= 10

    if (user.monthly_income > 0 && analysis.monthlyAverage < user.monthly_income * 0.6) score += 10

    if (analysis.anomalies.length > 3) score -= 5

    if (score >= 80) return 'excellent'
    if (score >= 60) return 'good'
    if (score >= 40) return 'fair'
    return 'at_risk'
  }

  async generateAIInsights(userId) {
    const analysis = await this.analyseSpendingPatterns(userId)
    const user = await db.query(`SELECT * FROM users WHERE id = $1`, [userId])
    const goals = await db.query(`SELECT * FROM goals WHERE user_id = $1 AND is_active = true`, [userId])
    const userData = user.rows[0]
    if (!userData) return await this.generatePersonalisedInsights(userId)

    const prompt = `Analyse this user's finances and give 3 actionable tips:
Income: RM${userData.monthly_income}/month
Monthly spending: RM${analysis.monthlyAverage.toFixed(0)}
Top categories: ${Object.entries(analysis.categoryBreakdown).map(([k,v]) => k+': RM'+v.total.toFixed(0)).join(', ')}
Trend: ${analysis.spendingTrend}
Goals: ${goals.rows.map(g => g.name + ' (RM'+g.current_amount+'/'+g.target_amount+')').join(', ')}
Respond in JSON: {"summary":"...","tips":[{"title":"...","message":"...","priority":"high|medium|low"}],"risks":[{"message":"...","severity":"high|medium"}]}`

    try {
      const raw = await ilmuAI.chat(
        'You are a Malaysian financial advisor AI. Respond ONLY in valid JSON. Use RM currency. Be specific.',
        prompt
      )
      const parsed = JSON.parse(raw)
      const savingsRate = userData.monthly_income > 0
        ? ((userData.monthly_income - analysis.monthlyAverage) / userData.monthly_income * 100).toFixed(1)
        : 0
      return {
        ...parsed,
        savingsRate: parseFloat(savingsRate),
        financialHealth: this.assessFinancialHealth(userData, analysis, savingsRate),
        cached: false,
      }
    } catch (e) {
      return await this.generatePersonalisedInsights(userId)
    }
  }

  getInsightNudgeTitle(health) {
    const titles = {
      excellent: 'Your Finances Are Looking Great!',
      good: 'You\'re On Track - Here\'s How to Improve',
      fair: 'A Few Tweaks Could Make a Big Difference',
      at_risk: 'Let\'s Get Your Finances Back on Track',
    }
    return titles[health] || 'Financial Insight Update'
  }

  getInsightNudgeMessage(insights) {
    if (insights.risks.length > 0) {
      return insights.risks[0].message
    }
    if (insights.opportunities.length > 0) {
      return insights.opportunities[0].message
    }
    return insights.summary
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }
}

module.exports = new AIEngine()
