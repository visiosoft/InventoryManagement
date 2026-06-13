import { Router } from 'express';
import { UnitType } from '../models/index.js';

const router = Router();

const DEFAULTS = [
  { sizeSqf: 10,  label: '10 Sq Ft',  monthlyRate: 300,  weeklyRate: 75,     discountPct: 20 },
  { sizeSqf: 25,  label: '25 Sq Ft',  monthlyRate: 625,  weeklyRate: 156.25, discountPct: 20 },
  { sizeSqf: 35,  label: '35 Sq Ft',  monthlyRate: 700,  weeklyRate: 175,    discountPct: 20 },
  { sizeSqf: 50,  label: '50 Sq Ft',  monthlyRate: 950,  weeklyRate: 237.5,  discountPct: 20 },
  { sizeSqf: 100, label: '100 Sq Ft', monthlyRate: 1600, weeklyRate: 400,    discountPct: 20 },
  { sizeSqf: 150, label: '150 Sq Ft', monthlyRate: 2350, weeklyRate: 587.5,  discountPct: 20 },
  { sizeSqf: 200, label: '200 Sq Ft', monthlyRate: 3000, weeklyRate: 750,    discountPct: 20 },
];

export async function seedUnitTypes() {
  const count = await UnitType.countDocuments();
  if (count === 0) {
    await UnitType.insertMany(DEFAULTS);
    console.log('Seeded default unit pricing tiers');
  }
}

router.get('/', async (req, res) => {
  const tiers = await UnitType.find().sort({ sizeSqf: 1 });
  res.json(tiers);
});

router.post('/', async (req, res) => {
  const sqf = Number(req.body.sizeSqf);
  const monthly = Number(req.body.monthlyRate);
  if (!sqf || !monthly) return res.status(400).json({ error: 'sizeSqf and monthlyRate are required' });

  try {
    const tier = await UnitType.create({
      sizeSqf: sqf,
      label: String(req.body.label || '').trim() || `${sqf} Sq Ft`,
      monthlyRate: monthly,
      weeklyRate: req.body.weeklyRate ? Number(req.body.weeklyRate) : Math.round((monthly / 4) * 100) / 100,
      discountPct: req.body.discountPct !== undefined ? Number(req.body.discountPct) : 20,
    });
    res.status(201).json(tier);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: `A tier for ${sqf} Sq Ft already exists` });
    throw err;
  }
});

router.put('/:id', async (req, res) => {
  const sqf = Number(req.body.sizeSqf);
  const monthly = Number(req.body.monthlyRate);
  if (!sqf || !monthly) return res.status(400).json({ error: 'sizeSqf and monthlyRate are required' });

  const tier = await UnitType.findByIdAndUpdate(
    req.params.id,
    {
      sizeSqf: sqf,
      label: String(req.body.label || '').trim() || `${sqf} Sq Ft`,
      monthlyRate: monthly,
      weeklyRate: req.body.weeklyRate ? Number(req.body.weeklyRate) : Math.round((monthly / 4) * 100) / 100,
      discountPct: req.body.discountPct !== undefined ? Number(req.body.discountPct) : 20,
    },
    { new: true }
  );
  if (!tier) return res.status(404).json({ error: 'Tier not found' });
  res.json(tier);
});

router.delete('/:id', async (req, res) => {
  const tier = await UnitType.findByIdAndDelete(req.params.id);
  if (!tier) return res.status(404).json({ error: 'Tier not found' });
  res.json({ ok: true });
});

export default router;
