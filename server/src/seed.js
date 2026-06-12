import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDb } from './db.js';
import { User, UnitType, Unit } from './models/index.js';

// Seeds: admin user, the 8 unit types, and sample units per size.
// Idempotent — safe to run multiple times.

const UNIT_TYPES = [
  { sizeSqf: 10, label: 'Locker', weeklyRate: 15, monthlyRate: 50, count: 10 },
  { sizeSqf: 25, label: 'Small', weeklyRate: 25, monthlyRate: 85, count: 12 },
  { sizeSqf: 35, label: 'Small+', weeklyRate: 32, monthlyRate: 110, count: 10 },
  { sizeSqf: 50, label: 'Medium', weeklyRate: 42, monthlyRate: 145, count: 10 },
  { sizeSqf: 75, label: 'Medium+', weeklyRate: 55, monthlyRate: 190, count: 8 },
  { sizeSqf: 100, label: 'Large', weeklyRate: 70, monthlyRate: 240, count: 6 },
  { sizeSqf: 150, label: 'XL', weeklyRate: 95, monthlyRate: 330, count: 4 },
  { sizeSqf: 200, label: 'XXL', weeklyRate: 120, monthlyRate: 420, count: 4 },
];

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

  for (const t of UNIT_TYPES) {
    const type = await UnitType.findOneAndUpdate(
      { sizeSqf: t.sizeSqf },
      { $setOnInsert: { label: t.label, weeklyRate: t.weeklyRate, monthlyRate: t.monthlyRate } },
      { new: true, upsert: true }
    );
    // Unit numbers like A10-01, A25-03 ... prefix per size for readability.
    for (let i = 1; i <= t.count; i++) {
      const unitNumber = `U${t.sizeSqf}-${String(i).padStart(2, '0')}`;
      await Unit.findOneAndUpdate(
        { unitNumber },
        { $setOnInsert: { unitType: type._id, status: 'available' } },
        { upsert: true }
      );
    }
    console.log(`Unit type ${t.sizeSqf} sqf ready with ${t.count} units`);
  }

  const total = await Unit.countDocuments();
  console.log(`Done. Total units: ${total}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
