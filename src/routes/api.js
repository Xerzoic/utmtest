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

router.post('/expenditures', dashboardController.addDailyExpenditure)
router.get('/expenditures', dashboardController.getDailyExpenditures)

router.get('/autosave/rules', dashboardController.getAutoSaveRules)
router.post('/autosave/rules', dashboardController.createAutoSaveRule)
router.patch('/autosave/rules/:ruleId', dashboardController.toggleAutoSaveRule)

router.get('/nudges', dashboardController.getNudges)
router.patch('/nudges/mark-all-read', dashboardController.markAllNudgesRead)
router.patch('/nudges/:nudgeId/read', dashboardController.readNudge)

router.get('/roundup/status', dashboardController.getRoundUpStatus)
router.post('/roundup/toggle', dashboardController.toggleRoundUp)

router.get('/gamification', dashboardController.getGamificationProfile)
router.get('/groups', dashboardController.listGroups)
router.post('/groups', dashboardController.createSavingsGroup)
router.post('/groups/:groupId/join', dashboardController.joinSavingsGroup)
router.post('/groups/:groupId/commitments', dashboardController.makeCommitment)
router.get('/groups/:groupId/leaderboard', dashboardController.getGroupLeaderboard)
router.get('/groups/:groupId/messages', dashboardController.getGroupMessages)
router.post('/groups/:groupId/messages', dashboardController.sendGroupMessage)
router.get('/groups/:groupId/members', dashboardController.getGroupMembers)

router.get('/quests', dashboardController.getDailyQuests)
router.post('/quests/:questKey/complete', dashboardController.completeQuest)

router.get('/advice', dashboardController.getPersonalisedAdvice)

router.get('/analytics/spending', dashboardController.getSpendingAnalysis)

router.get('/calendar', dashboardController.getCalendarData)
router.get('/calendar/day', dashboardController.getDayDetail)

router.delete('/goals/:goalId', dashboardController.deleteGoal)
router.delete('/autosave/rules/:ruleId', dashboardController.deleteAutoSaveRule)

module.exports = router
