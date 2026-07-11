const mongoose = require('mongoose');

const photoSchema = new mongoose.Schema(
  { url: String, label: String },
  { _id: false }
);

const quoteLineSchema = new mongoose.Schema(
  { label: String, amount: Number },
  { _id: false }
);

const trackingStepSchema = new mongoose.Schema(
  {
    title: String,
    sub: String,
    state: { type: String, enum: ['done', 'active', 'todo'], default: 'todo' },
  },
  { _id: false }
);

const moveSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Schedule
    date: { type: String, default: null }, // ISO date or human label
    slot: { type: String, default: null },

    // Locations
    from: { type: String, default: '' },
    to: { type: String, default: '' },

    // Home & items
    homeSize: { type: String, default: null }, // Studio | 1 BHK | 2 BHK | Villa
    notes: { type: String, default: '' },

    // Media
    photos: { type: [photoSchema], default: [] },
    video: { url: String, dur: String },

    // Add-ons
    addons: {
      disassembly: { type: Boolean, default: false },
      insurance: { type: Boolean, default: false },
      handyman: { type: Boolean, default: false },
    },

    // Lifecycle
    status: {
      type: String,
      enum: ['draft', 'pending_review', 'quoted', 'accepted', 'in_progress', 'completed', 'cancelled'],
      default: 'draft',
      index: true,
    },

    // Quote (filled by admin/ops after review)
    quote: {
      lines: { type: [quoteLineSchema], default: [] },
      subtotal: Number,
      vat: Number,
      total: Number,
      reviewedBy: String,
      validUntil: Date,
      createdAt: Date,
    },

    // Tracking timeline
    tracking: { type: [trackingStepSchema], default: [] },

    reference: { type: String, index: true }, // e.g. PB-2481
  },
  { timestamps: true }
);

// Auto-generate a human reference like PB-4821 on first save.
moveSchema.pre('save', function (next) {
  if (!this.reference) {
    this.reference = 'PB-' + Math.floor(1000 + Math.random() * 9000);
  }
  next();
});

module.exports = mongoose.model('Move', moveSchema);
