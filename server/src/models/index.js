import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const ALL_MODULES = [
  'dashboard', 'units', 'moving_inventory', 'contracts', 'documents',
  'customers', 'quotes', 'invoices', 'vendors', 'expenses',
  'leads', 'purchases', 'payments',
  // The WhatsApp console. Historically reached through 'leads', which is why
  // the nav still accepts either — granting this must not be the only way in
  // for someone who already had it.
  'whatsapp',
  'reports_monthly', 'reports_units', 'reports_finances', 'reports_forecast', 'reports_contracts',
  'reports_vacancies', 'reports_overdue', 'reports_expiring', 'reports_conversations',
  'settings',
  // Moving business
  'moving_dashboard', 'moving_leads', 'moving_jobs', 'moving_workers',
  'moving_fleet', 'moving_schedule', 'moving_dispatch',
  'moving_quotes', 'moving_invoices',
  'reports_moving_revenue', 'reports_moving_jobs', 'reports_moving_crew', 'reports_moving_fleet',
  'reports_moving_profitability', 'reports_moving_payroll',
  'reports_moving_ar', 'reports_moving_costs', 'reports_moving_pipeline', 'reports_moving_stripe',
  'moving_claims',
  // Sales reps' personal "My Leads" board — leads/moving_leads scoped to the logged-in rep.
  'sales_board',
];

const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    // 'accounts' is a second sales-rep-equivalent role: identical access and
    // data scope, kept separate only so the two teams can be told apart.
    role: { type: String, enum: ['admin', 'staff', 'sales_rep', 'accounts'], default: 'staff' },
    // Modules this user can access. Admins bypass this check entirely.
    permissions: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    resetToken: { type: String, default: null },
    resetTokenExpiry: { type: Date, default: null },
    // Guided walkthroughs. `enabled` defaults true so a new user gets them
    // without anything being written for them first, which is what "on for any
    // new user" has to mean. An id absent from `completed` means not yet seen.
    walkthroughs: {
      enabled: { type: Boolean, default: true },
      completed: { type: [String], default: [] },
    },
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
    site: { type: Schema.Types.ObjectId, ref: 'Site', default: null }, // null = default site
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
    shared: { type: Boolean, default: false },
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
    // Bulk emails this customer was included in. Kept separate from `notes`,
    // which is hand-written free text.
    emailLog: [{
      subject: { type: String, default: '' },
      at: { type: Date, default: Date.now },
      sentBy: { type: String, default: '' },
    }],
    source: { type: String, enum: ['manual', 'import_csv', 'google'], default: 'manual' },
    importBatch: { type: String, default: null },
    googleId: { type: String, default: '' },
    // Excluded from marketing campaigns. Never consulted for transactional mail
    // — an invoice or a contract still has to reach them.
    unsubscribed: { type: Boolean, default: false },
    // Meta requires a recorded opt-in before a MARKETING template may be sent.
    // Separate from `unsubscribed`, which is about email: agreeing to one
    // channel is not agreeing to the other.
    whatsappOptIn: {
      at: { type: Date, default: null },
      source: { type: String, default: '' },   // form | inbound_message | manual
    },
  },
  { timestamps: true }
);

const leadCommentSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  userName: { type: String, default: '' },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

/* How somebody was reached, and what came back.
 *
 * Every other channel enum here is whatsapp/email, because everything else is
 * something the system sends. These are things a person did, so a phone call
 * and a voice note are first-class — a call was previously unrecordable except
 * as free text in a note.
 */
export const ATTEMPT_CHANNELS = ['call', 'whatsapp', 'voice_note', 'email', 'sms', 'walk_in', 'other'];
export const ATTEMPT_OUTCOMES = ['no_answer', 'no_reply', 'reached', 'call_back', 'not_interested', 'wrong_number'];

/* One attempt to reach a lead.
 *
 * Kept in its own array rather than in the timeline: pushTimeline caps that at
 * 200 entries, so a long-running chase would silently lose its own history.
 *
 * `no` is stored rather than derived from the index, so that removing an entry
 * one day cannot renumber everything after it. Attempts are a record of what
 * happened — they are appended and not edited.
 */
const leadAttemptSchema = new Schema({
  no: { type: Number, required: true },
  at: { type: Date, default: Date.now },
  channel: { type: String, enum: ATTEMPT_CHANNELS, default: 'call' },
  outcome: { type: String, enum: ATTEMPT_OUTCOMES, required: true },
  note: { type: String, default: '' },
  user: { type: Schema.Types.ObjectId, ref: 'User' },
}, { _id: false });

const leadSchema = new Schema(
  {
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    fullName: { type: String, required: true },
    email: { type: String, default: '' },
    phone: { type: String, required: true },
    whatsappNo: { type: String, default: '' },
    phoneNormalized: { type: String, required: true, unique: true },
    preferredContact: { type: String, enum: ['email', 'whatsapp'], default: 'whatsapp' },
    // Excluded from marketing campaigns; sales follow-up is unaffected.
    unsubscribed: { type: Boolean, default: false },
    // Meta requires a recorded opt-in before a MARKETING template may be sent.
    // Separate from `unsubscribed`, which is about email: agreeing to one
    // channel is not agreeing to the other.
    whatsappOptIn: {
      at: { type: Date, default: null },
      source: { type: String, default: '' },   // form | inbound_message | manual
    },
    status: {
      type: String,
      /* One primary status at a time — the CRM buckets.
         'won' and 'lost' keep their keys because the sales targets count them
         and renaming would silently zero everyone's figures. */
      enum: ['new', 'contact_attempted', 'contacted', 'site_visit_scheduled', 'follow_up_scheduled', 'quotation_sent', 'won', 'lost'],
      default: 'new',
    },
    /* How warm they are, kept apart from the status.
       A lead can be Follow-Up Scheduled and hot, or Contacted and cold — one
       says where they are in the process, the other how likely they are to
       buy, and collapsing them loses whichever you did not pick. */
    temperature: { type: String, enum: ['', 'hot', 'warm', 'cold'], default: '' },
    /* Extra facts that do not replace the status: what they want, how urgent,
       whether they have gone quiet. */
    tags: { type: [String], default: [] },
    /* The name they have set on their own WhatsApp profile.
     *
     * Kept apart from fullName, which is what somebody here decided to call
     * them. This is theirs, it can change whenever they change it, and it is
     * only ever a fallback for display — but it beats "WhatsApp Contact 7057"
     * for every chat nobody has got round to saving. */
    whatsappProfileName: { type: String, default: '' },

    /* What makes Follow-Up Scheduled actionable rather than a note to self. */
    followUpAt: { type: Date, default: null },
    /* How precisely the date was meant. "Call them in March" is a real answer
       from a client, and pinning it to an invented day in March either fires
       too early or too late. A week fires on its Monday, a month on its 1st. */
    followUpKind: { type: String, enum: ['date', 'week', 'month'], default: 'date' },
    /* Stamped when the reminder went out, so it goes out once. Cleared
       whenever the follow-up is moved, which makes the new date fire. */
    followUpNotifiedAt: { type: Date, default: null },
    /* The task standing for this follow-up. Held so that moving the date moves
       the task rather than leaving the old one behind and adding another. */
    followUpTaskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    /* When they are coming to see the place.

       Its own date rather than a reuse of followUpAt: a lead can be booked in
       for Thursday and still be chased next month, and collapsing the two
       would lose whichever was set second. Always an exact day — nobody
       arranges a viewing for "some time in March". */
    siteVisitAt: { type: Date, default: null },
    siteVisitTaskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },

    /* Every attempt made to reach them, oldest first. "Attempt 2 of 3" is this
       length against the plan's step count — counted, never marked, so it
       cannot disagree with what actually happened. */
    attempts: { type: [leadAttemptSchema], default: [] },
    /* Stamped when the last step of the plan was used and they still had not
       answered. What the "close this or give it one more" prompt reads off;
       cleared when somebody decides either way. */
    sequenceExhaustedAt: { type: Date, default: null },
    source: {
      type: String,
      enum: ['manual', 'whatsapp', 'referral', 'walk_in', 'other'],
      default: 'manual',
    },
    leadDateTime: { type: Date, default: Date.now },
    // When the owner first opened it. Null means it has landed on somebody who
    // has not looked at it yet — which is what the rep's board highlights.
    // Cleared whenever the lead is reassigned, because it is new to the person
    // receiving it however old the record is.
    ownerSeenAt: { type: Date, default: null },
    /* 0 means "not asked yet" rather than a unit of no size. It is set when
       somebody actually speaks to the lead, at the Contacted stage — before
       that a number here is a guess wearing the clothes of a requirement. */
    storageSizeValue: { type: Number, default: 0, min: 0 },
    storageSizeUnit: { type: String, enum: ['sqft'], default: 'sqft' },
    durationValue: { type: Number, default: 1, min: 1 },
    durationUnit: { type: String, enum: ['week', 'month'], default: 'month' },
    owner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    unitsNeeded: { type: Number, required: true, min: 1 },
    notes: { type: String, default: '' },
    labels: { type: [String], default: [] },
    comments: [leadCommentSchema],
    timeline: [
      {
        at: { type: Date, default: Date.now },
        type: { type: String, default: 'note' },
        text: { type: String, default: '' },
        user: { type: Schema.Types.ObjectId, ref: 'User' },
      },
    ],
  },
  { timestamps: true }
);

leadSchema.index({ leadDateTime: -1, createdAt: -1 });
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
      enum: ['', 'new', 'contact_attempted', 'contacted', 'site_visit_scheduled', 'follow_up_scheduled', 'quotation_sent', 'won', 'lost'],
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
    // Written by the assistant rather than a colleague. The console labels
    // these, so a customer's reply is never mistaken for a human's work.
    sentByAi: { type: Boolean, default: false },
    // WhatsApp lets people edit, delete and react to a message after sending
    // it. Each arrives as its own webhook naming the message it changes, so
    // they are recorded here rather than stored as bubbles of their own.
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    reaction: { type: String, default: '' },
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
    // Per-unit ledger rows for the contract's Units tab. Every field is an
    // optional override: an absent line, or a null field on a line, means
    // "use the contract-level value". Deliberately NOT written back into
    // rate/leasedPrice/manualReceived — the Units tab surfaces the roll-up
    // against the contract totals instead of silently overwriting them.
    unitLines: [
      {
        unit: { type: Schema.Types.ObjectId, ref: 'Unit' },
        checkIn: { type: Date, default: null },
        checkOut: { type: Date, default: null },
        leaseRate: { type: Number, default: null },
        received: { type: Number, default: null },
        pending: { type: Number, default: null },
        _id: false,
      },
    ],
    billingPeriod: { type: String, enum: ['weekly', 'monthly'], required: true },
    rate: { type: Number, required: true },
    deposit: { type: Number, default: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ['draft', 'pending_signature', 'active', 'ended', 'cancelled'],
      default: 'draft',
    },
    zohoRequestId: { type: String, default: '' },
    signedDocUrl: { type: String, default: '' },
    // The agreement wording for this contract, editable per contract. Empty
    // means "use the saved agreement template". Stored with placeholders
    // already resolved so what you read is exactly what the PDF prints.
    agreementText: { type: String, default: '' },
    paymentMethod: { type: String, default: '' },
    firstPaymentDate: { type: Date },
    nextPaymentDate: { type: Date },
    quote: { type: Schema.Types.ObjectId, ref: 'Quote' },
    // Rep credited with this deal — derived from the source quote's
    // assignedTo when converting a quote, or the creator otherwise. Lets
    // revenue eventually be attributed per rep, not just lead counts.
    salesRep: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Admin approval gate — quote-sourced contracts require admin approval before booking.
    approvalStatus: {
      type: String,
      enum: ['not_required', 'pending', 'approved', 'rejected'],
      default: 'not_required',
    },
    approvalNote: { type: String, default: '' },
    approvedBy: { type: String, default: '' },
    approvedAt: { type: Date },
    source: { type: String, enum: ['manual', 'import_json', 'quote'], default: 'manual' },
    externalId: { type: String, default: null },
    importedAt: { type: Date },
    raw: { type: Schema.Types.Mixed },
    notes: { type: String, default: '' },
    firstMonthDiscountPct: { type: Number, default: 0 },
    // null = derive from rate/discount; 0 is a deliberate value
    leasedPrice: { type: Number, default: null },
    authorizedPersons: [accessPersonSchema],
    signingToken: { type: String, default: null },
    signingTokenExpiry: { type: Date, default: null },
    // null = never set (filled from the linked quote); 0 is a deliberate value
    totalQuotation: { type: Number, default: null },
    // null = derive Received from payment records; any number (incl. 0) is a manual override
    manualReceived: { type: Number, default: null },
    // Per-contract reminder settings. Defaults come from Settings → Automation;
    // an override entry pins one rule on/off for this contract only.
    // '' = derive from the units (any shared unit → Shared)
    accessType: { type: String, enum: ['', 'private', 'shared'], default: '' },
    // Reminders are opt-in: new contracts start muted, enable per contract
    // from its Reminders tab
    remindersMuted: { type: Boolean, default: true },
    reminderOverrides: [
      {
        rule: { type: Schema.Types.ObjectId, ref: 'AutomationRule' },
        enabled: { type: Boolean, default: true },
        _id: false,
      },
    ],
    // Whether the tenant intends to renew when this term ends — set from
    // the contract sidebar, drives whether staff chase renewal vs. move-out.
    renewalIntent: { type: String, enum: ['undecided', 'renewing', 'not_renewing'], default: 'undecided' },
    // One entry per Check Out change on an already-existing contract — a
    // dedicated, filterable record of every renewal/extension, separate
    // from the general edit timeline below.
    renewalHistory: [
      {
        at: { type: Date, default: Date.now },
        previousEndDate: { type: Date },
        newEndDate: { type: Date },
        author: { type: String, default: '' },
        _id: false,
      },
    ],
    archived: { type: Boolean, default: false },
    timeline: [
      {
        at: { type: Date, default: Date.now },
        text: { type: String, default: '' },
        author: { type: String, default: '' },
        // Pinned notes float to the top of the contract's activity feed, so a
        // standing instruction isn't buried under routine document/edit rows.
        pinned: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true }
);

contractSchema.index(
  { externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string', $gt: '' } } }
);
// Hot lookups: contract lists, unit-conflict checks and customer history
contractSchema.index({ archived: 1, createdAt: -1 });
contractSchema.index({ unit: 1, status: 1 });
contractSchema.index({ units: 1, status: 1 });
contractSchema.index({ customer: 1, createdAt: -1 });
contractSchema.index({ status: 1, endDate: 1 });
contractSchema.index({ approvalStatus: 1, updatedAt: -1 });

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

const quoteUnitSchema = new Schema(
  {
    unit: { type: Schema.Types.ObjectId, ref: 'Unit', required: true },
    unitNumber: { type: String, default: '' },
    sizeSqf: { type: Number, default: 0 },
    floor: { type: String, default: '' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    rate: { type: Number, default: 0 },
    discountPct: { type: Number, default: 0, min: 0, max: 100 },
    amount: { type: Number, default: 0 },
  },
  { _id: false }
);

const quoteAddOnSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    quantity: { type: Number, default: 1, min: 1 },
    rate: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
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
    lead: { type: Schema.Types.ObjectId, ref: 'Lead' },
    billingPeriod: { type: String, enum: ['weekly', 'monthly'], default: 'monthly' },
    billingAddress: { type: String, default: '' },
    shippingAddress: { type: String, default: '' },
    subject: { type: String, default: '' },
    items: { type: [quoteItemSchema], default: [] },
    units: { type: [quoteUnitSchema], default: [] },
    addOns: { type: [quoteAddOnSchema], default: [] },
    deposit: { type: Number, default: 0 },
    // Whether the refundable advance is collected upfront on this quote
    holdAdvance: { type: Boolean, default: true },
    subTotal: { type: Number, default: 0, min: 0 },
    adjustment: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'sent', 'accepted', 'rejected', 'expired'], default: 'draft' },
    shareToken: { type: String, default: null },
    contract: { type: Schema.Types.ObjectId, ref: 'Contract' },
    flowStep: { type: Number, default: 0, min: 0, max: 5 },
    flowStepsDone: { type: [Boolean], default: [false, false, false, false, false, false] },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    timeline: [
      {
        at: { type: Date, default: Date.now },
        type: { type: String, default: 'note' },
        text: { type: String, default: '' },
        user: { type: Schema.Types.ObjectId, ref: 'User' },
      },
    ],
  },
  { timestamps: true }
);

const invoiceItemSchema = new Schema(
  {
    sortOrder: { type: Number, default: 0 },
    itemDetails: { type: String, required: true },
    description: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 0 },
    rate: { type: Number, required: true },
    discountPct: { type: Number, default: 0, min: 0, max: 100 },
    amount: { type: Number, required: true },
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
    createdBy: { type: String, default: '' },
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
    status: { type: String, enum: ['draft', 'sent', 'paid', 'partial', 'overdue', 'cancelled'], default: 'draft' },
    shareToken: { type: String, default: null },
    source: { type: String, enum: ['manual', 'import_csv'], default: 'manual' },
    importBatch: { type: String, default: null },
    // Zoho Books sync
    zohoBooksSyncId: { type: String, default: null },
    zohoBooksSyncedAt: { type: Date, default: null },
    zohoBooksSyncError: { type: String, default: null },
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
    discountType: { type: String, default: '' },
    discount: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    amount: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, default: 0 },
    account: { type: String, default: '' },
    accountCode: { type: String, default: '' },
    sku: { type: String, default: '' },
    isBillable: { type: Boolean, default: false },
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
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    vendorName: { type: String, default: '' },
    billId: { type: String, default: '' },
    orderNumber: { type: String, default: '' },
    purchaseDate: { type: Date, required: true, default: Date.now },
    terms: { type: String, default: '' },
    dueDate: { type: Date },
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
    categories: { type: [String], default: [] },
    source: { type: String, default: 'manual' },
    currencyCode: { type: String, default: 'AED' },
    exchangeRate: { type: Number, default: 1 },
    taxAmount: { type: Number, default: 0 },
    taxName: { type: String, default: '' },
    taxPercentage: { type: Number, default: 0 },
    taxType: { type: String, default: '' },
    adjustment: { type: Number, default: 0 },
    adjustmentDescription: { type: String, default: '' },
    billType: { type: String, default: '' },
    isInclusiveTax: { type: Boolean, default: false },
    entityDiscountPercent: { type: Number, default: 0 },
    entityDiscountAmount: { type: Number, default: 0 },
    customerName: { type: String, default: '' },
    projectName: { type: String, default: '' },
    purchaseOrderRef: { type: String, default: '' },
    submittedBy: { type: String, default: '' },
    approvedBy: { type: String, default: '' },
    submittedDate: { type: Date },
    approvedDate: { type: Date },
    tinNumber: { type: String, default: '' },
    legalName: { type: String, default: '' },
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
    attachments: { type: [purchaseAttachmentSchema], default: [] },
    importedAt: { type: Date },
    raw: { type: Schema.Types.Mixed },
    // Zoho Books sync
    zohoBooksSyncId: { type: String, default: null },
    zohoBooksSyncedAt: { type: Date, default: null },
    zohoBooksSyncError: { type: String, default: null },
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
    recordedBy: { type: String, default: '' },
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
    retailPrice: { type: Number, default: 0 },
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
    movingJob: { type: Schema.Types.ObjectId, ref: 'MovingJob' },
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
movingStockTxnSchema.index({ movingJob: 1, txnDate: -1 });

// ── Moving Business Schemas ──────────────────────────────────────────────────

const workerSchema = new Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    role: { type: String, enum: ['driver', 'helper', 'supervisor', 'packer'], default: 'helper' },
    dailyRate: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'inactive', 'on_leave'], default: 'active' },
    emergencyContact: { type: String, default: '' },
    notes: { type: String, default: '' },
    timeLog: [{
      type: { type: String, enum: ['clock_in', 'clock_out', 'break_start', 'break_end'] },
      time: { type: Date, default: Date.now },
    }],
  },
  { timestamps: true }
);
workerSchema.index({ status: 1, name: 1 });

const truckSchema = new Schema(
  {
    name: { type: String, required: true },
    plateNumber: { type: String, default: '' },
    type: { type: String, enum: ['small', 'medium', 'large', 'extra_large'], default: 'medium' },
    capacityCbm: { type: Number, default: 0 },
    dailyRate: { type: Number, default: 0 },
    status: { type: String, enum: ['available', 'in_use', 'maintenance'], default: 'available' },
    lastServiceDate: { type: Date },
    nextServiceDate: { type: Date },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);
truckSchema.index({ status: 1 });

const movingTimelineEntrySchema = new Schema(
  { at: { type: Date, default: Date.now }, text: { type: String, default: '' }, author: { type: String, default: '' } },
  { _id: false }
);

const movingJobImageSchema = new Schema({
  url: { type: String },
  filename: { type: String },
  originalName: { type: String },
  size: { type: Number },
  category: { type: String, default: '' },
  storage: { type: String, enum: ['local', 'drive'], default: 'local' },
  driveFileId: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now },
});

const movingLeadSchema = new Schema(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    prospectName: { type: String, default: '' },
    prospectPhone: { type: String, default: '' },
    prospectEmail: { type: String, default: '' },
    source: { type: String, enum: ['phone', 'web_form', 'mobile_app', 'whatsapp', 'referral', 'walk_in', 'other'], default: 'phone' },
    status: { type: String, enum: ['new', 'contacted', 'quoted', 'client_approved', 'won', 'lost'], default: 'new' },
    moveDate: { type: Date },
    pickupAddress: { type: String, default: '' },
    deliveryAddress: { type: String, default: '' },
    estimatedVolumeCbm: { type: Number, default: 0 },
    serviceType: { type: String, default: '' },
    propertyType: { type: String, default: '' },
    notes: { type: String, default: '' },
    images: [movingJobImageSchema],
    quotation: {
      items: [{
        description: { type: String, default: '' },
        qty: { type: Number, default: 1 },
        rate: { type: Number, default: 0 },
        amount: { type: Number, default: 0 },
      }],
      subTotal: { type: Number, default: 0 },
      discount: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      notes: { type: String, default: '' },
      quotedAt: { type: Date },
      quotedBy: { type: String, default: '' },
    },
    timeline: [movingTimelineEntrySchema],
    owner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);
movingLeadSchema.index({ status: 1, createdAt: -1 });
movingLeadSchema.index({ customer: 1 });
movingLeadSchema.index({ status: 1, owner: 1 });

const movingJobCrewSchema = new Schema(
  {
    worker: { type: Schema.Types.ObjectId, ref: 'Worker', required: true },
    role: { type: String, default: '' },
    dailyRate: { type: Number, default: 0 },
    days: { type: Number, default: 1 },
    extraHours: { type: Number, default: 0 },
    extraHourRate: { type: Number, default: 0 },
    isSupervisor: { type: Boolean, default: false },
  },
  { _id: false }
);

const movingJobExternalHireSchema = new Schema(
  {
    title: { type: String, required: true },
    name: { type: String, default: '' },
    duration: { type: String, enum: ['quarter_day', 'half_day', 'full_day', 'custom'], default: 'full_day' },
    hours: { type: Number, default: 8 },
    rate: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const movingJobTruckSchema = new Schema(
  {
    truck: { type: Schema.Types.ObjectId, ref: 'Truck', required: true },
    dailyRate: { type: Number, default: 0 },
    days: { type: Number, default: 1 },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const movingJobExtraSchema = new Schema(
  {
    description: { type: String, required: true },
    amount: { type: Number, default: 0 },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const movingMaterialUsageSchema = new Schema(
  {
    item: { type: Schema.Types.ObjectId, ref: 'MovingItem', required: true },
    qty: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, default: 0 },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const movingJobSchema = new Schema(
  {
    jobNo: { type: String, required: true, unique: true },
    // Free-text job name shown alongside the job number
    title: { type: String, default: '' },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    lead: { type: Schema.Types.ObjectId, ref: 'MovingLead' },
    status: {
      type: String,
      enum: ['draft', 'confirmed', 'in_progress', 'survey_done', 'completed', 'invoiced', 'cancelled'],
      default: 'draft',
    },
    jobType: {
      type: String,
      enum: ['local', 'inter_emirate', 'international', 'office', 'storage_to_home', 'other'],
      default: 'local',
    },
    pickupAddress: { type: String, default: '' },
    pickupFloor: { type: String, default: '' },
    pickupHasElevator: { type: Boolean, default: false },
    deliveryAddress: { type: String, default: '' },
    deliveryFloor: { type: String, default: '' },
    deliveryHasElevator: { type: Boolean, default: false },
    scheduledDate: { type: Date },
    scheduledTimeSlot: { type: String, default: '' },
    estimatedDurationHours: { type: Number, default: 0 },
    moveOutPermitRequired: { type: Boolean, default: false },
    crew: [movingJobCrewSchema],
    trucks: [movingJobTruckSchema],
    teamLead: { type: Schema.Types.ObjectId, ref: 'Worker' },
    materialUsage: [movingMaterialUsageSchema],
    externalHires: [movingJobExternalHireSchema],
    extraCharges: [movingJobExtraSchema],
    costs: {
      labor: { type: Number, default: 0 },
      truck: { type: Number, default: 0 },
      materials: { type: Number, default: 0 },
      packing: { type: Number, default: 0 },
      extras: { type: Number, default: 0 },
      externalHires: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    survey: { type: Schema.Types.ObjectId, ref: 'MovingSurvey' },
    quote: { type: Schema.Types.ObjectId, ref: 'MovingQuote' },
    invoice: { type: Schema.Types.ObjectId, ref: 'MovingInvoice' },
    dispatchNotes: { type: String, default: '' },
    routeNotes: { type: String, default: '' },
    notes: { type: String, default: '' },
    timeline: [movingTimelineEntrySchema],
    images: [movingJobImageSchema],
    fieldPriceOverride: {
      amount: { type: Number, default: null },
      notes: { type: String, default: '' },
      supervisorName: { type: String, default: '' },
      adjustedAt: { type: Date },
    },
    clientPackage: {
      packageType: { type: String, default: '' },   // e.g. '2_bhk'
      label: { type: String, default: '' },         // e.g. '2 BHK'
      agreedPrice: { type: Number, default: 0 },    // what we charge the client
      additionalCharges: [{                         // add-ons agreed at booking
        description: { type: String },
        amount: { type: Number, default: 0 },
      }],
      notes: { type: String, default: '' },
    },
    checklist: [{
      label: { type: String },
      done: { type: Boolean, default: false },
    }],
    completionPhotos: [{
      url: { type: String },
      area: { type: String, default: 'General' },
      uploadedAt: { type: Date, default: Date.now },
      uploadedBy: { type: Schema.Types.ObjectId, ref: 'Worker' },
    }],
    clientVisits: [{
      visitDate: { type: Date },
      notes: { type: String, default: '' },
      images: [movingJobImageSchema],
      createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
      createdByName: { type: String, default: '' },
      createdAt: { type: Date, default: Date.now },
    }],
    uploadToken: { type: String, default: null },
    shareToken: { type: String, default: null },
    agreementText: { type: String, default: '' },
    signingToken: { type: String, default: null },
    signingTokenExpiry: { type: Date, default: null },
    signedDocUrl: { type: String, default: '' },
  },
  { timestamps: true }
);
movingJobSchema.index({ status: 1, scheduledDate: -1 });
movingJobSchema.index({ customer: 1, scheduledDate: -1 });
movingJobSchema.index({ scheduledDate: 1 });

const movingQuoteItemSchema = new Schema(
  {
    description: { type: String, default: '' },
    subDescription: { type: String, default: '' },
    qty: { type: Number, default: 1 },
    rate: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
  },
  { _id: false }
);

const movingQuoteSchema = new Schema(
  {
    quoteNo: { type: String, required: true, unique: true },
    job: { type: Schema.Types.ObjectId, ref: 'MovingJob' },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    status: { type: String, enum: ['draft', 'sent', 'accepted', 'rejected', 'expired'], default: 'draft' },
    quoteDate: { type: Date, default: Date.now },
    expiryDate: { type: Date, default: () => { const d = new Date(); d.setDate(d.getDate() + 1); return d; } },
    items: [movingQuoteItemSchema],
    subTotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    depositRequired: { type: Boolean, default: false },
    depositPct: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    termsAndConditions: { type: String, default: '' },
    salesperson: { type: String, default: '' },
    shareToken: { type: String, default: null },
  },
  { timestamps: true }
);
movingQuoteSchema.index({ customer: 1, createdAt: -1 });
movingQuoteSchema.index({ status: 1 });

const movingInvoicePaymentSchema = new Schema(
  {
    date: { type: Date, default: Date.now },
    amount: { type: Number, required: true },
    method: { type: String, enum: ['cash', 'bank_transfer', 'card', 'online', 'other'], default: 'cash' },
    notes: { type: String, default: '' },
    receivedBy: { type: String, default: '' },
  },
  { _id: false }
);

const movingInvoiceAttachmentSchema = new Schema(
  {
    name: { type: String, default: '' },
    url: { type: String, default: '' },
    storage: { type: String, enum: ['local', 'drive'], default: 'local' },
    driveFileId: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
  },
  { _id: false }
);

const movingInvoiceSchema = new Schema(
  {
    invoiceNo: { type: String, required: true, unique: true },
    job: { type: Schema.Types.ObjectId, ref: 'MovingJob' },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    status: { type: String, enum: ['draft', 'sent', 'paid', 'partial', 'cancelled'], default: 'draft' },
    invoiceDate: { type: Date, default: Date.now },
    dueDate: { type: Date },
    items: [movingQuoteItemSchema],
    subTotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    depositPaid: { type: Number, default: 0 },
    balanceDue: { type: Number, default: 0 },
    paymentHistory: [movingInvoicePaymentSchema],
    shareToken: { type: String, default: null },
    attachments: [movingInvoiceAttachmentSchema],
    notes: { type: String, default: '' },
    termsAndConditions: { type: String, default: '' },
    bankInformation: { type: String, default: '' },
    zohoBooksSyncId: { type: String, default: null },
    zohoBooksSyncedAt: { type: Date, default: null },
    zohoBooksSyncError: { type: String, default: null },
    stripeCheckoutSessionId: { type: String, default: null },
    stripePaymentLinkUrl: { type: String, default: null },
  },
  { timestamps: true }
);
movingInvoiceSchema.index({ customer: 1, createdAt: -1 });
movingInvoiceSchema.index({ status: 1 });
movingInvoiceSchema.index({ job: 1 });

const movingSurveyItemSchema = new Schema(
  {
    description: { type: String, default: '' },
    qty: { type: Number, default: 1 },
    estimatedVolumeCbm: { type: Number, default: 0 },
    fragile: { type: Boolean, default: false },
    notes: { type: String, default: '' },
    photoUrl: { type: String, default: '' },
  },
  { _id: false }
);

const surveyPhotoSchema = new Schema(
  {
    url: { type: String, default: '' },       // thumbnail / embeddable
    viewUrl: { type: String, default: '' },   // open-in-Drive link
    name: { type: String, default: '' },
    mimeType: { type: String, default: '' },
  },
  { _id: false }
);

const movingSurveyRoomSchema = new Schema(
  {
    name: { type: String, default: '' },
    items: [movingSurveyItemSchema],
    photos: { type: [surveyPhotoSchema], default: [] },
  },
  { _id: false }
);

const movingSurveySchema = new Schema(
  {
    job: { type: Schema.Types.ObjectId, ref: 'MovingJob', required: true },
    rooms: [movingSurveyRoomSchema],
    totalEstimatedVolumeCbm: { type: Number, default: 0 },
    recommendedTruckType: { type: String, enum: ['small', 'medium', 'large', 'extra_large', ''], default: '' },
    notes: { type: String, default: '' },
    surveyedBy: { type: String, default: '' },
    surveyedAt: { type: Date },
  },
  { timestamps: true }
);

const movingDocumentSchema = new Schema(
  {
    job: { type: Schema.Types.ObjectId, ref: 'MovingJob', required: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    type: { type: String, enum: ['bill_of_lading', 'inventory_sheet', 'contract', 'other'], default: 'other' },
    name: { type: String, required: true },
    url: { type: String, default: '' },
    storage: { type: String, enum: ['local', 'drive'], default: 'local' },
    driveFileId: { type: String, default: '' },
  },
  { timestamps: true }
);
movingDocumentSchema.index({ job: 1 });

const documentSchema = new Schema(
  {
    contract: { type: Schema.Types.ObjectId, ref: 'Contract' },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    name: { type: String, required: true },
    type: { type: String, enum: ['contract', 'id_proof', 'emirates_id', 'passport', 'visa', 'trade_license', 'other'], default: 'other' },
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

// ── Damage Claims ────────────────────────────────────────────────────────────
const movingClaimSchema = new Schema(
  {
    claimNo: { type: String, required: true, unique: true },
    job: { type: Schema.Types.ObjectId, ref: 'MovingJob', required: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    status: { type: String, enum: ['reported', 'under_review', 'approved', 'rejected', 'settled'], default: 'reported' },
    itemDescription: { type: String, required: true },
    damageDescription: { type: String, default: '' },
    photosBefore: [{ type: String }],
    photosAfter: [{ type: String }],
    claimedAmount: { type: Number, default: 0 },
    approvedAmount: { type: Number, default: 0 },
    settledAmount: { type: Number, default: 0 },
    settledDate: { type: Date },
    insuranceRef: { type: String, default: '' },
    resolution: { type: String, default: '' },
    reportedBy: { type: String, default: '' },
    timeline: [{ at: { type: Date, default: Date.now }, text: String, author: String }],
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);
movingClaimSchema.index({ job: 1 });
movingClaimSchema.index({ customer: 1 });
movingClaimSchema.index({ status: 1, createdAt: -1 });

const siteVisitSchema = new Schema({
  visitNo: { type: String, required: true, unique: true },
  visitDate: { type: Date, required: true },
  visitTime: { type: String, default: '' },
  customerName: { type: String, default: '' },
  customerPhone: { type: String, default: '' },
  address: { type: String, default: '' },
  notes: { type: String, required: true },
  items: [{ name: { type: String }, qty: { type: Number, default: 1 } }],
  images: [movingJobImageSchema],
  linkedJob: { type: Schema.Types.ObjectId, ref: 'MovingJob', default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' },
}, { timestamps: true });

const reminderStageSchema = new Schema({
  name: { type: String, default: '' },
  daysBeforeDue: { type: Number, default: 0 },
  frequencyDays: { type: Number, default: 1, min: 1 },
  message: { type: String, default: '' },
  channel: { type: String, enum: ['both', 'whatsapp', 'email'], default: 'both' },
}, { _id: false });

/* One step of the chase: how long to wait, and how to try next time.
 *
 * Deliberately the same shape as reminderStageSchema below — both are an
 * ordered ladder with a gap and a channel, and the two should read alike. */
const followUpStepSchema = new Schema({
  label: { type: String, default: '' },
  // Days after the previous attempt, so a step reads the same wherever it sits
  // in the list and reordering does not silently change the dates.
  afterDays: { type: Number, default: 2, min: 0 },
  channel: { type: String, enum: ATTEMPT_CHANNELS, default: 'call' },
}, { _id: false });

/* The default chase everybody follows. A singleton, like the reminder config:
   one plan, edited in Settings, seeded on first read. */
const followUpPlanSchema = new Schema({
  key: { type: String, default: 'default', unique: true },
  steps: { type: [followUpStepSchema], default: [] },
}, { timestamps: true });

export const FollowUpPlan = model('FollowUpPlan', followUpPlanSchema);

const reminderConfigSchema = new Schema({
  enabled: { type: Boolean, default: true },
  startDay: { type: Number, default: 15, min: 1, max: 28 },
  emailEnabled: { type: Boolean, default: false },
  whatsappEnabled: { type: Boolean, default: true },
  stages: { type: [reminderStageSchema], default: [] },
}, { timestamps: true });

const reminderLogSchema = new Schema({
  payment: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
  contract: { type: Schema.Types.ObjectId, ref: 'Contract', required: true },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  channel: { type: String, enum: ['whatsapp', 'email'], required: true },
  stage: { type: Number, required: true },
  sentAt: { type: Date, default: Date.now },
  message: { type: String, default: '' },
  success: { type: Boolean, required: true },
  error: { type: String, default: '' },
}, { timestamps: true });
reminderLogSchema.index({ payment: 1, sentAt: -1 });
reminderLogSchema.index({ contract: 1, sentAt: -1 });

// ── Sent email log ───────────────────────────────────────────────────────────
// Every email that leaves the system, recorded centrally in sendMail() rather
// than by each of the eleven callers. Before this there were three partial
// histories — automation logs, campaign recipients, and a per-customer list —
// and transactional mail such as a contract PDF appeared in none of them, so
// "did we email them?" had no single answer.
const sentEmailSchema = new Schema({
  to: { type: String, default: '' },
  // Bulk sends put the list here and the sender in `to`; the count is what
  // matters on a list page, the addresses are for opening one row.
  bcc: { type: String, default: '' },
  recipientCount: { type: Number, default: 1 },
  subject: { type: String, default: '' },
  status: { type: String, enum: ['sent', 'failed'], default: 'sent' },
  error: { type: String, default: '' },
  hasAttachments: { type: Boolean, default: false },
  // What was actually sent, so a row can be opened and read. Capped, because a
  // campaign stores one copy per recipient and each is personalised, so the
  // bodies are not shared.
  html: { type: String, default: '' },
  text: { type: String, default: '' },
  // What this email was, so the list can be read without opening every row.
  kind: { type: String, default: 'other' },   // reminder | campaign | bulk | contract | invoice | quote | notice | lead | auth | other
  label: { type: String, default: '' },       // e.g. the rule or campaign name
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
  contract: { type: Schema.Types.ObjectId, ref: 'Contract', default: null },
  sentBy: { type: String, default: '' },
  at: { type: Date, default: Date.now },
}, { timestamps: true });
sentEmailSchema.index({ at: -1 });
sentEmailSchema.index({ status: 1, at: -1 });
sentEmailSchema.index({ customer: 1, at: -1 });

export const SentEmail = model('SentEmail', sentEmailSchema);

// ── Marketing campaigns ──────────────────────────────────────────────────────
// One deliberate send to a group: a discount, an event, a seasonal greeting.
// Kept well away from the transactional mail in automationEngine — different
// audience, different consent, and marketing must never borrow a channel that
// someone only agreed to receive their invoices on.
const campaignSchema = new Schema({
  name: { type: String, required: true },
  channel: { type: String, enum: ['email', 'whatsapp', 'both'], default: 'email' },

  // How the audience was chosen. Stored so a sent campaign can say who it went
  // to in the terms it was built with, not just as a list of ids.
  audience: {
    tenants: { type: Boolean, default: true },
    pastTenants: { type: Boolean, default: false },
    leads: { type: Boolean, default: false },
    leadStatuses: { type: [String], default: [] },
    renewalIntent: { type: String, default: '' },
    owingOnly: { type: Boolean, default: false },
    labels: [{ type: Schema.Types.ObjectId, ref: 'WhatsAppLabel' }],
    // Skip anyone who already had a campaign on this channel within N days, so
    // two campaigns in a week do not both land on the same person.
    minDaysBetween: { type: Number, default: 7 },
  },

  emailSubject: { type: String, default: '' },
  emailHtml: { type: String, default: '' },

  // WhatsApp marketing has to go out as a template Meta has approved; free-form
  // is only legal inside 24 hours of the person writing to us.
  whatsapp: {
    templateName: { type: String, default: '' },
    language: { type: String, default: 'en' },
    variables: { type: [String], default: [] },
  },

  status: {
    type: String,
    enum: ['draft', 'sending', 'sent', 'cancelled', 'failed'],
    default: 'draft',
  },
  stats: {
    targeted: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
  },
  lastError: { type: String, default: '' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
}, { timestamps: true });

// One row per person per channel, written before anything is sent.
//
// This is what makes a campaign auditable — "it went to these 412 people" —
// and what lets the sender resume after a restart without messaging anyone a
// second time. Resolving the audience as it sends would give neither.
const campaignRecipientSchema = new Schema({
  campaign: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true },
  kind: { type: String, enum: ['customer', 'lead'], required: true },
  refId: { type: Schema.Types.ObjectId, required: true },
  name: { type: String, default: '' },
  channel: { type: String, enum: ['email', 'whatsapp'], required: true },
  email: { type: String, default: '' },
  phoneNormalized: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'sent', 'failed', 'skipped'], default: 'pending' },
  reason: { type: String, default: '' },
  sentAt: { type: Date, default: null },
}, { timestamps: true });
campaignRecipientSchema.index({ campaign: 1, status: 1 });
// The same person must not appear twice on one campaign and one channel, even
// if they arrived from both the tenant list and the lead list.
campaignRecipientSchema.index({ campaign: 1, channel: 1, kind: 1, refId: 1 }, { unique: true });

export const Campaign = model('Campaign', campaignSchema);
export const CampaignRecipient = model('CampaignRecipient', campaignRecipientSchema);

// ── WhatsApp chat labels ─────────────────────────────────────────────────────
// The same idea as labels in the WhatsApp Business app: a short, named tag a
// person puts on a conversation so it can be found again. Deliberately separate
// from WhatsAppLabelState, which mirrors labels coming the other way — from the
// legacy sync — and is overwritten wholesale on every webhook.
const whatsappLabelSchema = new Schema({
  name: { type: String, required: true, trim: true },
  color: { type: String, default: '#5B2BC9' },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });
whatsappLabelSchema.index({ name: 1 }, { unique: true });

// Which labels are on a conversation. Keyed by number rather than by lead or
// customer, because a chat has a number long before it has either.
const whatsappChatLabelSchema = new Schema({
  phoneNormalized: { type: String, required: true, unique: true },
  labels: [{ type: Schema.Types.ObjectId, ref: 'WhatsAppLabel' }],
}, { timestamps: true });

export const WhatsAppLabel = model('WhatsAppLabel', whatsappLabelSchema);
export const WhatsAppChatLabel = model('WhatsAppChatLabel', whatsappChatLabelSchema);

// ── WhatsApp AI assistant ────────────────────────────────────────────────────
// One config document for the whole account, the same shape reminderConfig uses.
// `mode` is the safety switch: 'draft' writes a suggestion into the console for
// a human to send, 'auto' sends it to the customer with nobody in between.
const aiBotConfigSchema = new Schema({
  enabled: { type: Boolean, default: false },
  mode: { type: String, enum: ['draft', 'auto'], default: 'draft' },
  systemPrompt: { type: String, default: '' },
  useAvailability: { type: Boolean, default: true },
  escalateTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  handoverKeywords: { type: [String], default: ['human', 'agent', 'manager', 'call me', 'speak to someone'] },
  maxRepliesPerThreadPerDay: { type: Number, default: 20 },
  humanPauseHours: { type: Number, default: 12 },
  // Keep summaries current for conversations that moved in the last couple of
  // days. Reads only — it sends nothing and writes nothing to a Lead.
  autoSummarise: { type: Boolean, default: true },
}, { timestamps: true });

// One per conversation, holding the state machine and any pending draft.
//
// `pendingMessageId` vs `handledMessageId` is the whole idempotency story: the
// webhook only records what arrived, and the worker marks it handled before it
// generates anything, so a crash mid-send can never produce a second reply.
const aiBotThreadSchema = new Schema({
  phoneNormalized: { type: String, required: true, unique: true },
  // 'bot' answers, 'escalated' waits for the assigned person, 'paused' means a
  // colleague replied by hand and the assistant stays out of the way for a while.
  status: { type: String, enum: ['bot', 'escalated', 'paused'], default: 'bot' },
  pausedUntil: { type: Date, default: null },
  pendingMessageId: { type: String, default: '' },
  pendingText: { type: String, default: '' },
  pendingType: { type: String, default: 'text' },
  pendingAt: { type: Date, default: null },
  handledMessageId: { type: String, default: '' },
  draftText: { type: String, default: '' },
  draftAt: { type: Date, default: null },
  // Reply budget, reset when the date string changes rather than on a timer.
  repliesOn: { type: String, default: '' },
  repliesCount: { type: Number, default: 0 },
  escalatedAt: { type: Date, default: null },
  escalationReason: { type: String, default: '' },
  escalationTask: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
  lastError: { type: String, default: '' },
}, { timestamps: true });
aiBotThreadSchema.index({ status: 1, updatedAt: -1 });

/* A model's reading of one WhatsApp thread, cached against the newest message
   in it so reopening a chat that has not moved costs nothing.

   The lead temperature lives here rather than on Lead: it is an opinion, and
   an opinion should not become a business record other code reads. */
const conversationSummarySchema = new Schema({
  phoneNormalized: { type: String, required: true, unique: true },
  lastMessageId: { type: String, default: '' },
  summary: { type: Schema.Types.Mixed, default: null },
  model: { type: String, default: '' },
  generatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

export const ConversationSummary = model('ConversationSummary', conversationSummarySchema);

/* One day's conversations, as read that morning.

   Stored rather than recomputed per page load so the report stops changing: a
   digest that reworded itself each time it was opened would not be a record of
   the day, and two people discussing it would be reading different things. */
const dailyDigestSchema = new Schema({
  day: { type: String, required: true, unique: true },   // 'YYYY-MM-DD', local
  builtAt: { type: Date, default: Date.now },
  stats: { type: Schema.Types.Mixed, default: null },
  chats: { type: [Schema.Types.Mixed], default: [] },
}, { timestamps: true });

export const DailyDigest = model('DailyDigest', dailyDigestSchema);

export const AiBotConfig = model('AiBotConfig', aiBotConfigSchema);
export const AiBotThread = model('AiBotThread', aiBotThreadSchema);

const counterSchema = new Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

// Interactive floor plan document (built in the Floor Map page)
const floorPlanSchema = new Schema({
  key: { type: String, default: 'default', unique: true },
  doc: { type: Schema.Types.Mixed, required: true },
  updatedBy: { type: String, default: '' },
}, { timestamps: true });

// Facility / site — each can have its own units, floor plans and operations
const siteSchema = new Schema({
  name: { type: String, required: true },
  code: { type: String, default: '' },
  address: { type: String, default: '' },
  hidden: { type: Boolean, default: false },
  isDefault: { type: Boolean, default: false },
}, { timestamps: true });

// ── Indexes for the hottest queries ───────────────────────────────────────────
// Without these, payments/invoices/documents lookups scan the whole collection
// on every contract page, report and billing plan.
paymentSchema.index({ contract: 1, dueDate: 1 });
paymentSchema.index({ invoice: 1 });
paymentSchema.index({ status: 1, dueDate: 1 });
paymentSchema.index({ status: 1, paidDate: 1 });

invoiceSchema.index({ orderNumber: 1 });
invoiceSchema.index({ customer: 1, createdAt: -1 });
invoiceSchema.index({ status: 1, dueDate: 1 });

documentSchema.index({ contract: 1, createdAt: -1 });
documentSchema.index({ customer: 1 });
documentSchema.index({ name: 1 });

unitSchema.index({ status: 1 });
unitSchema.index({ site: 1, status: 1 });
unitSchema.index({ floor: 1, unitNumber: 1 });

customerSchema.index({ fullName: 1 });
customerSchema.index({ createdAt: -1 });

export const User = model('User', userSchema);
export const UnitType = model('UnitType', unitTypeSchema);
export const Unit = model('Unit', unitSchema);
export const Customer = model('Customer', customerSchema);
export const Lead = model('Lead', leadSchema);
export const WhatsAppWebhookEvent = model('WhatsAppWebhookEvent', whatsappWebhookEventSchema);
export const WhatsAppLabelState = model('WhatsAppLabelState', whatsappLabelStateSchema);
// Every call Meta makes to the webhook, accepted or not. Without this a
// rejected delivery is indistinguishable from Meta never calling at all,
// which is exactly the question when replies do not arrive.
const whatsappWebhookHitSchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    ok: { type: Boolean, default: false },
    reason: { type: String, default: '' },
    hasSignature: { type: Boolean, default: false },
    field: { type: String, default: '' },
    messageCount: { type: Number, default: 0 },
    statusCount: { type: Number, default: 0 },
    from: { type: String, default: '' },
  },
  { versionKey: false },
);
whatsappWebhookHitSchema.index({ at: -1 });
export const WhatsAppWebhookHit = model('WhatsAppWebhookHit', whatsappWebhookHitSchema);

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
export const Worker = model('Worker', workerSchema);
export const Truck = model('Truck', truckSchema);
export const MovingLead = model('MovingLead', movingLeadSchema);
export const MovingJob = model('MovingJob', movingJobSchema);
export const MovingQuote = model('MovingQuote', movingQuoteSchema);
export const MovingInvoice = model('MovingInvoice', movingInvoiceSchema);
export const MovingSurvey = model('MovingSurvey', movingSurveySchema);
export const MovingDocument = model('MovingDocument', movingDocumentSchema);
export const MovingClaim = model('MovingClaim', movingClaimSchema);
export const ReminderConfig = model('ReminderConfig', reminderConfigSchema);
export const ReminderLog = model('ReminderLog', reminderLogSchema);

const productSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    rate: { type: Number, required: true, default: 0 },
    unit: { type: String, default: 'qty' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
export const SiteVisit = model('SiteVisit', siteVisitSchema);
export const Product = model('Product', productSchema);
export const Document = model('Document', documentSchema);
export const AuditLog = model('AuditLog', auditLogSchema);
export const Counter = model('Counter', counterSchema);
export const FloorPlan = model('FloorPlan', floorPlanSchema);
export const Site = model('Site', siteSchema);

// ── Automation Rules ──────────────────────────────────────────────────────────
const automationStepSchema = new Schema({
  value: { type: Number, default: 7 },
  direction: { type: String, enum: ['before', 'after'], default: 'before' },
  template: { type: String, default: '' },
  emailSubject: { type: String, default: '' },
  emailBody: { type: String, default: '' },
  whatsappBody: { type: String, default: '' },
  immediate: { type: Boolean, default: false },
}, { _id: false });

const automationRuleSchema = new Schema({
  name: { type: String, required: true },
  icon: { type: String, default: 'bell' },
  triggerEvent: { type: String, default: 'payment_due' },
  triggerLabel: { type: String, default: '' },
  relativeLabel: { type: String, default: 'due date' },
  enabled: { type: Boolean, default: true },
  emailEnabled: { type: Boolean, default: false },
  whatsappEnabled: { type: Boolean, default: true },
  steps: { type: [automationStepSchema], default: [] },
  recurring: {
    enabled: { type: Boolean, default: false },
    everyDays: { type: Number, default: 3 },
  },
  custom: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
}, { timestamps: true });

const automationLogSchema = new Schema({
  rule: { type: Schema.Types.ObjectId, ref: 'AutomationRule' },
  ruleName: { type: String, default: '' },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
  contract: { type: Schema.Types.ObjectId, ref: 'Contract' },
  unit: { type: String, default: '' },
  channel: { type: String, enum: ['whatsapp', 'email'], required: true },
  event: { type: String, default: '' },
  message: { type: String, default: '' },
  status: { type: String, enum: ['sent', 'failed', 'skipped'], default: 'sent' },
  error: { type: String, default: '' },
  sentAt: { type: Date, default: Date.now },
}, { timestamps: true });
automationLogSchema.index({ sentAt: -1 });
automationLogSchema.index({ customer: 1, sentAt: -1 });

export const AutomationRule = model('AutomationRule', automationRuleSchema);
export const AutomationLog = model('AutomationLog', automationLogSchema);

const messageTemplateSchema = new Schema({
  key: { type: String, required: true, unique: true },
  label: { type: String, required: true },
  subject: { type: String, default: '' },
  emailBody: { type: String, default: '' },
  // The designed version. When present it is what actually goes out, with
  // emailBody kept as the plain-text part for clients that will not render
  // HTML — a reminder should not arrive blank because someone reads mail in a
  // terminal.
  emailHtml: { type: String, default: '' },
  whatsappBody: { type: String, default: '' },
  variables: [String],
  // 'automation' templates are the contract-driven ones the reminder engine
  // and the contract page send. 'quick_reply' are the canned replies staff
  // pick from in the WhatsApp console — different audience, different
  // wording, so they are kept apart rather than sharing one list.
  kind: { type: String, enum: ['automation', 'quick_reply'], default: 'automation' },
  // Only meaningful for quick replies, which the console groups by it.
  category: { type: String, default: '' },
  sortOrder: { type: Number, default: 0 },
  // A quick reply can send a file as well as, or instead of, text — the
  // facility tour video, a price list. Held as a public URL rather than an
  // uploaded media id, because Meta expires uploaded ids after 30 days and a
  // canned reply that stops working after a month is worse than none.
  mediaUrl: { type: String, default: '' },
  mediaKind: { type: String, enum: ['', 'image', 'video', 'audio', 'document'], default: '' },
  mediaFilename: { type: String, default: '' },
}, { timestamps: true });
export const MessageTemplate = model('MessageTemplate', messageTemplateSchema);

// Document templates designed in the app — the storage agreement, notices
// (expiry, payment reminder, …). Rich HTML bodies; placeholders like
// {{customerName}} resolve at render time. isDefault marks the template used
// for contract agreement PDFs.
const agreementTemplateSchema = new Schema({
  name: { type: String, required: true },
  body: { type: String, default: '' },
  isDefault: { type: Boolean, default: false },
  module: { type: String, enum: ['storage', 'moving'], default: 'storage' },
  updatedBy: { type: String, default: '' },
  key: { type: String }, // legacy singleton key, kept for old documents
}, { timestamps: true });
export const AgreementTemplate = model('AgreementTemplate', agreementTemplateSchema);

// Asana-style task, assignable by admins to sales reps or created by a rep
// for themselves. Optionally linked to a lead (storage or moving) — the
// leadName is denormalized since Lead and MovingLead are separate
// collections and the task list shouldn't need to join across both.
const taskCommentSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  userName: { type: String, default: '' },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const taskAssignmentHistorySchema = new Schema({
  at: { type: Date, default: Date.now },
  fromId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  fromName: { type: String, default: '' },
  toId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  toName: { type: String, default: '' },
  byId: { type: Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String, default: '' },
  reason: { type: String, default: '' },
});

const taskAttachmentSchema = new Schema({
  name: { type: String, required: true },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  storage: { type: String, enum: ['drive', 'local', 'link'], default: 'local' },
  driveFileId: { type: String, default: '' },
  url: { type: String, default: '' },
  uploadedBy: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now },
});

const taskSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: '' },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' },
    leadId: { type: Schema.Types.ObjectId, default: null },
    leadType: { type: String, enum: ['storage', 'moving', 'contract', null], default: null },
    leadName: { type: String, default: '' },
    dueDate: { type: Date, default: null },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    status: { type: String, enum: ['todo', 'in_progress', 'done'], default: 'todo' },
    doneAt: { type: Date, default: null },
    comments: { type: [taskCommentSchema], default: [] },
    attachments: { type: [taskAttachmentSchema], default: [] },
    assignmentHistory: { type: [taskAssignmentHistorySchema], default: [] },
  },
  { timestamps: true }
);
taskSchema.index({ assignedTo: 1, status: 1, dueDate: 1 });
export const Task = model('Task', taskSchema);

// Admin-set weekly/monthly targets for a sales rep — "actual" progress is
// computed on read from Lead/MovingLead status, not stored here.
const salesGoalSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    daily: {
      units: { type: Number, default: 0 },
      moving: { type: Number, default: 0 },
    },
    weekly: {
      units: { type: Number, default: 0 },
      moving: { type: Number, default: 0 },
    },
    monthly: {
      units: { type: Number, default: 0 },
      moving: { type: Number, default: 0 },
    },
    dailyFollowUps: { type: Number, default: 0 },
    startTime: { type: String, default: '' },
    finishTime: { type: String, default: '' },
  },
  { timestamps: true }
);
export const SalesGoal = model('SalesGoal', salesGoalSchema);

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

export async function nextInvoiceNo(unitNumber, contractId) {
  if (unitNumber && contractId) {
    // Format: PB-YEAR-UNITNUMBER-INSTALLMENT
    // The counter is keyed by unit+year (NOT contract) so the sequence keeps
    // climbing across every contract that unit ever has — a per-contract key
    // resets to 1 each time, producing the same number once a unit is
    // re-leased and colliding with the unique index on invoiceNo (the bug
    // that made convert-to-contract hang/fail for previously-leased units).
    const year = new Date().getFullYear();
    const unitKey = unitNumber.replace(/\s+/g, '');
    const counter = await Counter.findOneAndUpdate(
      { key: `inv-unit-${unitKey}-${year}` },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    return `PB-${year}-${unitKey}-${String(counter.seq).padStart(2, '0')}`;
  }
  // Fallback legacy format
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

export async function nextMovingJobNo() {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const counter = await Counter.findOneAndUpdate(
    { key: `moving-job-${date}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `PB-${date}-${String(counter.seq).padStart(3, '0')}`;
}

export async function nextMovingQuoteNo() {
  const counter = await Counter.findOneAndUpdate(
    { key: 'moving-quote' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `MVQ-${String(counter.seq).padStart(5, '0')}`;
}

export async function nextMovingInvoiceNo() {
  const counter = await Counter.findOneAndUpdate(
    { key: 'moving-invoice' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `MVI-${String(counter.seq).padStart(5, '0')}`;
}

export async function nextMovingClaimNo() {
  const counter = await Counter.findOneAndUpdate(
    { key: 'moving-claim' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `CLM-${String(counter.seq).padStart(5, '0')}`;
}

export async function nextSiteVisitNo() {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const counter = await Counter.findOneAndUpdate(
    { key: `site-visit-${date}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `SV-${date}-${String(counter.seq).padStart(3, '0')}`;
}
