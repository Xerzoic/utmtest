const http = require('http');

http.get('http://localhost:3000/api/auth/demo-token', (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Body:', d.substring(0, 300));
  });
}).on('error', e => console.log('Error:', e.message));
