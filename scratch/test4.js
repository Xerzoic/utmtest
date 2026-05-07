const db = require('better-sqlite3')(':memory:');
const stmt = db.prepare("SELECT ?2 as a, ?1 as b, ?2 as c");
console.log(stmt.get("first", "second"));
