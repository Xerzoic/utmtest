const NudgeEngine = require('../src/services/NudgeEngine')
const AIEngine = require('../src/services/AIEngine')
const AutoSaveEngine = require('../src/services/AutoSaveEngine')
const GamificationEngine = require('../src/services/GamificationEngine')

jest.mock('../src/database/connection', () => ({
  query: jest.fn(),
}))

const db = require('../src/database/connection')

describe('NudgeEngine', () => {
  beforeEach(() => {
    db.query.mockClear()
  })

  describe('createNudge', () => {
    it('should create a nudge with correct parameters', async () => {
      db.query.mockResolvedValue({ rows: [{ id: 'nudge-1', user_id: 'user-1', type: 'spending_alert', title: 'Test', message: 'Test message' }] })

      const result = await NudgeEngine.createNudge('user-1', 'spending_alert', 'Test', 'Test message')

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO nudges'),
        expect.arrayContaining(['user-1', 'spending_alert', 'Test', 'Test message'])
      )
      expect(result).toHaveProperty('id', 'nudge-1')
    })
  })

  describe('getMilestoneMessage', () => {
    it('should return appropriate message for RM1000 milestone', () => {
      const msg = NudgeEngine.getMilestoneMessage(1000)
      expect(msg).toContain('RM1,000')
    })

    it('should return default message for unknown milestone', () => {
      const msg = NudgeEngine.getMilestoneMessage(9999)
      expect(msg).toContain('9,999')
    })
  })
})

describe('AIEngine', () => {
  beforeEach(() => {
    db.query.mockClear()
  })

  describe('categoriseTransaction', () => {
    it('should categorise food transactions', async () => {
      const category = await AIEngine.categoriseTransaction({ merchant: 'GrabFood', description: 'Lunch order' })
      expect(category).toBe('food')
    })

    it('should categorise transport transactions', async () => {
      const category = await AIEngine.categoriseTransaction({ merchant: 'Grab', description: 'Ride to office' })
      expect(category).toBe('transport')
    })

    it('should categorise shopping transactions', async () => {
      const category = await AIEngine.categoriseTransaction({ merchant: 'Shopee', description: 'Online shopping' })
      expect(category).toBe('shopping')
    })

    it('should return other for unknown merchants', async () => {
      const category = await AIEngine.categoriseTransaction({ merchant: 'UnknownShop', description: 'Something' })
      expect(category).toBe('other')
    })
  })

  describe('calculateTrend', () => {
    it('should return increasing for higher recent spending', () => {
      const transactions = Array.from({ length: 20 }, (_, i) => ({
        amount: i < 10 ? 100 : 50,
        transaction_date: new Date(Date.now() - i * 86400000).toISOString(),
      }))

      const trend = AIEngine.calculateTrend(transactions, 20)
      expect(trend).toBe('increasing')
    })

    it('should return decreasing for lower recent spending', () => {
      const transactions = Array.from({ length: 20 }, (_, i) => ({
        amount: i < 10 ? 50 : 100,
        transaction_date: new Date(Date.now() - i * 86400000).toISOString(),
      }))

      const trend = AIEngine.calculateTrend(transactions, 20)
      expect(trend).toBe('decreasing')
    })
  })

  describe('detectAnomalies', () => {
    it('should detect transactions above threshold', () => {
      const transactions = [
        { id: '1', amount: 50, type: 'debit', merchant: 'Cafe' },
        { id: '2', amount: 200, type: 'debit', merchant: 'Luxury Store' },
        { id: '3', amount: 30, type: 'debit', merchant: 'Teh Tarik' },
      ]

      const anomalies = AIEngine.detectAnomalies(transactions, 50)
      expect(anomalies.length).toBeGreaterThan(0)
      expect(anomalies[0].merchant).toBe('Luxury Store')
    })
  })
})

describe('GamificationEngine', () => {
  beforeEach(() => {
    db.query.mockClear()
  })

  describe('awardBadge', () => {
    it('should not award duplicate badge', async () => {
      db.query.mockResolvedValue({ rows: [{ id: 'existing-badge' }] })

      const result = await GamificationEngine.awardBadge('user-1', 'first_save', 'First Step', 'desc', 'star')
      expect(result).toBeNull()
    })
  })
})

describe('AutoSaveEngine', () => {
  beforeEach(() => {
    db.query.mockClear()
  })

  describe('getActivationMessage', () => {
    it('should return round-up message', () => {
      const msg = AutoSaveEngine.getActivationMessage('round_up')
      expect(msg).toContain('Round-up')
    })

    it('should return salary trigger message', () => {
      const msg = AutoSaveEngine.getActivationMessage('salary_trigger')
      expect(msg).toContain('Salary')
    })
  })
})
