const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const { v4: uuidv4 } = require('uuid')
const config = require('../config')
const db = require('../database/connection')

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase()
}

function buildAuthPayload(user) {
  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.full_name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  )

  return {
    token,
    user: {
      id: user.id,
      full_name: user.full_name,
      name: user.full_name,
      email: user.email,
    },
  }
}

router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)

    if (!email) {
      return res.status(400).json({ error: 'Email required' })
    }

    const result = await db.query(
      `SELECT id, full_name, email FROM users WHERE lower(email) = $1`,
      [email]
    )

    if (!result.rows.length) {
      return res.status(404).json({
        error: 'User not found. Register first or try demo users: aisha.rahman@email.com, hakim@email.com, weiling@email.com',
      })
    }

    const user = result.rows[0]
    res.json(buildAuthPayload(user))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.post('/register', async (req, res) => {
  try {
    const fullName = (req.body?.full_name || '').trim()
    const email = normalizeEmail(req.body?.email)
    const phone = (req.body?.phone || '').trim() || `+6010${Math.floor(10000000 + Math.random() * 90000000)}`
    const monthlyIncome = Number(req.body?.monthly_income) || 0
    const gxbankAccountId = (req.body?.gxbank_account_id || '').trim() || `GG-${Date.now()}`

    if (!fullName || !email) {
      return res.status(400).json({ error: 'full_name and email are required' })
    }

    const existing = await db.query('SELECT id FROM users WHERE lower(email) = $1', [email])
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Email already registered. Please login.' })
    }

    const id = uuidv4()
    await db.query(
      `INSERT INTO users (id, gxbank_account_id, full_name, email, phone, monthly_income, risk_profile)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, gxbankAccountId, fullName, email, phone, monthlyIncome, 'moderate']
    )

    const created = await db.query('SELECT id, full_name, email FROM users WHERE id = $1', [id])
    res.status(201).json(buildAuthPayload(created.rows[0]))
  } catch (error) {
    if (error?.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Email or phone already exists' })
    }
    res.status(500).json({ error: error.message })
  }
})

router.get('/demo-token', async (req, res) => {
  const result = await db.query('SELECT id, full_name, email FROM users LIMIT 1')
  if (!result.rows.length) {
    return res.status(404).json({ error: 'No users found. Run npm run seed first.' })
  }
  const user = result.rows[0]
  const payload = buildAuthPayload(user)
  res.json(payload)
})

module.exports = router
