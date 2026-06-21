import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const ALL_MODULES = [
  'dashboard', 'units', 'moving_inventory', 'contracts', 'documents',
  'customers', 'quotes', 'invoices', 'vendors', 'expenses',
  'leads', 'purchases', 'payments',
  'reports_monthly', 'reports_units', 'reports_finances', 'reports_forecast', 'reports_contracts',
  'reports_vacancies', 'reports_overdue', 'reports_expiring',
  'settings',
];

const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'staff'], default: 'staff' },
    // Modules this user can access. Admins bypass this check entirely.
    permissions: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export { ALL_MODULES };

const unitTypeSchema = new Schema(
  {
    sizeSqf: { type: Number, required: true, unique: true },
    label: { type: String },
    weeklyRate: { type: Number, required: true, default: 0 },
    monthlyRate: { type: Number, required: true, default: 0 },
    discountPct: { type: Number, default: 20 },
  },
  { timestamps: true }
);

const unitSchema = new Schema(
  {
    unitNumber: { type: String, required: true, unique: true },
    floor: { type: String, default: '' },
    sizeSqf: { type: Number, default: null },
    price: { type: Number, default: null }, // monthly rate (AED)
    lengthFt: { type: Number, default: null },
    widthFt: { type: Number, default: null },
    status: {
      type: String,
      enum: ['available', 'occupied', 'reserved', 'maintenance'],
      default: 'available',
    },
    discountPct: { type: Number, default: 0, min: 0, max: 100 },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const accessPersonSchema = new Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, default: '' },
    relation: { type: String, default: '' },
    idType: { type: String, default: '' }, // 'Emirates ID' | 'Passport' | ''
    idNumber: { type: String, default: '' },
  },
  { _id: false }
);

const customerSchema = new Schema(
  {
    fullName: { type: String, required: true },
    clientId: { type: String, default: '' },       // e.g. PB-1002
    tenantType: { type: String, enum: ['individual', 'company'], default: 'individual' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },       // primary (legacy)
    phones: [{ type: String }],                  // all phone numbers
    emergencyNumber: { type: String, default: '' },
    nationality: { type: String, default: '' },
    address: { type: String, default: '' },
    company: { type: String, default: '' },
    emiratesId: { type: String, default: '' },
    eidExpiry: { type: Date },
    passportNumber: { type: String, default: '' },
    passportExpiry: { type: Date },
    accessPersons: [accessPersonSchema],
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const leadSchema = new Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, default: '' },
    phone: { type: String, required: true },
    phoneNormalized: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost'],
      default: 'new',
    },
    source: {
      type: String,
      enum: ['manual', 'google_contacts', 'whatsapp', 'referral', 'walk_in', 'other'],
      default: 'manual',
    },
    leadDateTime: { type: Date, default: Date.now },
    storageSizeValue: { type: Number, required: true, min: 0 },
    storageSizeUnit: { type: String, enum: ['sqft'], default: 'sqft' },
    durationValue: { type: Number, required: true, min: 1 },
    durationUnit: { type: String, enum: ['week', 'month'], required: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    unitsNeeded: { type: Number, required: true, min: 1 },
    notes: { type: String, default: '' },
    timeline: [
      {
        at: { type: Date, default: Date.now },
        type: { type: String, default: 'note' },
        text: { type: String, default: '' },
      },
    ],
  },
  { timestamps: true }
);

leadSchema.index({ status: 1, owner: 1, leadDateTime: -1 });
leadSchema.index({ source: 1, createdAt: -1 });

const whatsappWebhookEventSchema = new Schema(
  {
    eventKey: { type: String, required: true, unique: true },
    phoneNormalized: { type: String, default: '' },
    labels: { type: [String], default: [] },
    status: { type: String, enum: ['received', 'processed', 'skipped', 'failed'], default: 'received' },
    detail: { type: String, default: '' },
    payload: { type: Schema.Types.Mixed },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    },
  },
  { timestamps: true }
);

whatsappWebhookEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
whatsappWebhookEventSchema.index({ phoneNormalized: 1, createdAt: -1 });

const whatsappLabelStateSchema = new Schema(
  {
    phone: { type: String, default: '' },
    phoneNormalized: { type: String, required: true, unique: true },
    labels: { type: [String], default: [] },
    mappedStatus: {
      type: String,
      enum: ['', 'new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost'],
      default: '',
    },
    lastEventKey: { type: String, default: '' },
    lastWebhookAt: { type: Date, default: Date.now },
    lastReconciledAt: { type: Date },
  },
  { timestamps: true }
);

whatsappLabelStateSchema.index({ mappedStatus: 1, updatedAt: -1 });

const whatsappMessageSchema = new Schema(
  {
    messageId: { type: String, default: '' },
    phone: { type: String, default: '' },
    phoneNormalized: { type: String, required: true },
    lead: { type: Schema.Types.ObjectId, ref: 'Lead' },
    direction: { type: String, enum: ['inbound', 'outbound'], default: 'inbound' },
    type: { type: String, default: 'text' },
    text: { type: String, default: '' },
    status: { type: String, default: '' },
    occurredAt: { type: Date, default: Date.now },
    raw: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

whatsappMessageSchema.index({ phoneNormalized: 1, occurredAt: -1 });
whatsappMessageSchema.index({ messageId: 1 }, { unique: true, sparse: true });

const contractSchema = new Schema(
  {
    contractNo: { type: String, required: true, unique: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    unit: { type: Schema.Types.ObjectId, ref: 'Unit', required: true },
    units: [{ type: Schema.Types.ObjectId, ref: 'Unit' }],
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
    paymentMethod: { type: String, default: '' },
    firstPaymentDate: { type: Date },
    nextPaymentDate: { type: Date },
    source: { type: String, enum: ['manual', 'import_json'], default: 'manual' },
    externalId: { type: String, default: null },
    importedAt: { type: Date },
    raw: { type: Schema.Types.Mixed },
    notes: { type: String, default: '' },
    firstMonthDiscountPct: { type: Number, default: 0 },
    authorizedPersons: [accessPersonSchema],
    signingToken: { type: String, default: null },
    signingTokenExpiry: { type: Date, default: null },
    timeline: [
      {
        at: { type: Date, default: Date.now },
        text: { type: String, default: '' },
        author: { type: String, default: '' },
      },
    ],
  },
  { timestamps: true }
);

contractSchema.index(
  { externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string', $gt: '' } } }
);

const quoteItemSchema = new Schema(
  {
    sortOrder: { type: Number, default: 0 },
    itemDetails: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    rate: { type: Number, required: true, min: 0 },
    discountPct: { type: Number, default: 0, min: 0, max: 100 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const quoteSchema = new Schema(
  {
    quoteNo: { type: String, required: true, unique: true },
    quoteDate: { type: Date, required: true, default: Date.now },
    creationDate: { type: Date, required: true, default: Date.now },
    salesperson: { type: String, default: '' },
    expiryDate: { type: Date, required: true },
    pdfTemplate: { type: String, default: 'Standard Template' },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    billingAddress: { type: String, default: '' },
    shippingAddress: { type: String, default: '' },
    subject: { type: String, default: '' },
    items: { type: [quoteItemSchema], default: [] },
    subTotal: { type: Number, default: 0, min: 0 },
    adjustment: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'sent', 'accepted', 'rejected', 'expired'], default: 'draft' },
  },
  { timestamps: true }
);

const invoiceItemSchema = new Schema(
  {
    sortOrder: { type: Number, default: 0 },
    itemDetails: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    rate: { type: Number, required: true, min: 0 },
    discountPct: { type: Number, default: 0, min: 0, max: 100 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const invoicePaymentEntrySchema = new Schema(
  {
    date: { type: Date, default: Date.now },
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, enum: ['cash', 'bank_transfer', 'card', 'cheque', 'other'], default: 'cash' },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const invoiceAttachmentSchema = new Schema(
  {
    name: { type: String, required: true },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
    storage: { type: String, enum: ['drive', 'local'], default: 'local' },
    driveFileId: { type: String, default: '' },
    url: { type: String, default: '' },
  },
  { _id: false }
);

const invoiceSchema = new Schema(
  {
    invoiceNo: { type: String, required: true, unique: true },
    orderNumber: { type: String, default: '' },
    invoiceDate: { type: Date, required: true, default: Date.now },
    terms: { type: String, default: '' },
    dueDate: { type: Date, required: true },
    salesperson: { type: String, default: '' },
    bankInformation: { type: String, default: '' },
    subject: { type: String, default: '' },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    items: { type: [invoiceItemSchema], default: [] },
    customerNotes: { type: String, default: '' },
    subTotal: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0 },
    paymentMade: { type: Number, default: 0 },
    paymentHistory: { type: [invoicePaymentEntrySchema], default: [] },
    termsAndConditions: { type: String, default: '' },
    attachments: { type: [invoiceAttachmentSchema], default: [] },
    status: { type: String, enum: ['draft', 'sent', 'paid', 'overdue', 'cancelled'], default: 'draft' },
    shareToken: { type: String, default: null },
  },
  { timestamps: true }
);

const vendorSchema = new Schema(
  {
    vendorCode: { type: String, default: '' },
    contactId: { type: String, required: true, unique: true },
    contactName: { type: String, required: true },
    companyName: { type: String, default: '' },
    displayName: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    mobilePhone: { type: String, default: '' },
    currencyCode: { type: String, default: 'AED' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    notes: { type: String, default: '' },
    website: { type: String, default: '' },
    paymentTermsLabel: { type: String, default: '' },
    paymentTerms: { type: Number, default: 0 },
    openingBalance: { type: Number, default: 0 },
    ownerName: { type: String, default: '' },
    source: { type: String, default: '' },
    categories: { type: [String], default: [] },
    billingAddress: {
      attention: { type: String, default: '' },
      address: { type: String, default: '' },
      street2: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      country: { type: String, default: '' },
      code: { type: String, default: '' },
      phone: { type: String, default: '' },
      fax: { type: String, default: '' },
    },
    shippingAddress: {
      attention: { type: String, default: '' },
      address: { type: String, default: '' },
      street2: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      country: { type: String, default: '' },
      code: { type: String, default: '' },
      phone: { type: String, default: '' },
      fax: { type: String, default: '' },
    },
    importedAt: { type: Date },
    raw: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

vendorSchema.index({ contactName: 1 });
vendorSchema.index({ companyName: 1 });

const purchaseItemSchema = new Schema(
  {
    sortOrder: { type: Number, default: 0 },
    itemDetails: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    rate: { type: Number, required: true, min: 0 },
    discountPct: { type: Number, default: 0, min: 0, max: 100 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const purchaseAttachmentSchema = new Schema(
  {
    name: { type: String, required: true },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
    storage: { type: String, enum: ['drive', 'local'], default: 'local' },
    driveFileId: { type: String, default: '' },
    url: { type: String, default: '' },
  },
  { _id: false }
);

const purchaseSchema = new Schema(
  {
    purchaseNo: { type: String, required: true, unique: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    orderNumber: { type: String, default: '' },
    purchaseDate: { type: Date, required: true, default: Date.now },
    terms: { type: String, default: '' },
    dueDate: { type: Date, required: true },
    purchaser: { type: String, default: '' },
    bankInformation: { type: String, default: '' },
    subject: { type: String, default: '' },
    items: { type: [purchaseItemSchema], default: [] },
    vendorNotes: { type: String, default: '' },
    subTotal: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0 },
    termsAndConditions: { type: String, default: '' },
    attachments: { type: [purchaseAttachmentSchema], default: [] },
    paymentMade: { type: Number, default: 0 },
    paymentHistory: { type: [invoicePaymentEntrySchema], default: [] },
    status: { type: String, enum: ['draft', 'sent', 'received', 'partial', 'cancelled'], default: 'draft' },
  },
  { timestamps: true }
);

const expenseSchema = new Schema(
  {
    expenseDate: { type: Date, required: true, default: Date.now },
    expenseType: { type: String, default: '' },
    description: { type: String, default: '' },
    expenseAccount: { type: String, default: '' },
    expenseAccountCode: { type: String, default: '' },
    paidThrough: { type: String, default: '' },
    paidThroughAccountCode: { type: String, default: '' },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    vendorName: { type: String, default: '' },
    projectName: { type: String, default: '' },
    entryNumber: { type: Number, default: 0 },
    currencyCode: { type: String, default: 'AED' },
    exchangeRate: { type: Number, default: 1 },
    isInclusiveTax: { type: Boolean, default: false },
    mileageRate: { type: Number, default: 0 },
    mileageUnit: { type: String, default: '' },
    distance: { type: Number, default: 0 },
    startOdometerReading: { type: Number, default: 0 },
    endOdometerReading: { type: Number, default: 0 },
    mileageType: { type: String, default: '' },
    vehicleName: { type: String, default: '' },
    claimantEmail: { type: String, default: '' },
    taxName: { type: String, default: '' },
    taxPercentage: { type: Number, default: 0 },
    taxType: { type: String, default: '' },
    taxAmount: { type: Number, default: 0 },
    expenseAmount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    referenceNo: { type: String, default: '' },
    isBillable: { type: Boolean, default: false },
    customerName: { type: String, default: '' },
    expenseReferenceId: { type: String, default: '' },
    recurrenceName: { type: String, default: '' },
    expenseReportName: { type: String, default: '' },
    isReimbursable: { type: Boolean, default: false },
    categories: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['recorded', 'approved', 'paid', 'reimbursed', 'cancelled'],
      default: 'recorded',
    },
    source: { type: String, enum: ['manual', 'import_csv'], default: 'manual' },
    importedAt: { type: Date },
    raw: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

expenseSchema.index({ expenseDate: -1, createdAt: -1 });
expenseSchema.index({ vendor: 1, expenseDate: -1 });
expenseSchema.index({ expenseAccount: 1, expenseDate: -1 });
expenseSchema.index({ status: 1, expenseDate: -1 });
expenseSchema.index({ expenseReferenceId: 1 }, { unique: true, sparse: true });

const paymentSchema = new Schema(
  {
    contract: { type: Schema.Types.ObjectId, ref: 'Contract', required: true },
    invoice: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    amount: { type: Number, required: true },
    dueDate: { type: Date, required: true },
    paidDate: { type: Date },
    method: { type: String, enum: ['cash', 'bank_transfer', 'card', 'other', ''], default: '' },
    status: { type: String, enum: ['pending', 'paid', 'overdue'], default: 'pending' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const movingItemSchema = new Schema(
  {
    sku: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    category: { type: String, default: 'box' },
    sizeLabel: { type: String, default: '' },
    lengthCm: { type: Number, default: null },
    widthCm: { type: Number, default: null },
    heightCm: { type: Number, default: null },
    unit: { type: String, enum: ['pcs', 'packs', 'rolls', 'sets', 'other'], default: 'pcs' },
    onHand: { type: Number, default: 0 },
    reorderLevel: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const movingStockTxnSchema = new Schema(
  {
    item: { type: Schema.Types.ObjectId, ref: 'MovingItem', required: true },
    txnType: { type: String, enum: ['in', 'out', 'adjustment', 'transfer', 'return'], required: true },
    qty: { type: Number, required: true },
    previousOnHand: { type: Number, default: 0 },
    resultingOnHand: { type: Number, default: 0 },
    unitCost: { type: Number, default: 0 },
    reason: { type: String, default: '' },
    takenBy: { type: String, default: '' },
    contract: { type: Schema.Types.ObjectId, ref: 'Contract' },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    txnDate: { type: Date, default: Date.now },
    notes: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

movingItemSchema.index({ name: 1, sizeLabel: 1 });
movingItemSchema.index({ active: 1, onHand: 1 });
movingStockTxnSchema.index({ item: 1, txnDate: -1 });
movingStockTxnSchema.index({ contract: 1, txnDate: -1 });
movingStockTxnSchema.index({ customer: 1, txnDate: -1 });

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
export const Lead = model('Lead', leadSchema);
export const WhatsAppWebhookEvent = model('WhatsAppWebhookEvent', whatsappWebhookEventSchema);
export const WhatsAppLabelState = model('WhatsAppLabelState', whatsappLabelStateSchema);
export const WhatsAppMessage = model('WhatsAppMessage', whatsappMessageSchema);
export const Contract = model('Contract', contractSchema);
export const Quote = model('Quote', quoteSchema);
export const Invoice = model('Invoice', invoiceSchema);
export const Vendor = model('Vendor', vendorSchema);
export const Purchase = model('Purchase', purchaseSchema);
export const Expense = model('Expense', expenseSchema);
export const Payment = model('Payment', paymentSchema);
export const MovingItem = model('MovingItem', movingItemSchema);
export const MovingStockTxn = model('MovingStockTxn', movingStockTxnSchema);
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

export async function nextQuoteNo() {
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate(
    { key: `quote-${year}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `QT-${String(counter.seq).padStart(6, '0')}`;
}

export async function nextInvoiceNo() {
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate(
    { key: `invoice-${year}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `INV-${String(counter.seq).padStart(6, '0')}`;
}

export async function nextPurchaseNo() {
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate(
    { key: `purchase-${year}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `PO-${year}-${String(counter.seq).padStart(4, '0')}`;
}
