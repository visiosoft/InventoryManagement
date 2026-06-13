import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDb } from './db.js';
import { User } from './models/index.js';

// Seeds the admin user. Unit inventory comes from the spreadsheet import:
//   npm run import:inventory
// Idempotent — safe to run multiple times.

async function run() {
  await connectDb();
  console.log(`Connected to ${process.env.DB_NAME}`);

  const adminEmail = 'admin@purplebox.local';
  const existing = await User.findOne({ email: adminEmail });
  if (!existing) {
    await User.create({
      name: 'Admin',
      email: adminEmail,
      passwordHash: await bcrypt.hash('admin123', 10),
      role: 'admin',
    });
    console.log(`Created admin user: ${adminEmail} / admin123`);
  } else {
    console.log('Admin user already exists');
  }
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
