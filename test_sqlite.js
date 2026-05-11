const db=require('better-sqlite3')('guga.db'); try{ console.log(db.prepare('SELECT id FROM users WHERE lower(email) = ?1').all('a', 'b')); } catch(e){ console.log('ERROR:', e.message); }  
