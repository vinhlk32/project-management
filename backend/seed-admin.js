#!/usr/bin/env node
// One-time script to create the admin user
require('dotenv').config();
const bcrypt = require('bcrypt');
const { initializeDatabase, db } = require('./db');

async function seedAdmin() {
  await initializeDatabase();

  const email    = 'admin@admin.com';
  const password = 'Admin@123';
  const name     = 'Admin';

  const existing = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] });
  if (existing.rows.length > 0) {
    console.log('Admin user already exists.');
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 12);
  await db.execute({
    sql: 'INSERT INTO users (name, email, role, password_hash, avatar_color) VALUES (?, ?, ?, ?, ?)',
    args: [name, email, 'admin', hash, '#4a9eff'],
  });

  console.log('✅ Admin user created!');
  console.log('   Email:    admin@admin.com');
  console.log('   Password: Admin@123');
  process.exit(0);
}

seedAdmin().catch(err => { console.error(err); process.exit(1); });
