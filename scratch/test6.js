const db = require('better-sqlite3')(':memory:');
const stmt = db.prepare("SELECT ? as a, ? as b, ? as c");
console.log(stmt.get(["first", "second", "third"]));
