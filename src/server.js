const express = require('express')
const cors = require('cors')
const http = require('http')
const { Server } = require('socket.io')
const cron = require('node-cron')
const path = require('path')
const config = require('./config')
const apiRoutes = require('./routes/api')
const authRoutes = require('./routes/auth')

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'frontend')))

const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })

const db = require('./database/connection')
const nudgeEngine = require('./services/NudgeEngine')
const aiEngine = require('./services/AIEngine')
const autoSaveEngine = require('./services/AutoSaveEngine')

app.use('/auth', authRoutes)
app.use('/api', apiRoutes)

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id)

  socket.on('join', (userId) => {
    socket.join(`user:${userId}`)
    console.log(`User ${userId} joined their room`)
  })

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id)
  })
})

async function notifyUser(userId, data) {
  io.to(`user:${userId}`).emit('nudge', data)
}

cron.schedule('0 9 * * 1', async () => {
  console.log('Running weekly AI summaries...')
  const users = await db.query('SELECT id FROM users')
  for (const user of users.rows) {
    try {
      await aiEngine.generateWeeklySummary(user.id)
    } catch (e) {
      console.error('Weekly summary failed for user', user.id, e.message)
    }
  }
})

cron.schedule('*/6 * * * *', async () => {
  console.log('Running periodic nudge checks...')
  const users = await db.query('SELECT id FROM users')
  for (const user of users.rows) {
    await nudgeEngine.runAllNudgeChecks(user.id)
  }
})

cron.schedule('0 10 1 * *', async () => {
  console.log('Running monthly AI analysis...')
  const users = await db.query('SELECT id FROM users')
  for (const user of users.rows) {
    await aiEngine.generatePersonalisedInsights(user.id)
  }
})

cron.schedule('0 1 * * *', async () => {
  console.log('Checking salary triggers...')
  const users = await db.query('SELECT DISTINCT user_id FROM autosave_rules WHERE rule_type = \'salary_trigger\' AND is_active = true')
  for (const user of users.rows) {
    await autoSaveEngine.executeSalaryTrigger(user.user_id)
  }
})

server.listen(config.port, () => {
  console.log(`GuGa Saves server running on port ${config.port}`)
  console.log(`Environment: ${config.nodeEnv}`)
  console.log(`API: http://localhost:${config.port}/api`)
})

module.exports = { app, server, io }
