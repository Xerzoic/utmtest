const db = require('better-sqlite3')(':memory:');

db.exec(`
  CREATE TABLE ai_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    insight_type TEXT NOT NULL,
    content TEXT NOT NULL,
    generated_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    UNIQUE(user_id, insight_type)
  )
`);

const userId = '123';
const insights = { test: true };

const sql = `INSERT INTO ai_insights (user_id, insight_type, content, generated_at, expires_at)
       VALUES (?, 'full_analysis', ?, datetime('now'), datetime('now', '+24 hours'))
       ON CONFLICT (user_id, insight_type)
       DO UPDATE SET content = ?, generated_at = datetime('now'), expires_at = datetime('now', '+24 hours')`;

try {
  const stmt = db.prepare(sql);
  console.log("Preparing successful!");
  stmt.run(userId, JSON.stringify(insights));
  console.log("Execution successful!");
} catch(e) {
  console.error("Error:", e.message);
}
