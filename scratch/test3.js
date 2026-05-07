const { toSQLite } = require('../src/database/connection');

const sql = `INSERT INTO ai_insights (user_id, insight_type, content, generated_at, expires_at)
       VALUES ($1, 'full_analysis', $2, datetime('now'), datetime('now', '+24 hours'))
       ON CONFLICT (user_id, insight_type)
       DO UPDATE SET content = $2, generated_at = datetime('now'), expires_at = datetime('now', '+24 hours')`;

console.log("Converted:", toSQLite(sql));
