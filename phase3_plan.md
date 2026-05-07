# Phase 3 Implementation Plan

## Codebase Snapshot

**Key files (all paths relative to `src/`):**
- `frontend/scripts/app.js` (1278 lines) — all frontend logic
- `frontend/index.html` (429 lines) — SPA markup
- `frontend/styles/main.css` — all CSS
- `controllers/dashboardController.js` (642 lines) — API handlers
- `routes/api.js` (54 lines) — Express routes
- `services/GamificationEngine.js` (444 lines) — quests, badges, groups, XP
- `services/AIEngine.js` (404 lines) — spending analysis, insights (local only, no external AI)
- `services/NudgeEngine.js` (210 lines) — notification creation
- `services/AutoSaveEngine.js` (296 lines) — round-ups, streaks
- `database/sqlite-schema.js` — schema with `daily_quests`, `group_messages` tables
- `database/seed.js` (280 lines) — 3 users, 5 groups, transactions, budgets
- `config/index.js` — app config

**Patterns:** SQLite via `db.query($1,$2)` auto-converted from PG syntax. UUIDs via `gen_random_uuid()`. JWT auth on all `/api/*`. Frontend uses global `api(endpoint, opts)`, `showTab()`, `showNudgeToast()`, `playSound(type)`, `showBadgeEarnedOverlay(badge)`.

---

## Feature 1: Expanded Daily Quests That Actually Work

### Problem
Only 3 quests exist (`log_expense`, `save_5`, `stay_under_50`). They render but have no completion mechanism tied to user actions. No cycling/rotation.

### Solution

**`GamificationEngine.js`** — Expand quest pool to 8+ quests. Add a `QUEST_POOL` array:

```js
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
```

**Modify `generateDailyQuests(userId)`:** Track which quests were assigned previously via a `quest_rotation_index` stored in `gamification_profiles` or derived from `(dayOfYear % questPool.length)`. Pick 3 quests per day by cycling through the pool. When all quests have been used, loop back to the start.

**Add `updateQuestProgress(userId, questKey, value)` method:**
- Called from relevant actions:
  - `addDailyExpenditure` → increment `log_expense` (+1) and `log_3_expenses` (+1)
  - `getAIInsights` → set `check_insights` to 1
  - `createGoal` → set `set_goal` to 1
  - `joinSavingsGroup` → set `join_group` to 1
- Updates `current_value` in `daily_quests`. If `current_value >= target_value`, auto-complete: set `is_completed=1`, award XP via `completeQuest()`.
- For `stay_under_50` and `zero_spend`: check at end of day or when spending is logged — compare daily total against target.

**`dashboardController.js`** — In each relevant handler, call `gamificationEngine.updateQuestProgress()`:
- `addDailyExpenditure`: after insert, call `updateQuestProgress(userId, 'log_expense', 1)` and `updateQuestProgress(userId, 'log_3_expenses', 1)`
- `createGoal`: call `updateQuestProgress(userId, 'set_goal', 1)`
- `getAIInsights`: call `updateQuestProgress(userId, 'check_insights', 1)`
- `joinSavingsGroup` (in controller): call `updateQuestProgress(userId, 'join_group', 1)`

**`app.js`** — In `renderQuests()`, show completed quests with a ✅ and play `playSound("quest")` when a quest transitions to complete. After submitting expense/goal/etc, reload quests and check for newly completed ones.

---

## Feature 2: Delete Buttons That Work + Leave Group

### Current State
`deleteGoal()` and `deleteRule()` exist and work. Missing: delete expense, leave group.

### Backend

**`dashboardController.js`** — Add 2 methods:

```js
async deleteExpenditure(req, res) {
  const userId = req.user.id
  const { expenseId } = req.params
  await db.query(`DELETE FROM daily_expenditures WHERE id = $1 AND user_id = $2`, [expenseId, userId])
  res.json({ success: true })
}

async leaveGroup(req, res) {
  const userId = req.user.id
  const { groupId } = req.params
  await db.query(`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 AND role != 'admin'`, [groupId, userId])
  res.json({ success: true })
}
```

**`api.js`** — Add:
```
router.delete('/expenditures/:expenseId', dashboardController.deleteExpenditure)
router.delete('/groups/:groupId/leave', dashboardController.leaveGroup)
```

### Frontend

**`app.js`** — In `loadTodayExpenses()` render, add delete button per expense:
```
"<button class='delete-btn' onclick='deleteExpense(\"" + e.id + "\")'>🗑️</button>"
```
Add `deleteExpense(id)` function: confirm → `DELETE /expenditures/:id` → reload.

In `groupCard()`, for joined groups add a "Leave" button. Add `leaveGroup(groupId)` function: confirm → `DELETE /groups/:groupId/leave` → reload social tab.

---

## Feature 3: NPC Members + AI Chat via ILMU API

### Goal
Seed NPC users into groups. NPCs auto-generate chat messages using the ILMU AI API.

### Config (`config/index.js`)
Add:
```js
ilmuAI: {
  apiKey: process.env.ZAI_API_KEY || 'sk-e70417cf42ecfbe09f3e4110dc343cb26c39833a4d01274d',
  baseUrl: process.env.ZAI_BASE_URL || 'https://api.ilmu.ai/v1',
  model: process.env.ZAI_MODEL || 'ilmu-glm-5.1',
}
```

### Seed (`seed.js`)
Add 5 NPC users with `is_npc` flag. Add column `is_npc INTEGER DEFAULT 0` to `users` table in `sqlite-schema.js`.

```js
const npcs = [
  { name: 'Siti Bot', email: 'siti.npc@guga.ai' },
  { name: 'Raj Saver', email: 'raj.npc@guga.ai' },
  { name: 'Yuki Finance', email: 'yuki.npc@guga.ai' },
  { name: 'Ali Budget', email: 'ali.npc@guga.ai' },
  { name: 'Mei Savings', email: 'mei.npc@guga.ai' },
]
```

Insert NPCs into users table with `is_npc=1`. Add each NPC to 2-3 random groups. Seed some initial messages from NPCs in each group. Seed gamification profiles and streaks for NPCs.

### AI Service — New file: `src/services/IlmuAIService.js`

```js
const config = require('../config')

class IlmuAIService {
  async chat(systemPrompt, userMessage) {
    const res = await fetch(config.ilmuAI.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.ilmuAI.apiKey,
      },
      body: JSON.stringify({
        model: config.ilmuAI.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 200,
        temperature: 0.8,
      }),
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  }

  async generateNPCMessage(npcName, groupContext) {
    return this.chat(
      `You are ${npcName}, a friendly Malaysian user in a savings group. Keep responses short (1-2 sentences), casual, use Manglish occasionally. Talk about savings tips, encourage others, share relatable daily finance moments.`,
      `Group: ${groupContext}. Say something encouraging or share a savings tip.`
    )
  }
}
module.exports = new IlmuAIService()
```

### NPC Auto-Chat Trigger
**`GamificationEngine.js`** — Add `triggerNPCResponse(groupId)`: after a real user sends a message, 30% chance an NPC in the same group replies within the same request. Call `ilmuAIService.generateNPCMessage()` and insert into `group_messages`.

**`dashboardController.js`** — In `sendGroupMessage`, after inserting the user's message, call `gamificationEngine.triggerNPCResponse(groupId)`.

---

## Feature 4: Real AI Insights via ILMU API

### Goal
Replace the local `generatePersonalisedInsights()` with actual AI-generated insights.

### `AIEngine.js` Changes

Add method `generateAIInsights(userId)`:
```js
async generateAIInsights(userId) {
  const analysis = await this.analyseSpendingPatterns(userId)
  const user = await db.query(`SELECT * FROM users WHERE id = $1`, [userId])
  const goals = await db.query(`SELECT * FROM goals WHERE user_id = $1 AND is_active = true`, [userId])
  const userData = user.rows[0]

  const prompt = `Analyse this user's finances and give 3 actionable tips:
Income: RM${userData.monthly_income}/month
Monthly spending: RM${analysis.monthlyAverage.toFixed(0)}
Top categories: ${Object.entries(analysis.categoryBreakdown).map(([k,v]) => k+': RM'+v.total.toFixed(0)).join(', ')}
Trend: ${analysis.spendingTrend}
Goals: ${goals.rows.map(g => g.name + ' (RM'+g.current_amount+'/'+g.target_amount+')').join(', ')}
Respond in JSON: {"summary":"...","tips":[{"title":"...","message":"...","priority":"high|medium|low"}],"risks":[{"message":"...","severity":"high|medium"}]}`

  const ilmuAI = require('./IlmuAIService')
  const raw = await ilmuAI.chat(
    'You are a Malaysian financial advisor AI. Respond ONLY in valid JSON. Use RM currency. Be specific.',
    prompt
  )

  try {
    const parsed = JSON.parse(raw)
    // Merge with existing local analysis
    return {
      ...parsed,
      savingsRate: userData.monthly_income > 0
        ? ((userData.monthly_income - analysis.monthlyAverage) / userData.monthly_income * 100).toFixed(1)
        : 0,
      financialHealth: this.assessFinancialHealth(userData, analysis,
        userData.monthly_income > 0 ? ((userData.monthly_income - analysis.monthlyAverage) / userData.monthly_income * 100).toFixed(1) : 0),
      cached: false,
    }
  } catch (e) {
    // Fallback to local insights if AI response is invalid
    return await this.generatePersonalisedInsights(userId)
  }
}
```

### `dashboardController.js` — Modify `getAIInsights`
Change line 72 from `aiEngine.generatePersonalisedInsights(userId)` to `aiEngine.generateAIInsights(userId)`. Keep the cache check. If AI call fails, fallback to local.

### AI Tools (Actions)
Add an endpoint `POST /api/ai/action` that lets the AI insight page trigger actions:
- "Create a budget" — auto-create a budget based on AI recommendation
- "Set up round-up" — enable round-up savings rule
- "Create goal" — create a savings goal from AI suggestion

In the insights UI, render action buttons alongside tips. Each button calls the appropriate existing API endpoint.

**`app.js`** — In `loadInsights()` / `refreshInsights()`, render tips with action buttons:
```js
if (t.action === 'create_budget') {
  html += "<button class='btn-primary btn-sm' onclick='aiCreateBudget(\"" + t.category + "\"," + t.limit + ")'>Set Budget</button>";
}
```

Add `aiCreateBudget(category, limit)`, `aiEnableRoundUp()`, `aiCreateGoal(name, amount)` functions that call existing endpoints and show toasts.

---

## Feature 5: Auto-Save Rule Descriptions

### Problem
`renderRules()` at line 468 shows `JSON.stringify(r.config)` as the description — shows raw JSON like `{"destination_goal_id":"...","percentage":15}`.

### Fix in `app.js`

Replace the `renderRules()` description line. Add a helper:

```js
function getRuleDescription(rule) {
  var config = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config;
  switch (rule.rule_type) {
    case 'round_up':
      return 'Rounds up every purchase to the nearest RM1. Spare change goes to savings.';
    case 'salary_trigger':
      return 'Auto-saves ' + (config.percentage || 10) + '% of your salary when it arrives.';
    case 'fixed_schedule':
      return 'Saves RM' + (config.amount || 0) + ' on a ' + (config.frequency || 'weekly') + ' schedule.';
    case 'spending_threshold':
      return 'Saves the difference when you underspend your budget.';
    default:
      return 'Automated savings rule';
  }
}
```

Replace line 468: `"<p class='rule-desc'>" + JSON.stringify(r.config) + "</p>"` → `"<p class='rule-desc'>" + getRuleDescription(r) + "</p>"`

---

## Feature 6: Badge Collection Gallery (Roblox-Inspired)

### Goal
Add a "View All Badges" button that opens an overlay showing ALL 15 badges — earned ones highlighted, unearned ones greyed out with lock icon. Inspired by Roblox game badge pages.

### Backend
**`GamificationEngine.js`** — Add method `getAllBadgesForUser(userId)`:
```js
async getAllBadgesForUser(userId) {
  const earned = await db.query(`SELECT badge_key FROM badges WHERE user_id = $1`, [userId])
  const earnedKeys = new Set(earned.rows.map(r => r.badge_key))
  return Object.entries(this.allBadges).map(([key, badge]) => ({
    key, ...badge,
    earned: earnedKeys.has(key),
  }))
}
```

**`dashboardController.js`** — Add handler `getAllBadges`:
```js
async getAllBadges(req, res) {
  const badges = await gamificationEngine.getAllBadgesForUser(req.user.id)
  res.json(badges)
}
```

**`api.js`** — Add: `router.get('/badges', dashboardController.getAllBadges)`

### Frontend

**`index.html`** — Add badge gallery overlay:
```html
<div id="badgeGalleryOverlay" class="badge-gallery-overlay">
  <div class="badge-gallery-header">
    <h2>🏆 Badge Collection</h2>
    <button class="close-btn" onclick="closeBadgeGallery()">✕</button>
  </div>
  <p class="badge-gallery-subtitle" id="badgeGalleryCount">0/15 Collected</p>
  <div id="badgeGalleryGrid" class="badge-gallery-grid"></div>
</div>
```

**`app.js`** — In `loadGamification()`, add a "View All" button after the badge grid. Add functions:
- `openBadgeGallery()` — fetch `GET /badges`, render grid.
- `renderBadgeGallery(badges)` — for each badge:
  - Earned: full color, icon, name, description, earned date
  - Unearned: greyed out, 🔒 icon, name, "???" description, shows unlock condition
- `closeBadgeGallery()` — remove `.open`

**`main.css`** — Badge gallery styles:
```css
.badge-gallery-overlay { /* full-screen overlay */ }
.badge-gallery-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 16px; }
.badge-gallery-item { text-align: center; padding: 16px; background: var(--bg-card); border-radius: var(--radius); border: 1px solid var(--border); }
.badge-gallery-item.locked { opacity: 0.4; filter: grayscale(1); }
.badge-gallery-item.earned { border-color: var(--primary); box-shadow: 0 0 10px rgba(0,212,170,0.2); }
.badge-gallery-icon { font-size: 36px; margin-bottom: 8px; }
.badge-gallery-name { font-size: 12px; font-weight: 600; }
.badge-gallery-desc { font-size: 10px; color: var(--text-secondary); }
```

---

## Feature 7: Seed More Nudges

### `seed.js`
Add 5 more nudges for user u1:
```js
const moreNudges = [
  { type: 'goal_progress', title: 'Emergency Fund Progress', message: 'Your emergency fund is 31% complete (RM4,200/RM13,500). Stay consistent!', priority: 'normal' },
  { type: 'salary_trigger', title: 'Salary Auto-Save Done', message: 'RM375 (15%) has been moved from your salary to Japan Trip savings.', priority: 'normal' },
  { type: 'social_nudge', title: 'Group Activity', message: 'Budget Warriors has a new member! Check out the leaderboard.', priority: 'normal' },
  { type: 'ai_insight', title: 'Weekend Spending Pattern', message: 'You spend 40% more on weekends. Try setting a weekend-only budget of RM100.', priority: 'high' },
  { type: 'weekly_recap', title: 'Weekly Recap', message: 'This week: saved RM125, spent RM347. Net positive RM125! Streak: 12 days.', priority: 'normal' },
]
```
Insert for u1 with `is_read=0`.

Also add nudges for u2 and u3 so every user has notifications.

---

## Feature 8: Working Monthly Budgets

### Problem
Budgets display but `current_spent` is seeded statically and never updates when expenses are logged.

### Fix

**`dashboardController.js`** — In `addDailyExpenditure`, after inserting the expense, update the matching budget:
```js
const now = new Date()
await db.query(
  `UPDATE budgets SET current_spent = current_spent + $1, updated_at = NOW()
   WHERE user_id = $2 AND category = $3 AND period_month = $4 AND period_year = $5`,
  [amount, userId, category, now.getMonth() + 1, now.getFullYear()]
)
```

Also call `nudgeEngine.checkBudgetAlerts(userId)` — this already exists but needs the budget to be updated first.

**`NudgeEngine.js`** — `checkBudgetAlerts` already creates nudges at 80%+ and 100%+. No change needed, just ensure it runs after the budget update.

### Frontend — Budget Bar Overflow

**`app.js`** — In `renderBudgets()` in `loadDashboard()`, allow bar to visually exceed 100%:
```js
var pct = b.monthly_limit > 0 ? (b.current_spent / b.monthly_limit * 100) : 0;
var barWidth = Math.min(pct, 150); // allow up to 150% visual
var warnClass = pct > 100 ? " budget-exceeded" : pct > 75 ? " budget-warning" : "";
```

**`main.css`** — Add exceeded state:
```css
.budget-fill-exceeded { background: var(--danger); }
.budget-item.budget-exceeded .budget-name { color: var(--danger); font-weight: 700; }
.budget-item.budget-exceeded .budget-amounts { color: var(--danger); }
```

### Auto-Create Budgets
In `addDailyExpenditure`, if no budget exists for the category this month, auto-create one with a sensible default limit (e.g., `monthly_income * 0.15` for food, `0.10` for transport, etc.):
```js
const existingBudget = await db.query(
  `SELECT id FROM budgets WHERE user_id = $1 AND category = $2 AND period_month = $3 AND period_year = $4`,
  [userId, category, month, year]
)
if (!existingBudget.rows.length) {
  const limits = { food: 0.15, transport: 0.1, shopping: 0.1, entertainment: 0.05, bills: 0.15, health: 0.05, education: 0.05, groceries: 0.1, other: 0.1 }
  const limit = (user.monthly_income || 5000) * (limits[category] || 0.1)
  await db.query(
    `INSERT INTO budgets (id, user_id, category, monthly_limit, current_spent, period_month, period_year)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
    [userId, category, limit, amount, month, year]
  )
}
```

---

## Feature 9: Beautify Streaks

### `main.css` Changes

Enhance the streak card with gradient background, animated fire, and glowing active days:
```css
.streak-card {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  border: 1px solid rgba(0,212,170,0.2);
  position: relative; overflow: hidden;
}
.streak-card::before { /* subtle animated gradient shimmer */ }
.streak-fire { font-size: 48px; animation: firePulse 1.5s ease-in-out infinite; }
@keyframes firePulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); filter: brightness(1.3); } }
.streak-count { font-size: 28px; font-weight: 800; background: linear-gradient(135deg, #f59e0b, #ef4444); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.streak-day.active { background: linear-gradient(135deg, var(--primary), #10b981); box-shadow: 0 0 8px rgba(0,212,170,0.4); animation: dayGlow 2s ease-in-out infinite; }
@keyframes dayGlow { 0%,100% { box-shadow: 0 0 5px rgba(0,212,170,0.3); } 50% { box-shadow: 0 0 15px rgba(0,212,170,0.6); } }
.streak-day.today { border: 2px solid #f59e0b; }
.streak-best { color: var(--primary); font-weight: 600; }
```

### `app.js`
In `renderStreakCalendar()`, add milestone markers — show a ⭐ on day 7, 👑 on day 21, 💎 on day 30. Add streak milestone text below the calendar ("7 more days to Week Warrior badge!").

---

## Feature 10: Bug Fixes

### Bug A: `var roundUpDemoInterval` Declared Twice
Lines 775 and 866 both declare `var roundUpDemoInterval = null;`. Remove the duplicate at line 866.

### Bug B: Budget Query Uses EXTRACT (PostgreSQL, not SQLite)
Line 17 in `getDashboard()`: `EXTRACT(MONTH FROM NOW())` is PostgreSQL syntax. The connection wrapper may or may not handle this. Replace with SQLite:
```sql
AND period_month = CAST(strftime('%m', 'now') AS INTEGER)
AND period_year = CAST(strftime('%Y', 'now') AS INTEGER)
```

Similarly line 27-31 monthly spending query uses `EXTRACT`. Replace:
```sql
AND strftime('%m', transaction_date) = strftime('%m', 'now')
AND strftime('%Y', transaction_date) = strftime('%Y', 'now')
```

### Bug C: `loadGroups()` (Dead Code)
The old `loadGroups()` function (line 556-569) is dead code — `showTab("social")` calls `loadSocialTab()` now. Remove `loadGroups()` and the old `viewGroup()` to avoid confusion.

### Bug D: Quest Completion Doesn't Play Sound or Show XP Toast
`completeQuest` in the backend awards XP but the frontend never shows feedback. After calling quest completion API, frontend should `playSound("quest")` and `showNudgeToast({title: "Quest Complete!", message: "+N XP"})`.

### Bug E: `stay_under_50` Quest Never Completes
The "Stay Under RM50" quest has `target: 50` but no mechanism checks daily spending against it. Fix: in `updateQuestProgress`, for `stay_under_50`, check if today's total spending is under RM50. If user logs expense and daily total is still < 50, set `current_value = daily_total` (visual progress). At end of day (or via a check when expense is logged), if total < 50, auto-complete.

### Bug F: NPCs in Members List Not Distinguished
Add an `[NPC]` or `🤖` tag next to NPC names in the members list and chat. In `renderMembers()` and `renderChat()`, check `m.is_npc` flag.

---

## File Change Summary

| File | Features |
|---|---|
| `app.js` | 1,2,4,5,6,7,8,9,10 |
| `index.html` | 2,6 |
| `main.css` | 6,8,9 |
| `dashboardController.js` | 1,2,4,6,8 |
| `api.js` | 2,6 |
| `GamificationEngine.js` | 1,3,6 |
| `AIEngine.js` | 4 |
| `NudgeEngine.js` | 8 (no changes, existing logic) |
| `IlmuAIService.js` (NEW) | 3,4 |
| `sqlite-schema.js` | 3 (add `is_npc` column) |
| `seed.js` | 3,7 |
| `config/index.js` | 3 |
| `README.md` | update endpoints/features |

## Execution Order

1. **Feature 10** (Bug fixes) — fix EXTRACT syntax, duplicate var, dead code
2. **Feature 5** (Rule descriptions) — tiny, 1 function change
3. **Feature 2** (Delete/leave) — small, 2 new endpoints
4. **Feature 8** (Budgets work) — budget update on expense + auto-create
5. **Feature 7** (More nudges) — seed data only
6. **Feature 9** (Beautify streaks) — CSS only
7. **Feature 1** (Quest system) — quest pool + progress tracking
8. **Feature 6** (Badge gallery) — new overlay + endpoint
9. **Feature 3** (NPCs + AI chat) — new service + seed NPCs
10. **Feature 4** (AI insights) — integrate ILMU API

After all: delete `guga.db`, run `npm run seed`, restart `npm run dev`.
