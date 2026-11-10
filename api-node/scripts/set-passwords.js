/**
 * Gives every account whose password_hash is still 'CHANGE_ME' (from seed.sql)
 * the DEMO_PASSWORD from .env. Run once after loading the seed data:
 *   npm run set-passwords
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, query } = require('../src/db');

(async () => {
  const password = process.env.DEMO_PASSWORD || 'Password@123';
  const users = await query("SELECT user_id, email FROM users WHERE password_hash = 'CHANGE_ME'");
  if (!users.length) {
    console.log('No accounts need a password.');
  } else {
    const hash = await bcrypt.hash(password, 10);
    await query("UPDATE users SET password_hash = ? WHERE password_hash = 'CHANGE_ME'", [hash]);
    console.log(`Set the demo password for ${users.length} accounts:`);
    users.forEach((u) => console.log(`  ${u.email}`));
  }
  db.close();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
