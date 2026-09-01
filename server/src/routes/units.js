import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { contractLeased } from '../services/rateRealisation.js';
import { Unit, Contract, Site } from '../models/index.js';
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
    /* Scoped, for the same reason /sizes is: pricing a facility while looking
       at every facility's units means setting a rate on the wrong building. */
    const scope = await siteScope(req.query.site);
    const [units, contracts] = await Promise.all([
      Unit.find(scope ? scope.unitFilter : {}).sort({ floor: 1, unitNumber: 1 }).lean(),
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
            leasedPrice: contractLeased(c),
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
/**
 * Every unit size that actually exists, with how many are free.
 *
 * The lead pages used /reports/summary for this, which was wrong twice: its
 * sizes are a hardcoded list of seven buckets, so the 40, 75, 85 and 110 sqft
 * units could not be picked at all; and it formats the size as "25 sq ft" for
 * display, so anything reading it back got NaN.
 *
 * Sizes here are numbers, and they come from the units themselves.
 */
router.get('/sizes', async (req, res) => {
    try {
        /* Scoped to the facility, like everything else under /units.
         *
         * It ignored ?site= and counted every facility together, so a lead at
         * Al Quoz offered "100 sqft — 11 free of 25" when that building has one
         * free of fifteen, and offered 80 and 180 sqft sizes it does not stock
         * at all. A rep reading that promises a unit which is not there. */
        const scope = await siteScope(req.query.site);
        const rows = await Unit.aggregate([
            { $match: { ...(scope ? scope.unitFilter : {}), sizeSqf: { $ne: null } } },
            {
                $group: {
                    _id: '$sizeSqf',
                    total: { $sum: 1 },
                    available: { $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] } },
                },
            },
            { $sort: { _id: 1 } },
        ]);
        res.json(rows.map((r) => ({ sizeSqf: r._id, total: r.total, available: r.available })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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
  const { unitNumber, floor, sizeSqf, price, lengthFt, widthFt, status, discountPct, notes, site } = req.body;
  const exists = await Unit.exists({ unitNumber });
  if (exists) return res.status(409).json({ error: `Unit ${unitNumber} already exists` });

  /* Which facility it belongs to.
   *
   * This used to be dropped on the floor: `site` was never read, so every
   * unit created since facilities shipped landed in none of them — which is
   * how 151 units ended up unattached. Falls back to the default facility so
   * a unit is never orphaned again, and an unknown id is refused rather than
   * stored as a dangling reference. */
  let siteId = site || null;
  if (siteId && !(await Site.exists({ _id: siteId }).catch(() => null))) {
    return res.status(400).json({ error: 'That facility does not exist' });
  }
  if (!siteId) {
    const fallback = await Site.findOne({ isDefault: true }).select('_id')
      ?? await Site.findOne().sort({ createdAt: 1 }).select('_id');
    siteId = fallback?._id ?? null;
  }

  const unit = await Unit.create({ unitNumber, floor, sizeSqf, price, lengthFt, widthFt, status, discountPct, notes, site: siteId });
  res.status(201).json(unit);
});

// Bulk-set the price for every unit of a given floor + size at once.
// Mirrors the single-unit lock rule below: units without a price are
// always filled in; units that already have a (different) price are only
// touched when an admin explicitly opts in via `override`. Must be
// registered before PUT /:id, or Express would match "bulk-price" as an id.
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

router.delete('/:id', requireAdmin, async (req, res) => {
  const hasContracts = await Contract.exists({ unit: req.params.id, status: { $in: ['active', 'pending_signature', 'draft'] } });
  if (hasContracts) return res.status(409).json({ error: 'Unit has open contracts' });
  await Unit.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
