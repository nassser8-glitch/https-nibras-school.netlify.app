const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const r = await p.query('SELECT id, school, name, email, role, active, first_login FROM users ORDER BY school, role, name');
  console.log('TOTAL:', r.rows.length);
  r.rows.forEach(u => console.log([u.school, u.role, u.name, u.email, 'active=' + u.active, 'first_login=' + u.first_login].join(' | ')));
  await p.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
