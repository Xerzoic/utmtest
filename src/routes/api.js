const express = require('express')
const router = express.Router()
const dashboardController = require('../controllers/dashboardController')
const { authenticate } = require('../middleware/auth')

router.use(authenticate)

router.get('/dashboard', dashboardController.getDashboard)
router.get('/insights', dashboardController.getAIInsights)
router.get('/goals', dashboardController.getGoals)
router.post('/goals', dashboardController.createGoal)

router.get('/transactions', dashboardController.getTransactions)
router.post('/transactions', dashboardController.addTransaction)

router.get('/autosave/rules', dashboardController.getAutoSaveRules)
router.post('/autosave/rules', dashboardController.createAutoSaveRule)
router.patch('/autosave/rules/:ruleId', dashboardController.toggleAutoSaveRule)

router.get('/nudges', dashboardController.getNudges)
router.patch('/nudges/:nudgeId/read', dashboardController.readNudge)

router.get('/gamification', dashboardController.getGamificationProfile)
router.post('/groups', dashboardController.createSavingsGroup)
router.post('/groups/:groupId/join', dashboardController.joinSavingsGroup)
router.post('/groups/:groupId/commitments', dashboardController.makeCommitment)
router.get('/groups/:groupId/leaderboard', dashboardController.getGroupLeaderboard)

router.get('/analytics/spending', dashboardController.getSpendingAnalysis)

module.exports = router
