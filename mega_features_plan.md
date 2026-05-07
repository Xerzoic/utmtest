# Implementation Plan: 7 Features + Bug Fixes

## Current Codebase Context

- **Stack**: Express + SQLite (`better-sqlite3`), vanilla HTML/CSS/JS SPA (480px mobile-first)
- **Key files**: `index.html`, `app.js`, `main.css`, `dashboardController.js`, `api.js` (routes), `GamificationEngine.js`, `NudgeEngine.js`, `AutoSaveEngine.js`, `AIEngine.js`, `sqlite-schema.js`, `seed.js`, `connection.js`, `config/index.js`, `server.js`, `README.md`
- **DB**: SQLite, queries use PostgreSQL syntax ($1,$2) auto-converted by `connection.js`. UUID via `gen_random_uuid()`. `RETURNING *` supported.
- **Auth**: JWT. All `/api/*` routes use `authenticate` middleware. Token in localStorage as `guga_token`.
- **Frontend**: `api(endpoint, options)` helper, modals via `.modal`/`.modal.open`, `showNudgeToast()`, `showTab(name)`, bottom nav with 5 tabs.
- **Brand**: Already rebranded to "GuGa Saves" with logo `GG`.

---

## PRIORITY 0: Bug Fixes (Feature 6)

### Bug A: Infinite Loop Crash (CRITICAL)

**Root Cause**: `loadInsights()` at line 372 of `app.js` calls `showTab("insights")`, and `showTab()` at line 553 calls `loadInsights()` when `tabName === "insights"`. This creates infinite recursion.

**Fix in `app.js`**:
- Remove `showTab("insights");` from inside `loadInsights()` (line 372). The function should only fetch data and render, not switch tabs.
- In `showTab()`, keep `if (tabName === "insights") loadInsights();` as-is — this is the only entry point.
- For the "Analyse Spending" quick action button in `index.html`, change `onclick="loadInsights()"` to `onclick="showTab('insights')"`.
- For the Refresh button in the insights tab header, change `onclick="loadInsights()"` to call a separate `refreshInsights()` function that just fetches data without calling `showTab`.

### Bug B: Groups Don't Work

**Root Cause**: There is no `GET /api/groups` route. The `loadGroups()` function calls `api("/groups")` which hits `POST /api/groups` or returns 404.

**Fix in `api.js`**: Add before the POST route:
```js
router.get('/groups', dashboardController.listGroups)
```

**Fix in `dashboardController.js`**: Add method:
```js
async listGroups(req, res) {
  try {
    const userId = req.user.id
    const groups = await db.query(
      `SELECT sg.*, COUNT(gm.id) as member_count,
       EXISTS(SELECT 1 FROM group_members WHERE group_id = sg.id AND user_id = $1) as is_member
       FROM savings_groups sg
       LEFT JOIN group_members gm ON gm.group_id = sg.id
       GROUP BY sg.id ORDER BY sg.created_at DESC`, [userId])
    res.json(groups.rows)
  } catch (error) { res.status(500).json({ error: error.message }) }
}
```

### Bug C: Round-Up Total Doesn't Update After Logging Expense

**Root Cause**: In `addDailyExpenditure()`, `autoSaveEngine.executeRoundUp(txn.id)` is called, but the front-end round-up panel doesn't refresh its status after submitting an expense.

**Fix in `app.js`**: In `submitExpense()`, after the successful API call, also call `loadRoundUpStatus()` if the round-up panel state exists. Also ensure the `addDailyExpenditure` controller actually generates a transaction ID that the round-up engine can find (check the INSERT uses proper `id` generation via `gen_random_uuid()`).

**Fix in `dashboardController.js`**: In `addDailyExpenditure`, the transaction INSERT is missing an `id` column with UUID generation. Add `id` field:
```sql
INSERT INTO transactions (id, user_id, gxbank_txn_id, amount, type, category, merchant, description, transaction_date)
VALUES (gen_random_uuid(), $1, $2, $3, 'debit', $4, 'Manual Entry', $5, COALESCE($6, date('now')))
```

---

## Feature 1: Spending Calendar

### Goal
Add a calendar view in the dashboard showing color-coded days: 🟢 green (spending ≤ daily budget), 🟡 yellow (spending 50-100% of budget), 🔴 red (spending > budget). Clicking a day opens a detail panel showing that day's expenditures and savings.

### Backend

**`dashboardController.js`** — Add `getCalendarData`:
```
GET /api/calendar?month=YYYY-MM
```
Query `transactions` for the month, group by day, calculate daily totals. Compare against `monthly_income / 30` as the daily budget threshold. Return:
```json
{ "days": [{ "date": "2026-05-01", "spent": 45.00, "saved": 12.00, "status": "green|yellow|red" }] }
```

**`dashboardController.js`** — Add `getDayDetail`:
```
GET /api/calendar/day?date=YYYY-MM-DD
```
Return all transactions + expenditures for that date.

**`api.js`**: Add both routes.

### Frontend

**`index.html`**: Add a new section in `#dashboardTab` after the streak card:
```html
<section class="calendar-section">
  <div class="calendar-header">
    <button onclick="prevMonth()">◀</button>
    <h2 id="calendarMonth">May 2026</h2>
    <button onclick="nextMonth()">▶</button>
  </div>
  <div class="calendar-grid" id="calendarGrid"></div>
</section>
```

Also add a day-detail slide-up panel (similar to nudge panel).

**`app.js`**: Add functions:
- `loadCalendar(year, month)` — fetch `/api/calendar?month=YYYY-MM`, render 7-column grid. Each day cell has colored dot/background based on status.
- `openDayDetail(date)` — fetch `/api/calendar/day?date=...`, show panel with expense list + savings total.
- `prevMonth()` / `nextMonth()` — navigate months.
- Call `loadCalendar()` from `loadDashboard()`.

**`main.css`**: Calendar grid styles:
```css
.calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.cal-day { aspect-ratio: 1; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 12px; cursor: pointer; }
.cal-day.green { background: rgba(16,185,129,0.2); color: var(--success); }
.cal-day.yellow { background: rgba(245,158,11,0.2); color: var(--warning); }
.cal-day.red { background: rgba(239,68,68,0.2); color: var(--danger); }
```

---

## Feature 2: Social System (Clash Royale Inspired)

### Goal
Fully functional social tab with: dummy groups to discover/join, group detail page with tabs (Chat, Members, Leaderboard), daily quests system, and monthly refreshing leaderboard.

### Database Changes (`sqlite-schema.js`)

Add 2 new tables:
```sql
CREATE TABLE IF NOT EXISTS daily_quests (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  quest_key TEXT NOT NULL,
  quest_title TEXT NOT NULL,
  quest_description TEXT NOT NULL,
  xp_reward INTEGER NOT NULL,
  target_value REAL,
  current_value REAL DEFAULT 0,
  is_completed INTEGER DEFAULT 0,
  quest_date TEXT NOT NULL DEFAULT (date('now')),
  completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quests_user_key_date ON daily_quests(user_id, quest_key, quest_date);

CREATE TABLE IF NOT EXISTS group_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT REFERENCES savings_groups(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  sent_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_group_messages ON group_messages(group_id, sent_at DESC);
```

### Seed Data — Dummy Groups (`seed.js`)

Add 5 preset groups:
- "Budget Warriors" — Emergency savings clan
- "RM10K Racers" — Race to RM10K
- "Zero Spend Squad" — Minimize daily spending
- "Gig Savers" — For freelancers
- "Student Stackers" — Student saving group

Insert these with `created_by` as the first seeded user.

### Backend

**`GamificationEngine.js`** — Add methods:
- `generateDailyQuests(userId)` — creates 3 quests per day if not already created for today:
  - "Log an expense" (target: 1 entry)
  - "Save RM5 today" (target: 5.00)
  - "Stay under RM50 spending" (target: 50.00)
- `getDailyQuests(userId)` — returns today's quests with progress
- `completeQuest(userId, questKey)` — marks complete, awards XP, checks badge triggers
- `getGroupMessages(groupId, limit)` — returns recent messages
- `sendGroupMessage(groupId, userId, message)` — inserts message
- `getGroupMembers(groupId)` — returns member list with profiles

**`dashboardController.js`** — Add handlers for:
- `GET /api/quests` → `getDailyQuests`
- `POST /api/quests/:questKey/complete` → `completeQuest`
- `GET /api/groups` — modify `listGroups` to return both joined and unjoined groups, with `is_member` flag
- `GET /api/groups/:groupId/messages` → `getGroupMessages`
- `POST /api/groups/:groupId/messages` → `sendGroupMessage`
- `GET /api/groups/:groupId/members` → `getGroupMembers`

**`api.js`** — Add all new routes.

### Frontend — Social Tab Redesign

**`index.html`**: Replace the `#socialTab` content with:
```html
<div id="socialTab" class="tab-content">
  <!-- Daily Quests Section -->
  <section class="quests-section">
    <h2 class="section-title">⚔️ Daily Quests</h2>
    <div id="questsList" class="quests-list"></div>
  </section>

  <!-- My Groups -->
  <section class="my-groups-section">
    <h2 class="section-title">My Clans</h2>
    <div id="myGroupsList" class="groups-grid"></div>
  </section>

  <!-- Discover Groups -->
  <section class="discover-section">
    <h2 class="section-title">Discover Clans</h2>
    <div id="discoverGroupsList" class="groups-grid"></div>
  </section>
</div>
```

Add group detail overlay:
```html
<div id="groupDetailOverlay" class="group-detail-overlay">
  <div class="group-detail-header">
    <button onclick="closeGroupDetail()">← Back</button>
    <h2 id="groupDetailName">Group</h2>
  </div>
  <div class="group-detail-tabs">
    <button class="gd-tab active" onclick="switchGroupTab('chat')">💬 Chat</button>
    <button class="gd-tab" onclick="switchGroupTab('members')">👥 Members</button>
    <button class="gd-tab" onclick="switchGroupTab('leaderboard')">🏆 Leaderboard</button>
  </div>
  <div id="groupDetailContent"></div>
  <!-- Chat input -->
  <div class="chat-input-bar" id="chatInputBar">
    <input type="text" id="chatInput" placeholder="Type a message...">
    <button onclick="sendMessage()">Send</button>
  </div>
</div>
```

**`app.js`** — Add functions:
- `loadSocialTab()` — fetch quests + groups, render both sections
- `renderQuests(quests)` — render quest cards with progress bars, XP reward labels. Completed quests have green check + sparkle.
- `renderGroups(groups)` — split into "My Clans" (joined) and "Discover" (not joined). Each card shows name, member count, and Join/View button.
- `joinGroup(groupId)` — POST to join, show toast, reload.
- `openGroupDetail(groupId)` — open overlay, load chat.
- `switchGroupTab(tab)` — toggle between chat/members/leaderboard.
- `renderChat(messages)` — message bubbles, user's own messages on right.
- `sendMessage()` — POST message, reload chat.
- `renderMembers(members)` — list with level badges.
- `renderGroupLeaderboard(data)` — ranked list with gold/silver/bronze badges (Clash Royale style).
- Update `showTab("social")` to call `loadSocialTab()`.

**`main.css`**: Clash Royale inspired styling:
- Group cards with gradient borders and clan shield icons
- Quest cards with XP badge and animated progress bar
- Leaderboard with ranked tiers (gold crown top 1, silver, bronze)
- Chat bubbles with dark theme
- Tab bar with segmented-control style

---

## Feature 3: Gamification Engine Enhancement

### Sound Effects

Add sound files to `src/frontend/public/sounds/`:
- `badge_earned.mp3` — crisp chime/ding
- `xp_gain.mp3` — short positive tick
- `level_up.mp3` — fanfare
- `quest_complete.mp3` — achievement sound

Since we can't generate audio, use Web Audio API to synthesize sounds:

**`app.js`** — Add `playSound(type)` function using `AudioContext` to generate:
- Badge: short descending chime (two tones)
- XP: quick ascending blip
- Level up: longer ascending arpeggio
- Quest: bright staccato

### Badge Collection Animation

**`app.js`** — Add `showBadgeEarnedOverlay(badge)`:
- Full-screen overlay with badge icon scaling from 0 to 1 with bounce easing
- Badge name and description fade in below
- Particle burst behind the badge
- Play `badge_earned` sound
- Auto-dismiss after 3s or on tap

**`index.html`** — Add badge overlay container:
```html
<div id="badgeOverlay" class="badge-overlay">
  <div class="badge-overlay-content">
    <div class="badge-particles" id="badgeParticles"></div>
    <div class="badge-earned-icon" id="badgeEarnedIcon"></div>
    <p class="badge-earned-name" id="badgeEarnedName"></p>
    <p class="badge-earned-desc" id="badgeEarnedDesc"></p>
    <button class="btn-primary" onclick="dismissBadgeOverlay()">Awesome!</button>
  </div>
</div>
```

### XP Bar Animation

- When XP is gained, the gamification profile XP bar on the dashboard should animate with a glow effect
- Add CSS `@keyframes xpFill` that pulses the bar with a shimmer effect
- Play `xp_gain` sound when XP increases

### Backend Integration

**`dashboardController.js`**: Modify response of endpoints that trigger XP/badges to return `{ ...data, xpGained: N, badgeEarned: { key, name, icon } }` so the frontend knows when to animate.

Specifically modify:
- `addDailyExpenditure` — check if quest progress should update, return XP if gained
- `createGoal` — return XP gained (50 XP)
- `toggleRoundUp` — check for Penny Saver badge progress

**`GamificationEngine.js`**: The badge system with all 14 badges already exists. Add a method `checkAllBadges(userId)` that runs all badge checks and returns any newly earned badges:
- First Step — check if any autosave transaction exists
- Week Warrior / Habit Master / Monthly Champion — check streak
- Grand RM1K / Ten K Club — check total savings
- Goal Crusher — check completed goals
- Team Player — check group membership
- Budget Master — check all budgets under limit
- Penny Saver — check round-up total ≥ 100

---

## Feature 4: Update README

Rewrite `README.md` to reflect all new features:
- Change all "GXSave" → "GuGa Saves", "GXBank" → "GuGa Bank"
- Add new API endpoints for calendar, quests, groups chat/members, round-up toggle, advice
- Update project structure to mention new files/sounds
- Update feature descriptions: calendar, social system, daily quests, gamification with sound
- Update the architecture diagram with new modules
- Add new badges/quests in the gamification section

---

## Feature 5: UI Enhancement & Button Organization

### Dashboard Section Reorder

Reorganize the dashboard tab sections in this order:
1. Hero card (greeting, total saved, monthly spending)
2. Streak card
3. **Calendar** (new — Feature 1)
4. Today's Expenses
5. Spending Breakdown
6. Monthly Budgets
7. Gamification profile
8. Today's Nudges
9. Quick Actions (moved to bottom)

### Quick Actions Reorganization

Group the action buttons into two categories:

```html
<section class="quick-actions">
  <h2 class="section-title">Quick Actions</h2>
  <h3 class="action-category">💰 Money</h3>
  <div class="action-grid">
    <!-- Log Expense (highlight), Round-Up, New Goal -->
  </div>
  <h3 class="action-category">📊 Insights</h3>
  <div class="action-grid">
    <!-- My Advisor, Analyse Spending -->
  </div>
  <h3 class="action-category">👥 Social</h3>
  <div class="action-grid">
    <!-- Join Group, Daily Quests -->
  </div>
</section>
```

### CSS Polish

- Add subtle card entry animations (`@keyframes fadeSlideUp`)
- Improve section spacing and visual hierarchy
- Add icon backgrounds for action buttons instead of plain text emojis
- Ensure all interactive elements have hover/active states
- Add `.section-divider` between major dashboard sections

---

## Feature 7: Delete Goals & Rules

### Backend

**`dashboardController.js`** — Add two methods:

```js
async deleteGoal(req, res) {
  try {
    const userId = req.user.id
    const { goalId } = req.params
    await db.query(`DELETE FROM goals WHERE id = $1 AND user_id = $2`, [goalId, userId])
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
}

async deleteAutoSaveRule(req, res) {
  try {
    const userId = req.user.id
    const { ruleId } = req.params
    await db.query(`DELETE FROM autosave_rules WHERE id = $1 AND user_id = $2`, [ruleId, userId])
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
}
```

**`api.js`** — Add:
```js
router.delete('/goals/:goalId', dashboardController.deleteGoal)
router.delete('/autosave/rules/:ruleId', dashboardController.deleteAutoSaveRule)
```

### Frontend

**`app.js`** — Modify `renderGoals()`: add a delete button (🗑️) to each goal card. Add `deleteGoal(goalId)` function that confirms, calls `DELETE /api/goals/:id`, reloads goals.

Modify `renderRules()`: add a delete button to each rule card. Add `deleteRule(ruleId)` function that confirms, calls `DELETE /api/autosave/rules/:id`, reloads rules.

**`main.css`**: Style delete buttons:
```css
.delete-btn {
  background: none; border: none; color: var(--danger); cursor: pointer;
  font-size: 14px; padding: 4px 8px; border-radius: 4px; transition: all 0.2s;
}
.delete-btn:hover { background: rgba(239,68,68,0.15); }
```

---

## Complete File Change Summary

| File | Changes |
|---|---|
| `src/frontend/index.html` | Calendar section, social tab redesign, group detail overlay, badge overlay, quest section, delete buttons in goals/rules, button reorganization |
| `src/frontend/scripts/app.js` | **Bug fix (infinite loop)**, calendar functions, social/quest/chat functions, badge animation, sound synthesis, delete goal/rule functions, round-up refresh fix, UI reorder |
| `src/frontend/styles/main.css` | Calendar grid, social/clan cards, quest cards, chat bubbles, leaderboard tiers, badge overlay, XP animation, delete buttons, layout polish |
| `src/controllers/dashboardController.js` | **Bug fix (txn ID)**, calendar endpoints, listGroups, daily quests, group messages/members, delete goal/rule, XP/badge return data |
| `src/routes/api.js` | All new routes: calendar, quests, groups GET, messages, members, delete goals/rules |
| `src/services/GamificationEngine.js` | Daily quest generation/completion, group messages, checkAllBadges, sound trigger data |
| `src/database/sqlite-schema.js` | `daily_quests` table, `group_messages` table |
| `src/database/seed.js` | 5 dummy groups |
| `README.md` | Full rewrite for GuGa Saves with all new features |

## Execution Order

1. **Bug Fixes** (Priority 0) — fix infinite loop, missing groups route, round-up refresh, transaction ID
2. **Feature 7** (Delete goals/rules) — small, independent
3. **Feature 5** (UI Enhancement) — reorganize before adding new sections
4. **Feature 1** (Calendar) — new dashboard section
5. **Feature 2** (Social System) — largest feature, new tables + seeding + full UI
6. **Feature 3** (Gamification) — depends on quests from Feature 2
7. **Feature 4** (README) — do last after all features are implemented

After all: run `npm run migrate`, `npm run seed`, restart `npm run dev`.
