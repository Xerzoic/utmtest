const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const config = require('../config')
const db = require('../database/connection')

router.post('/login', async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ error: 'Email required' })
    }

    const result = await db.query(
      `SELECT id, full_name, email FROM users WHERE email = $1`,
      [email]
    )

    if (!result.rows.length) {
      return res.status(404).json({ error: 'User not found. Try demo users: aisha.rahman@email.com, hakim@email.com, weiling@email.com' })
    }

    const user = result.rows[0]
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.full_name },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    )

    res.json({
      token,
      user: { id: user.id, name: user.full_name, email: user.email },
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.get('/demo-token', async (req, res) => {
  const result = await db.query('SELECT id, full_name, email FROM users LIMIT 1')
  if (!result.rows.length) {
    return res.status(404).json({ error: 'No users found. Run npm run seed first.' })
  }
  const user = result.rows[0]
  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.full_name },
    config.jwt.secret,
    { expiresIn: '24h' }
  )
  res.json({
    token,
    user: { id: user.id, name: user.full_name, email: user.email },
  })
})

module.exports = router
