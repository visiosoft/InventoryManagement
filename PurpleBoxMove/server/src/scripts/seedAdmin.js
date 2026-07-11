// Creates (or updates) an admin user for the ops panel.
// Usage: npm run seed:admin
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectDB } = require('../config/db');
const User = require('../models/User');

(async () => {
  try {
    await connectDB(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/purplebox');
    const phone = process.env.ADMIN_PHONE || '500000000';
    const password = process.env.ADMIN_PASSWORD || 'purplebox';
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.findOneAndUpdate(
      { phone },
      { phone, role: 'admin', name: 'Ops', passwordHash },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`✓ Admin ready — phone: ${user.phone}  password: ${password}`);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
