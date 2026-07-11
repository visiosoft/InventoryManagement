const mongoose = require('mongoose');

const photoSchema = new mongoose.Schema(
  { url: String, label: String, driveFileId: String },
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

const leadSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Contact info (denormalized from User for quick access)
    phone: { type: String, default: '' },
    name: { type: String, default: '' },

    // Schedule
    date: { type: String, default: null },
    slot: { type: String, default: null },

    // Locations
    from: { type: String, default: '' },
    to: { type: String, default: '' },

    // Home & items
    homeSize: { type: String, default: null },
    notes: { type: String, default: '' },

    // Media
    photos: { type: [photoSchema], default: [] },
    video: { url: String, dur: String, driveFileId: String },

    // Google Drive folder for this lead's media
    driveFolderId: { type: String, default: null },

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

    reference: { type: String, index: true },
  },
  { timestamps: true }
);

leadSchema.pre('save', function (next) {
  if (!this.reference) {
    this.reference = 'PB-' + Math.floor(1000 + Math.random() * 9000);
  }
  next();
});

module.exports = mongoose.model('Lead', leadSchema);
