const db = require('better-sqlite3')(':memory:');
try {
  console.log(db.prepare("SELECT datetime('now', '+24 hours')").get());
} catch(e) {
  console.error(e.message);
}
