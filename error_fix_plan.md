# Complete Error Fix Plan — GXSave Behavioural Finance Engine

Full audit of all 20 source files. **No files modified** — this is a plans-only document.

---

## Why the Server Doesn't Start (the `curl` failure)

The server crashes during `require()` initialization before it ever reaches `server.listen()`. The crash originates from the chain of `require` calls in `server.js` that load the service engines, which in turn import `connection.js`. The `connection.js` module opens the SQLite database and initializes immediately. When the cron jobs fire or the initial module load triggers a query with broken SQL, the process crashes with an unhandled error before listening on port 3000.

**Root chain:**  
`server.js` → `require('./services/NudgeEngine')` → `require('./database/connection')` → opens DB  
`server.js` → starts cron, cron fires `nudgeEngine.runAllNudgeChecks()` → queries crash → server dies  

**Combined** with the SQL bugs below, the server never successfully stays alive.

---

## 🔴 Critical Errors (Server-Crashing)

### Bug 1: `RETURNING *` Silently Returns Empty Rows
| File | [connection.js](file:///D:/antigravity%20ide/utm/src/database/connection.js#L52-L59) |
|------|------|
| **Impact** | Every INSERT/UPDATE with `RETURNING *` returns `{ rows: [] }`, causing downstream `undefined` property access crashes |

**Problem:** The `query()` function in `connection.js` routes all INSERT/UPDATE/DELETE to `stmt.run()`, which only returns `{ changes, lastInsertRowid }`. It discards `RETURNING` data. However, `stmt.all()` properly handles `RETURNING` and returns the inserted/updated rows.

**Affected queries (6 total):**
- `NudgeEngine.js:26` — `INSERT INTO nudges ... RETURNING *` → `result.rows[0]` is `undefined`
- `GamificationEngine.js:33` — `UPDATE ... RETURNING xp, level` → `result.rows[0]` is `undefined`
- `GamificationEngine.js:161` — `INSERT INTO savings_groups ... RETURNING *` → `result.rows[0]` is `undefined`
- `AutoSaveEngine.js:20` — `INSERT INTO autosave_rules ... RETURNING *` → `result.rows[0]` is `undefined`
- `dashboardController.js:104` — `INSERT INTO goals ... RETURNING *` → `result.rows[0]` is `undefined`
- `dashboardController.js:151` — `INSERT INTO transactions ... RETURNING *` → `result.rows[0]` is `undefined`

**Fix plan:** In `connection.js`, detect if the SQL contains `RETURNING` and use `stmt.all()` instead of `stmt.run()`:
```javascript
if (trimmed.startsWith('INSERT') || trimmed.startsWith('UPDATE') || trimmed.startsWith('DELETE')) {
  const stmt = db.prepare(converted)
  if (converted.toUpperCase().includes('RETURNING')) {
    const rows = stmt.all(...(params || []))
    return Promise.resolve({ rows, rowCount: rows.length })
  }
  const info = stmt.run(...(params || []))
  return Promise.resolve({ rows: [], rowCount: info.changes, lastInsertRowid: info.lastInsertRowid })
}
```

---

### Bug 2: `$N` Parameter Reuse Produces Wrong Placeholder Count
| File | [connection.js:11](file:///D:/antigravity%20ide/utm/src/database/connection.js#L11) |
|------|------|
| **Impact** | `Too few parameter values` crash on any query reusing a `$N` placeholder |

**Problem:** `.replace(/\$([0-9]+)/g, '?')` converts **every** `$N` to `?`, discarding the index. If a query uses `$2` twice (e.g., INSERT + ON CONFLICT DO UPDATE SET), `better-sqlite3` sees 3 `?` but gets 2 params → crash.

**Affected queries:**
- `AIEngine.js:195-200` — uses `$2` twice (INSERT value + UPSERT update)
- `seed.test.js:128` — uses `$4` twice in budget UPSERT

**Fix plan:** Use SQLite's indexed placeholder `?NNN`:
```javascript
.replace(/\$([0-9]+)/g, '?$1')
```

---

### Bug 3: `CURRENT_DATE - INTERVAL '5 days'` Not Transpiled
| File | [seed.test.js:136](file:///D:/antigravity%20ide/utm/src/database/seed.test.js#L136) |
|------|------|
| **Impact** | SQLite syntax error `near "INTERVAL"` crashes the test seeder |

**Problem:** `toSQLite()` only handles `NOW() ± INTERVAL '...'`. It doesn't handle `CURRENT_DATE ± INTERVAL '...'`, which is used in `seed.test.js:136`.

**Fix plan:** Broaden the regex in `connection.js` to also match `CURRENT_DATE`:
```javascript
result = result.replace(/CURRENT_DATE\s*\+\s*INTERVAL '([^']+)'/g, "date('now', '+$1')")
result = result.replace(/CURRENT_DATE\s*-\s*INTERVAL '([^']+)'/g, "date('now', '-$1')")
```

---

### Bug 4: Missing `UNIQUE(user_id)` on `savings_streaks` Table
| File | [sqlite-schema.js:89-97](file:///D:/antigravity%20ide/utm/src/database/sqlite-schema.js#L89-L97) |
|------|------|
| **Impact** | `ON CONFLICT (user_id) DO NOTHING` in `seed.test.js:137` fails with "no such column" or similar |

**Problem:** The `savings_streaks` table has no `UNIQUE` constraint or index on `user_id`, but `seed.test.js:137` uses `ON CONFLICT (user_id) DO NOTHING`.

**Fix plan:** Add a unique index after the table:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_streaks_user ON savings_streaks(user_id);
```

---

### Bug 5: Missing Primary Key Generation in Seed Inserts
| File | [seed.test.js:118-119](file:///D:/antigravity%20ide/utm/src/database/seed.test.js#L118-L119) |
|------|------|
| **Impact** | NULL primary key → insert failure |

**Problem:** Several INSERT statements in `seed.test.js` omit the `id` column (e.g., `autosave_rules`, `savings_streaks`, `gamification_profiles`). The schema defines `id TEXT PRIMARY KEY` with no default — SQLite will set `id = NULL`, violating the PRIMARY KEY constraint.

Note: queries using `gen_random_uuid()` are handled by `toSQLite()` (line 12) which generates a proper UUID hex. But queries that omit `id` entirely get no value.

**Fix plan:** Add `id` column with `gen_random_uuid()` to every INSERT in `seed.test.js` that's missing it, OR change the schema to use `INTEGER PRIMARY KEY AUTOINCREMENT` for non-UUID tables.

---

## 🟡 Major Errors (Runtime Failures on Specific Endpoints)

### Bug 6: `totalSavings.rows[0].sum` — Wrong Column Name
| File | [dashboardController.js:49](file:///D:/antigravity%20ide/utm/src/controllers/dashboardController.js#L49) |
|------|------|
| **Impact** | `NaN` or `undefined` for total savings on dashboard |

**Problem:** The query `SELECT COALESCE(SUM(current_amount), 0) FROM goals ...` returns a column named `COALESCE(SUM(current_amount), 0)` in SQLite (not `.sum` like PostgreSQL). Accessing `.rows[0].sum` returns `undefined`.

**Fix plan:** Add an alias to the query:
```sql
SELECT COALESCE(SUM(current_amount), 0) AS sum FROM goals WHERE ...
```

---

### Bug 7: `members.rows[0].count` — Wrong Column Name
| File | [GamificationEngine.js:181](file:///D:/antigravity%20ide/utm/src/services/GamificationEngine.js#L181) |
|------|------|
| **Impact** | `parseInt(undefined)` → `NaN`, group size check always fails |

**Problem:** `SELECT COUNT(*) FROM group_members ...` returns column `COUNT(*)` in SQLite, not `count`.

**Fix plan:** Add alias:
```sql
SELECT COUNT(*) AS count FROM group_members WHERE group_id = $1
```

---

### Bug 8: Frontend Not Served by Express
| File | [server.js](file:///D:/antigravity%20ide/utm/src/server.js) |
|------|------|
| **Impact** | No frontend accessible at `http://localhost:3000/` |

**Problem:** `server.js` never calls `express.static()` to serve the frontend files. The `src/frontend/` directory with `index.html`, `styles/main.css`, and `scripts/app.js` is never mounted.

**Fix plan:** Add static file serving to `server.js`:
```javascript
app.use(express.static(path.join(__dirname, 'frontend')))
```

---

### Bug 9: `content` Column Stored as TEXT, Accessed as Object
| File | [dashboardController.js:68](file:///D:/antigravity%20ide/utm/src/controllers/dashboardController.js#L68) |
|------|------|
| **Impact** | Spread operator on a string: `{ ...cached.rows[0].content }` produces character-indexed object |

**Problem:** In the `ai_insights` table, `content` is `TEXT` (not `JSONB`). The value is `JSON.stringify(insights)` on write but is returned as a raw string. The spread `{ ...cached.rows[0].content, cached: true }` on a string produces `{ '0': '{', '1': '"', ... }`.

**Fix plan:** Parse the JSON before spreading:
```javascript
const parsed = JSON.parse(cached.rows[0].content)
return res.json({ ...parsed, cached: true })
```

---

### Bug 10: `monthlyIncome` vs `monthly_income` Property Name Mismatch
| File | [AIEngine.js:180,284,288](file:///D:/antigravity%20ide/utm/src/services/AIEngine.js#L180) |
|------|------|
| **Impact** | Savings rate always `0`, tips misfire |

**Problem:** The database column is `monthly_income` (snake_case), but the code accesses `userData.monthlyIncome` (camelCase). SQLite returns column names as-is.

**Locations:**
- Line 180: `userData.monthlyIncome` → should be `userData.monthly_income`
- Line 284: `user.monthly_income` (correct in one place!)
- Line 288: `user.monthlyIncome` → should be `user.monthly_income`
- Line 338: `user.monthlyIncome` → should be `user.monthly_income`
- Line 343: `user.monthlyIncome` → should be `user.monthly_income`

**Fix plan:** Replace all `userData.monthlyIncome` / `user.monthlyIncome` with `user.monthly_income`.

---

## 🟢 Minor Issues (Functional but Problematic)

### Bug 11: Duplicate `toSQLite` ON CONFLICT Regex is Dead Code
| File | [connection.js:35-36](file:///D:/antigravity%20ide/utm/src/database/connection.js#L35-L36) |
|------|------|
| **Impact** | Dead code — the regex pattern can never match after Bug 2 fix |

**Problem:** Line 36 has a very specific regex to match `ON CONFLICT ... expires_at = datetime('now') + INTERVAL '...'`. But the SQL in `AIEngine.js` already uses native SQLite `datetime('now', '+24 hours')` syntax, not `INTERVAL`. This regex never matches. After fixing Bug 2, it becomes completely unnecessary.

**Fix plan:** Remove lines 35-36 entirely.

---

### Bug 12: `sqlite.js` is Unused
| File | [sqlite.js](file:///D:/antigravity%20ide/utm/src/database/sqlite.js) |
|------|------|
| **Impact** | Dead code, confusion |

**Problem:** `sqlite.js` contains a standalone `SQLiteAdapter` class but is never imported by anything. All DB access goes through `connection.js`. It also has Bug 2 (blind `$N` → `?` replace) and no `toSQLite` transpilation.

**Fix plan:** Delete `sqlite.js` or consolidate with `connection.js`.

---

### Bug 13: `schema.js` (PostgreSQL) is Unused
| File | [schema.js](file:///D:/antigravity%20ide/utm/src/database/schema.js) |
|------|------|
| **Impact** | Dead code |

**Problem:** The PostgreSQL schema file is never referenced. `migrate.js` imports from `sqlite-schema.js`. Keeping it risks confusion and version drift.

**Fix plan:** Remove or clearly mark as reference-only.

---

### Bug 14: Console SQL Logging Left in Production Code
| File | [connection.js:43](file:///D:/antigravity%20ide/utm/src/database/connection.js#L43) |
|------|------|
| **Impact** | Performance, logs user data to stdout |

**Problem:** `console.log('SQL:', converted, 'Params:', params)` logs every query and its parameters (including user IDs, tokens, amounts).

**Fix plan:** Gate behind `NODE_ENV === 'development'` or remove.

---

## Summary: Fix Priority Order

| Priority | Bug | File | Description |
|----------|-----|------|-------------|
| 🔴 P0 | Bug 2 | `connection.js` | Fix `$N` → `?N` parameter transpilation |
| 🔴 P0 | Bug 1 | `connection.js` | Fix `RETURNING *` to use `stmt.all()` |
| 🔴 P0 | Bug 8 | `server.js` | Add `express.static()` for frontend |
| 🔴 P0 | Bug 6 | `dashboardController.js` | Add `AS sum` alias |
| 🔴 P0 | Bug 7 | `GamificationEngine.js` | Add `AS count` alias |
| 🟡 P1 | Bug 10 | `AIEngine.js` | Fix `monthlyIncome` → `monthly_income` |
| 🟡 P1 | Bug 9 | `dashboardController.js` | Parse JSON content before spread |
| 🟡 P1 | Bug 3 | `connection.js` | Handle `CURRENT_DATE ± INTERVAL` |
| 🟡 P1 | Bug 4 | `sqlite-schema.js` | Add `UNIQUE(user_id)` to `savings_streaks` |
| 🟡 P1 | Bug 5 | `seed.test.js` | Add `id` to INSERTs missing it |
| 🟢 P2 | Bug 11 | `connection.js` | Remove dead ON CONFLICT regex |
| 🟢 P2 | Bug 12 | `sqlite.js` | Remove unused file |
| 🟢 P2 | Bug 13 | `schema.js` | Remove unused file |
| 🟢 P2 | Bug 14 | `connection.js` | Remove/gate SQL logging |

> [!IMPORTANT]
> Fixing just **Bug 1** and **Bug 2** in `connection.js` plus **Bug 8** in `server.js` will get the server running and the frontend accessible. The remaining bugs will cause runtime errors on specific endpoints/features.
