# Implementation Plan: 5 Feature Enhancements

## Project Context

- **Stack**: Node.js/Express backend, SQLite (`better-sqlite3`), vanilla HTML/CSS/JS frontend (mobile-first SPA, 480px max)
- **Key Files**: `src/frontend/index.html`, `src/frontend/scripts/app.js`, `src/frontend/styles/main.css`, `src/controllers/dashboardController.js`, `src/routes/api.js`, `src/services/NudgeEngine.js`, `src/services/AutoSaveEngine.js`, `src/services/AIEngine.js`, `src/database/sqlite-schema.js`, `src/config/index.js`, `src/server.js`, `src/routes/auth.js`, `README.md`, `package.json`
- **DB wrapper** in `src/database/connection.js` uses PostgreSQL syntax (`$1`, `$2`) auto-converted to SQLite `?`. Uses `RETURNING *` for inserts. UUID via `gen_random_uuid()`.
- **Auth**: JWT via `src/middleware/auth.js`. All `/api/*` routes require `authenticate` middleware. Token stored in `localStorage` as `gxsave_token`.
- **Frontend pattern**: Global `api(endpoint, options)` helper, modals via `.modal`/`.modal.open` toggle, `showNudgeToast({title, message, priority})` for toasts, `showTab(name)` for navigation.

---

## Feature 1: Mark All As Read in Notifications

### Goal
Add a "Mark All as Read" button in the notification slide-out panel header so users can dismiss all notifications at once.

### Backend Changes

**File: `src/controllers/dashboardController.js`**
Add method inside the `DashboardController` class (after `readNudge` method at line ~240):

```js
async markAllNudgesRead(req, res) {
  try {
    const userId = req.user.id
    await db.query(
      `UPDATE nudges SET is_read = true WHERE user_id = $1 AND is_read = false`,
      [userId]
    )
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
```

**File: `src/routes/api.js`**
Add after line 24 (`router.patch('/nudges/:nudgeId/read', ...)`):
```js
router.patch('/nudges/mark-all-read', dashboardController.markAllNudgesRead)
```

> [!IMPORTANT]
> This route MUST be placed BEFORE the `/:nudgeId/read` route, otherwise Express will treat `mark-all-read` as a `nudgeId` param.

### Frontend Changes

**File: `src/frontend/index.html`**
Replace the nudge panel header (lines 234-238):
```html
<div id="nudgePanel" class="nudge-panel">
  <div class="nudge-panel-header">
    <h3>Notifications</h3>
    <div class="nudge-panel-actions">
      <button class="btn-mark-all" id="markAllReadBtn" onclick="markAllRead()">Mark all read</button>
      <button class="close-btn" onclick="toggleNudgePanel()">✕</button>
    </div>
  </div>
```

**File: `src/frontend/scripts/app.js`**
Add function:
```js
async function markAllRead() {
  await api("/nudges/mark-all-read", { method: "PATCH" });
  loadNudges();
  updateNudgeBadge();
  showNudgeToast({ title: "All Clear!", message: "All notifications marked as read", priority: "normal" });
}
```

**File: `src/frontend/styles/main.css`**
Add:
```css
.nudge-panel-actions { display: flex; align-items: center; gap: 8px; }
.btn-mark-all {
  background: none; border: 1px solid var(--border); color: var(--primary);
  padding: 4px 10px; border-radius: var(--radius-sm); font-size: 11px;
  font-weight: 500; cursor: pointer; font-family: inherit; transition: all 0.2s;
}
.btn-mark-all:hover { background: var(--primary); color: var(--bg); }
```

---

## Feature 2: Streak Bonus Login Animation (Duolingo-Style)

### Goal
Show a full-screen celebratory overlay on every daily login displaying the user's current streak with animated fire, confetti particles, and an encouraging message. Inspired by Duolingo's streak celebration.

### Mechanism
- **No new backend endpoint needed.** The dashboard API (`GET /api/dashboard`) already returns `streak.current_streak` and `streak.longest_streak`.
- Use `localStorage` key `guga_last_streak_shown` to store the date when the animation was last shown. If it's a new day, show it.
- Trigger at the end of `loadDashboard()` after streak data is available.

### Frontend Changes

**File: `src/frontend/index.html`**
Add before `</main>` (before line 232), a streak overlay container:
```html
<div id="streakOverlay" class="streak-overlay">
  <div class="streak-overlay-content">
    <div class="streak-confetti" id="streakConfetti"></div>
    <div class="streak-anim-fire" id="streakAnimFire">🔥</div>
    <p class="streak-anim-count" id="streakAnimCount">0</p>
    <p class="streak-anim-label">Day Streak!</p>
    <p class="streak-anim-msg" id="streakAnimMsg">Keep it up!</p>
    <button class="btn-primary streak-anim-btn" onclick="dismissStreakOverlay()">Continue</button>
  </div>
</div>
```

**File: `src/frontend/scripts/app.js`**

Add function `checkStreakAnimation(streakData)` — call it at end of `loadDashboard()`:
```js
function checkStreakAnimation(streak) {
  var count = streak?.current_streak || 0;
  if (count <= 0) return;
  var today = new Date().toISOString().split("T")[0];
  var lastShown = localStorage.getItem("guga_last_streak_shown");
  if (lastShown === today) return;
  localStorage.setItem("guga_last_streak_shown", today);
  showStreakOverlay(count);
}
```

Add `showStreakOverlay(count)`:
- Set `#streakAnimCount` text to count.
- Set motivational message based on count (1: "Your journey begins!", 7: "One week strong!", 21: "Habit formed!", 30+: "Unstoppable!").
- Add `.open` class to `#streakOverlay`.
- Generate 30 confetti particle `<div>`s inside `#streakConfetti`, each with random color, position, delay, and CSS animation.
- Animate the fire emoji with a scale-bounce keyframe.
- Counter counts up from 0 to `count` over ~1s using `setInterval`.

Add `dismissStreakOverlay()`:
- Remove `.open` class, clear confetti innerHTML.

Call `checkStreakAnimation(data.streak)` at end of `loadDashboard()` (after line 246).

**File: `src/frontend/styles/main.css`**
Add full overlay styles:
```css
.streak-overlay {
  display: none; position: fixed; inset: 0; z-index: 500;
  background: rgba(10, 15, 26, 0.95);
  align-items: center; justify-content: center; flex-direction: column;
}
.streak-overlay.open { display: flex; }
.streak-overlay-content { text-align: center; position: relative; z-index: 2; }
.streak-anim-fire { font-size: 80px; animation: fireScale 0.6s ease-out; }
.streak-anim-count {
  font-size: 72px; font-weight: 800;
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  animation: countPop 0.4s ease-out 0.3s both;
}
.streak-anim-label { font-size: 20px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; }
.streak-anim-msg { font-size: 14px; color: var(--text-muted); margin-bottom: 24px; }
.streak-anim-btn { padding: 12px 40px; font-size: 15px; }
.streak-confetti { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 1; }
.confetti-particle {
  position: absolute; width: 8px; height: 8px; border-radius: 2px;
  animation: confettiFall 2.5s ease-in forwards;
}
@keyframes fireScale { 0% { transform: scale(0); } 50% { transform: scale(1.3); } 100% { transform: scale(1); } }
@keyframes countPop { 0% { transform: scale(0); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
@keyframes confettiFall {
  0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
  100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
}
```

---

## Feature 3: Rebrand to "GuGa Saves"

### Goal
Replace ALL references to "GXSave", "GXBank", "GX" branding with "GuGa Saves" / "GuGa" throughout the entire codebase. The column names `gxbank_account_id` and `gxbank_txn_id` in the database schema should NOT be renamed (would break the DB), but all user-facing text and code-level naming must change.

### Complete Rename Map

| Old | New |
|---|---|
| `GXSave` (user-facing title) | `GuGa Saves` |
| `GXBank` (user-facing) | `GuGa Bank` |
| `GX` (logo icon text) | `GG` |
| `gxsave_token` (localStorage key) | `guga_token` |
| `gxsave-dev-secret` | `guga-dev-secret` |
| `gxsave_db` (config default) | `guga_saves_db` |
| `gxsave.db` (SQLite file ref) | `guga.db` |
| `GX-` prefix in register | `GG-` |
| `gxbank` config key | `gugabank` |
| `api.gxbank.com.my` | `api.gugabank.com.my` |
| `GXSave server running` (console) | `GuGa Saves server running` |

### Files to Modify

1. **`src/frontend/index.html`** (lines 6, 15, 16, 18, 60, 61):
   - Title: `GuGa Saves - Smart Savings App`
   - Logo icon spans: `GG` instead of `GX`
   - Logo text spans: `Saves` (stays same)
   - Auth title: `Welcome to GuGa Saves`
   - Auth subtitle: `Smart savings powered by behavioural finance` (remove GXBank ref)

2. **`src/frontend/scripts/app.js`** (lines 12, 91, 118, 125, 144, 150):
   - All `gxsave_token` → `guga_token`
   - `"GX-" + Date.now()` → `"GG-" + Date.now()`
   - Demo login error message: remove `localhost:3000` GXSave ref

3. **`src/server.js`** (line 82):
   - Console log: `GuGa Saves server running on port`

4. **`src/config/index.js`** (lines 9, 18, 21, 22, 23):
   - `gxsave_db` → `guga_saves_db`
   - `gxsave-dev-secret...` → `guga-dev-secret-change-in-production`
   - `gxbank:` key → `gugabank:`
   - API URL → `https://api.gugabank.com.my/v1`
   - ENV var names: `GXBANK_API_URL` → `GUGABANK_API_URL`, `GXBANK_API_KEY` → `GUGABANK_API_KEY`

5. **`src/database/connection.js`** (line 4):
   - `gxsave.db` → `guga.db`

6. **`README.md`**: Full rebrand of all headings, descriptions, references.

7. **`package.json`** (lines 2, 4):
   - name: `guga-saves-behavioural-finance`
   - description: replace GXBank references

8. **`.env` and `.env.example`**: Update any `GXBANK_*` env var names.

9. **`src/database/seed.js`** (lines 12, 22, 32): `gxbank_account_id` values `GX001234567` → `GG001234567` etc.

10. **`src/database/seed.test.js`**: Same pattern for test data, emails `@gxsave.test` → `@guga.test`.

> [!WARNING]
> Do NOT rename the database column names (`gxbank_account_id`, `gxbank_txn_id`) in `sqlite-schema.js`. This would require a migration and break existing data. Only rename user-facing strings and code-level config identifiers.

---

## Feature 4: Personalised Financial Advice (Quick Action)

### Goal
Add a new "My Advisor" quick action button that opens an interactive full-screen advisory panel. It presents personalised spending/savings advice across three time horizons (daily, monthly, annual) with animated stat cards, interactive period tabs, and actionable tips. Data is derived from the existing `AIEngine.analyseSpendingPatterns()` and dashboard data.

### Backend Changes

**File: `src/controllers/dashboardController.js`**
Add new method `getPersonalisedAdvice`:

```js
async getPersonalisedAdvice(req, res) {
  try {
    const userId = req.user.id
    const user = await db.query(`SELECT * FROM users WHERE id = $1`, [userId])
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' })

    const [daily, monthly, annual] = await Promise.all([
      this._getSpendingForPeriod(userId, 1),
      this._getSpendingForPeriod(userId, 30),
      this._getSpendingForPeriod(userId, 365),
    ])

    const income = user.rows[0].monthly_income || 0
    const goals = await db.query(`SELECT * FROM goals WHERE user_id = $1 AND is_active = true`, [userId])
    const streak = await db.query(`SELECT * FROM savings_streaks WHERE user_id = $1`, [userId])

    // Generate advice per period
    const advice = {
      daily: { spent: daily.total, categories: daily.categories, tip: this._getDailyTip(daily, income) },
      monthly: { spent: monthly.total, categories: monthly.categories, savingsRate: income > 0 ? ((income - monthly.total) / income * 100).toFixed(1) : 0, tip: this._getMonthlyTip(monthly, income, goals.rows) },
      annual: { spent: annual.total, projected: monthly.total * 12, categories: annual.categories, tip: this._getAnnualTip(annual, income) },
      streak: streak.rows[0] || { current_streak: 0 },
      goalCount: goals.rows.length,
    }
    res.json(advice)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
```

Add two private helper methods `_getSpendingForPeriod(userId, days)` and `_getDailyTip / _getMonthlyTip / _getAnnualTip`:

- `_getSpendingForPeriod`: Queries `transactions` for `type='debit'` in the last N days, returns `{ total, categories: [{category, total}] }`.
- Tip generators: Return `{ title, message, priority }` objects with contextual advice based on spending vs income ratios.

**File: `src/routes/api.js`**
Add: `router.get('/advice', dashboardController.getPersonalisedAdvice)`

### Frontend Changes

**File: `src/frontend/index.html`**

Add quick action button in `.action-grid` (after the "Analyse Spending" button, line ~181):
```html
<button class="action-btn action-btn-advisor" onclick="openAdvisor()" id="advisorBtn">
  <span class="action-icon">💡</span>
  <span class="action-label">My Advisor</span>
</button>
```

Add advisor overlay (before closing `</div>` of `mainApp`, after modals):
```html
<div id="advisorOverlay" class="advisor-overlay">
  <div class="advisor-header">
    <h2>💡 My Financial Advisor</h2>
    <button class="close-btn" onclick="closeAdvisor()">✕</button>
  </div>
  <div class="advisor-tabs">
    <button class="advisor-tab active" onclick="switchAdvisorTab('daily')" id="advTabDaily">Daily</button>
    <button class="advisor-tab" onclick="switchAdvisorTab('monthly')" id="advTabMonthly">Monthly</button>
    <button class="advisor-tab" onclick="switchAdvisorTab('annual')" id="advTabAnnual">Annual</button>
  </div>
  <div id="advisorContent" class="advisor-content">
    <p class="empty-state">Loading advice...</p>
  </div>
</div>
```

**File: `src/frontend/scripts/app.js`**

Add functions:
- `openAdvisor()`: Add `.open` to `#advisorOverlay`, call `loadAdvice()`.
- `closeAdvisor()`: Remove `.open`.
- `loadAdvice()`: Call `api("/advice")`, store in `state.adviceData`, call `renderAdviceTab("daily")`.
- `switchAdvisorTab(period)`: Toggle `.active` on tabs, call `renderAdviceTab(period)`.
- `renderAdviceTab(period)`: Render into `#advisorContent`:
  - Large animated stat card showing total spent for the period
  - For monthly: show savings rate as an animated ring/gauge
  - Category breakdown as horizontal colored bars (reuse spending chart pattern)
  - Tip card with priority-colored left border
  - For annual: show projected annual spending vs income comparison

**File: `src/frontend/styles/main.css`**

Add styles for advisor overlay (full-screen slide-up panel), tabs, stat cards with count-up animation, ring gauge for savings rate. Key classes:
```css
.advisor-overlay { /* fixed full-screen, slide up from bottom */ }
.advisor-tabs { /* horizontal pill-style tab bar */ }
.advisor-tab.active { /* primary colored */ }
.advisor-stat-card { /* large centered stat with gradient text */ }
.advisor-ring { /* conic-gradient savings rate circle */ }
.advisor-tip-card { /* bordered card with icon and message */ }
.action-btn-advisor { /* subtle purple gradient accent */ }
```

---

## Feature 5: Interactive Round-Up Savings Toggle

### Goal
Add a dedicated quick-action in the dashboard and an interactive card on the Auto-Save tab that lets users toggle round-up savings on/off with a single tap. Show a real-time visual demonstration of how round-up works (animated coins falling into a piggy bank) and a running total of round-up savings.

### Backend Changes

**File: `src/controllers/dashboardController.js`**
Add method `getRoundUpStatus`:
```js
async getRoundUpStatus(req, res) {
  try {
    const userId = req.user.id
    const rule = await db.query(
      `SELECT * FROM autosave_rules WHERE user_id = $1 AND rule_type = 'round_up' LIMIT 1`,
      [userId]
    )
    const totalRoundUps = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM autosave_transactions WHERE user_id = $1 AND type = 'round_up'`,
      [userId]
    )
    res.json({
      enabled: rule.rows.length > 0 && rule.rows[0].is_active === 1,
      ruleId: rule.rows[0]?.id || null,
      totalSaved: parseFloat(totalRoundUps.rows[0].total),
      transactionCount: totalRoundUps.rows[0].count,
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
```

Add method `toggleRoundUp`:
```js
async toggleRoundUp(req, res) {
  try {
    const userId = req.user.id
    const { enabled } = req.body
    const existing = await db.query(
      `SELECT * FROM autosave_rules WHERE user_id = $1 AND rule_type = 'round_up' LIMIT 1`,
      [userId]
    )
    if (existing.rows.length) {
      await db.query(
        `UPDATE autosave_rules SET is_active = $1, updated_at = NOW() WHERE id = $2`,
        [enabled ? 1 : 0, existing.rows[0].id]
      )
      res.json({ success: true, enabled })
    } else if (enabled) {
      const result = await autoSaveEngine.createRule(userId, 'round_up', { destination_goal_id: null })
      res.json({ success: true, enabled: true, rule: result })
    } else {
      res.json({ success: true, enabled: false })
    }
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
```

**File: `src/routes/api.js`**
Add:
```js
router.get('/roundup/status', dashboardController.getRoundUpStatus)
router.post('/roundup/toggle', dashboardController.toggleRoundUp)
```

### Frontend Changes

**File: `src/frontend/index.html`**

Replace the existing "Enable Round-Up" quick action button (lines 166-169) with:
```html
<button class="action-btn" onclick="openRoundUpPanel()" id="roundUpQuickBtn">
  <span class="action-icon">🪙</span>
  <span class="action-label">Round-Up</span>
</button>
```

Add round-up interactive panel (after advisor overlay, before closing `mainApp`):
```html
<div id="roundUpPanel" class="roundup-panel">
  <div class="roundup-panel-header">
    <h2>🪙 Round-Up Savings</h2>
    <button class="close-btn" onclick="closeRoundUpPanel()">✕</button>
  </div>
  <div class="roundup-panel-body">
    <div class="roundup-demo" id="roundUpDemo">
      <div class="roundup-example">
        <p class="roundup-example-label">You spend</p>
        <p class="roundup-example-amount" id="roundUpSpend">RM 4.70</p>
        <p class="roundup-example-label">We round up to</p>
        <p class="roundup-example-rounded" id="roundUpRounded">RM 5.00</p>
        <div class="roundup-coin-trail" id="coinTrail"></div>
        <p class="roundup-example-saved">RM 0.30 → Savings 🐷</p>
      </div>
    </div>
    <div class="roundup-toggle-card">
      <div class="roundup-toggle-info">
        <h3>Enable Round-Up</h3>
        <p>Every purchase is rounded up to the nearest RM. The spare change goes to your savings.</p>
      </div>
      <label class="toggle-switch toggle-lg">
        <input type="checkbox" id="roundUpToggle" onchange="handleRoundUpToggle(this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="roundup-stats" id="roundUpStats">
      <div class="roundup-stat">
        <p class="roundup-stat-value" id="roundUpTotal">RM 0</p>
        <p class="roundup-stat-label">Total Saved</p>
      </div>
      <div class="roundup-stat">
        <p class="roundup-stat-value" id="roundUpCount">0</p>
        <p class="roundup-stat-label">Round-Ups</p>
      </div>
    </div>
  </div>
</div>
```

**File: `src/frontend/scripts/app.js`**

Add functions:
- `openRoundUpPanel()`: Add `.open`, call `loadRoundUpStatus()`, start coin animation demo.
- `closeRoundUpPanel()`: Remove `.open`.
- `loadRoundUpStatus()`: Call `api("/roundup/status")`, set toggle checkbox state, update stats.
- `handleRoundUpToggle(enabled)`: Call `api("/roundup/toggle", { method: "POST", body: ... })`, show toast confirming on/off, play activation animation if enabling.
- `animateRoundUpDemo()`: Cycle through example purchases (RM 4.70→5.00, RM 12.30→13.00, RM 8.50→9.00) with animated coin particles moving from the amount to a piggy bank icon. Use `setInterval` to rotate examples every 3s.

**File: `src/frontend/styles/main.css`**

Add styles:
```css
.roundup-panel { /* full-screen slide-up overlay like advisor */ }
.roundup-demo { /* centered demo animation area */ }
.roundup-example { text-align: center; padding: 24px; }
.roundup-example-amount { font-size: 32px; font-weight: 800; }
.roundup-example-rounded { font-size: 32px; font-weight: 800; color: var(--primary); }
.roundup-example-saved { color: var(--primary); font-weight: 600; }
.roundup-toggle-card { /* card with toggle, similar to rule-card */ }
.toggle-lg { width: 56px; height: 30px; }
.roundup-stats { display: flex; gap: 16px; justify-content: center; }
.roundup-stat { text-align: center; padding: 16px; background: var(--bg); border-radius: var(--radius); flex: 1; }
.roundup-stat-value { font-size: 24px; font-weight: 800; color: var(--primary); }
.roundup-coin { /* animated coin particle */ }
@keyframes coinDrop { /* coin falling into piggy bank animation */ }
```

---

## File Change Summary

| File | Features |
|---|---|
| `src/frontend/index.html` | 1, 2, 3, 4, 5 |
| `src/frontend/scripts/app.js` | 1, 2, 3, 4, 5 |
| `src/frontend/styles/main.css` | 1, 2, 4, 5 |
| `src/controllers/dashboardController.js` | 1, 4, 5 |
| `src/routes/api.js` | 1, 4, 5 |
| `src/server.js` | 3 |
| `src/config/index.js` | 3 |
| `src/database/connection.js` | 3 |
| `src/database/seed.js` | 3 |
| `src/database/seed.test.js` | 3 |
| `src/routes/auth.js` | — (no changes) |
| `README.md` | 3 |
| `package.json` | 3 |
| `.env` / `.env.example` | 3 |

## Execution Order

1. **Feature 3 first** (Rebrand) — touches every file, best done before adding new code
2. **Feature 1** (Mark All Read) — small, independent
3. **Feature 2** (Streak Animation) — frontend-only, no backend deps
4. **Feature 5** (Round-Up Toggle) — new endpoints + interactive UI
5. **Feature 4** (Advisor) — most complex, depends on existing AI engine

After all changes: restart server (`npm run dev`), test via demo login.
