import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'staff'], default: 'staff' },
  },
  { timestamps: true }
);

const unitTypeSchema = new Schema(
  {
    sizeSqf: { type: Number, required: true, unique: true },
    label: { type: String },
    weeklyRate: { type: Number, required: true, default: 0 },
    monthlyRate: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

const unitSchema = new Schema(
  {
    unitNumber: { type: String, required: true, unique: true },
    unitType: { type: Schema.Types.ObjectId, ref: 'UnitType', required: true },
    status: {
      type: String,
      enum: ['available', 'occupied', 'reserved', 'maintenance'],
      default: 'available',
    },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const customerSchema = new Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    emergencyNumber: { type: String, default: '' },
    address: { type: String, default: '' },
    company: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const contractSchema = new Schema(
  {
    contractNo: { type: String, required: true, unique: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    unit: { type: Schema.Types.ObjectId, ref: 'Unit', required: true },
    billingPeriod: { type: String, enum: ['weekly', 'monthly'], required: true },
    rate: { type: Number, required: true },
    deposit: { type: Number, default: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    autoRenew: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['draft', 'pending_signature', 'active', 'ended', 'cancelled'],
      default: 'draft',
    },
    zohoRequestId: { type: String, default: '' },
    signedDocUrl: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const paymentSchema = new Schema(
  {
    contract: { type: Schema.Types.ObjectId, ref: 'Contract', required: true },
    amount: { type: Number, required: true },
    dueDate: { type: Date, required: true },
    paidDate: { type: Date },
    method: { type: String, enum: ['cash', 'bank_transfer', 'card', 'other', ''], default: '' },
    status: { type: String, enum: ['pending', 'paid', 'overdue'], default: 'pending' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const documentSchema = new Schema(
  {
    contract: { type: Schema.Types.ObjectId, ref: 'Contract' },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    name: { type: String, required: true },
    type: { type: String, enum: ['contract', 'id_proof', 'other'], default: 'other' },
    storage: { type: String, enum: ['drive', 'local'], default: 'local' },
    driveFileId: { type: String, default: '' },
    url: { type: String, default: '' },
  },
  { timestamps: true }
);

const auditLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: String, default: '' },
    detail: { type: String, default: '' },
  },
  { timestamps: true }
);

const counterSchema = new Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

export const User = model('User', userSchema);
export const UnitType = model('UnitType', unitTypeSchema);
export const Unit = model('Unit', unitSchema);
export const Customer = model('Customer', customerSchema);
export const Contract = model('Contract', contractSchema);
export const Payment = model('Payment', paymentSchema);
export const Document = model('Document', documentSchema);
export const AuditLog = model('AuditLog', auditLogSchema);
export const Counter = model('Counter', counterSchema);

export async function nextContractNo() {
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate(
    { key: `contract-${year}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `PB-${year}-${String(counter.seq).padStart(4, '0')}`;
}
