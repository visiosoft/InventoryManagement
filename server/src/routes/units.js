import { Router } from 'express';
import { leasedPrice } from '../services/rateRealisation.js';
import { parseUnitRows, summariseImport } from '../services/unitImport.js';
import { Unit, Contract } from '../models/index.js';
import { siteScope } from '../utils/siteScope.js';

const router = Router();

router.get('/', async (req, res) => {
  const scope = await siteScope(req.query.site);
  const filter = scope ? { ...scope.unitFilter } : {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.floor) filter.floor = req.query.floor;
  if (req.query.minSize) filter.sizeSqf = { ...filter.sizeSqf, $gte: Number(req.query.minSize) };
  if (req.query.maxSize) filter.sizeSqf = { ...filter.sizeSqf, $lte: Number(req.query.maxSize) };
  const units = await Unit.find(filter).sort({ floor: 1, unitNumber: 1 }).lean();
  res.json(units);
});

// Pricing matrix — every unit with its active contract's money fields.
// Backs Settings → Unit Pricing: actual (list) price vs leased amount.
router.get('/pricing-matrix', async (req, res) => {
  try {
    const [units, contracts] = await Promise.all([
      Unit.find().sort({ floor: 1, unitNumber: 1 }).lean(),
      Contract.find({ status: { $in: ['active', 'pending_signature'] } })
        .populate('customer', 'fullName')
        .populate('unit', 'price')
        .populate('units', 'price')
        // billingPeriod was missing, so the page could not tell a weekly rate
        // from a monthly one and compared both against a monthly asking price.
        .select('contractNo customer unit units rate leasedPrice firstMonthDiscountPct billingPeriod status')
        .lean(),
    ]);

    const byUnit = new Map();
    for (const c of contracts) {
      const ids = [c.unit, ...(c.units || [])].filter(Boolean).map(String);
      for (const id of ids) {
        // active beats pending_signature if a unit somehow has both
        if (!byUnit.has(id) || c.status === 'active') {
          byUnit.set(id, {
            _id: c._id,
            contractNo: c.contractNo,
            customerName: c.customer?.fullName || '',
            rate: c.rate ?? null,
            // Resolved on the server so the pricing screen and the rates
            // report cannot drift apart, and so a weekly contract is compared
            // as a month rather than as a week.
            leasedPrice: leasedPrice(c),
            firstMonthDiscountPct: c.firstMonthDiscountPct ?? 0,
            billingPeriod: c.billingPeriod ?? 'monthly',
            status: c.status,
          });
        }
      }
    }

    res.json({
      units: units.map((u) => ({
        _id: u._id,
        unitNumber: u.unitNumber,
        floor: u.floor || '',
        sizeSqf: u.sizeSqf ?? null,
        status: u.status,
        price: u.price ?? null,
        contract: byUnit.get(String(u._id)) || null,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Who currently holds each unit. A unit can carry several active contracts
// now that any unit may be shared, so this returns every one of them rather
// than a single tenant. Declared before '/:id' so the literal path wins.
router.get('/active-contracts', async (_req, res) => {
  const contracts = await Contract.find({ status: 'active', archived: { $ne: true } })
    .select('contractNo customer unit units endDate')
    .populate('customer', 'fullName')
    .sort({ endDate: 1 })
    .lean();

  const byUnit = {};
  for (const c of contracts) {
    const unitIds = [c.unit, ...(c.units || [])].filter(Boolean).map(String);
    for (const uid of new Set(unitIds)) {
      (byUnit[uid] ||= []).push({
        contractId: String(c._id),
        contractNo: c.contractNo || '',
        customerName: c.customer?.fullName || '',
        endDate: c.endDate || null,
      });
    }
  }
  res.json({ byUnit });
});

router.get('/:id', async (req, res) => {
  const unit = await Unit.findById(req.params.id);
  if (!unit) return res.status(404).json({ error: 'Unit not found' });
  const contracts = await Contract.find({ $or: [{ unit: unit._id }, { units: unit._id }] })
    .populate('customer')
    .sort({ createdAt: -1 })
    .limit(10);
  res.json({ unit, contracts });
});

router.post('/', async (req, res) => {
  const { unitNumber, floor, sizeSqf, price, lengthFt, widthFt, status, discountPct, notes } = req.body;
  const exists = await Unit.exists({ unitNumber });
  if (exists) return res.status(409).json({ error: `Unit ${unitNumber} already exists` });
  const unit = await Unit.create({ unitNumber, floor, sizeSqf, price, lengthFt, widthFt, status, discountPct, notes });
  res.status(201).json(unit);
});

// Bulk-set the price for every unit of a given floor + size at once.
// Mirrors the single-unit lock rule below: units without a price are
// always filled in; units that already have a (different) price are only
// touched when an admin explicitly opts in via `override`. Must be
// registered before PUT /:id, or Express would match "bulk-price" as an id.
/* Bring a floor in from a spreadsheet.
   Two modes: preview shows exactly what would be created and writes nothing;
   commit creates them. Units already present are skipped by number rather than
   overwritten, so running it twice cannot duplicate a floor or quietly reprice
   a unit somebody has since corrected. */
router.post('/bulk-import', async (req, res) => {
  try {
    const floor = String(req.body?.floor || '').trim();
    const { units, problems } = parseUnitRows(req.body?.text || '', { floor });
    if (!units.length) {
      return res.status(400).json({ error: 'Nothing recognisable in that paste', problems });
    }

    const numbers = units.map((u) => u.unitNumber);
    const existing = await Unit.find({ unitNumber: { $in: numbers } }).select('unitNumber').lean();
    const already = new Set(existing.map((u) => u.unitNumber));
    const fresh = units.filter((u) => !already.has(u.unitNumber));

    const preview = {
      floor,
      summary: summariseImport(fresh),
      problems,
      skipped: [...already],
      units: fresh,
    };

    if (req.body?.commit !== true) return res.json({ ...preview, committed: false });

    // `incomplete` is a preview flag, not a stored field.
    const created = await Unit.insertMany(fresh.map(({ incomplete, ...u }) => u), { ordered: false });
    console.log(`[Units] imported ${created.length} onto ${floor || '(no floor)'}, ${already.size} already there`);
    res.json({ ...preview, committed: true, created: created.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/bulk-price', async (req, res) => {
  const { floor, sizeSqf, price, override } = req.body;
  if (floor == null || sizeSqf == null || price == null) {
    return res.status(400).json({ error: 'floor, sizeSqf and price are required' });
  }

  const isOverride = req.user?.role === 'admin' && override === true;
  const units = await Unit.find({ floor, sizeSqf: Number(sizeSqf) });

  let updated = 0;
  let skipped = 0;
  for (const unit of units) {
    if (unit.price == null) {
      unit.price = price;
      await unit.save();
      updated++;
    } else if (Number(unit.price) !== Number(price)) {
      if (isOverride) {
        unit.price = price;
        await unit.save();
        updated++;
      } else {
        skipped++;
      }
    }
  }

  res.json({ matched: units.length, updated, skipped });
});

router.put('/:id', async (req, res) => {
  const unit = await Unit.findById(req.params.id);
  if (!unit) return res.status(404).json({ error: 'Unit not found' });

  const allowed = ['unitNumber', 'floor', 'sizeSqf', 'price', 'lengthFt', 'widthFt', 'status', 'discountPct', 'shared', 'notes', 'site'];
  const update = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) update[key] = req.body[key];
  }

  // The list price is set once. Changing an existing price is a deliberate
  // admin-only correction (priceOverride from the Unit Pricing page).
  if (update.price !== undefined && unit.price != null && Number(update.price) !== Number(unit.price)) {
    const isOverride = req.user?.role === 'admin' && req.body.priceOverride === true;
    if (!isOverride) {
      return res.status(403).json({ error: 'The unit price is locked once set — an admin can unlock it from Settings → Unit Pricing' });
    }
  }

  Object.assign(unit, update);
  await unit.save();
  res.json(unit);
});

router.delete('/:id', async (req, res) => {
  const hasContracts = await Contract.exists({ unit: req.params.id, status: { $in: ['active', 'pending_signature', 'draft'] } });
  if (hasContracts) return res.status(409).json({ error: 'Unit has open contracts' });
  await Unit.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
