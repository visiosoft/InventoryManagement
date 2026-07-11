const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: '' },
    role: { type: String, enum: ['customer', 'admin'], default: 'customer' },

    // OTP auth (dev-friendly). For production, store only a hash + short TTL.
    otpCode: { type: String, default: null },
    otpExpiresAt: { type: Date, default: null },

    // Optional password (used only for admin accounts / admin panel login).
    passwordHash: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
