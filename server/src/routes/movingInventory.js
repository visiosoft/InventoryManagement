import { Router } from 'express';
import { MovingItem, MovingStockTxn } from '../models/index.js';

const router = Router();

function escRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

router.get('/summary', async (_req, res) => {
    const [totalItems, lowStock, outOfStock] = await Promise.all([
        MovingItem.countDocuments({ active: true }),
        MovingItem.countDocuments({ active: true, $expr: { $lte: ['$onHand', '$reorderLevel'] } }),
        MovingItem.countDocuments({ active: true, onHand: { $lte: 0 } }),
    ]);

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const txToday = await MovingStockTxn.countDocuments({ txnDate: { $gte: start } });

    res.json({ totalItems, lowStock, outOfStock, txToday });
});

router.get('/items', async (req, res) => {
    const filter = {};
    if (req.query.active === 'true') filter.active = true;
    if (req.query.active === 'false') filter.active = false;
    if (req.query.category) filter.category = String(req.query.category);
    if (req.query.lowStock === 'true') filter.$expr = { $lte: ['$onHand', '$reorderLevel'] };

    if (req.query.search) {
        const re = new RegExp(escRegex(req.query.search), 'i');
        filter.$or = [{ sku: re }, { name: re }, { sizeLabel: re }];
    }

    const items = await MovingItem.find(filter).sort({ name: 1, sizeLabel: 1 });
    res.json(items);
});

router.post('/items', async (req, res) => {
    const body = {
        sku: String(req.body.sku || '').trim(),
        name: String(req.body.name || '').trim(),
        category: String(req.body.category || 'box').trim(),
        sizeLabel: String(req.body.sizeLabel || '').trim(),
        lengthCm: req.body.lengthCm != null && req.body.lengthCm !== '' ? Number(req.body.lengthCm) : null,
        widthCm: req.body.widthCm != null && req.body.widthCm !== '' ? Number(req.body.widthCm) : null,
        heightCm: req.body.heightCm != null && req.body.heightCm !== '' ? Number(req.body.heightCm) : null,
        unit: String(req.body.unit || 'pcs').trim(),
        onHand: Number(req.body.onHand || 0),
        reorderLevel: Number(req.body.reorderLevel || 0),
        active: req.body.active !== false,
        notes: String(req.body.notes || '').trim(),
    };

    if (!body.sku || !body.name) return res.status(400).json({ error: 'sku and name are required' });
    if (!Number.isFinite(body.onHand) || body.onHand < 0) return res.status(400).json({ error: 'onHand must be 0 or more' });
    if (!Number.isFinite(body.reorderLevel) || body.reorderLevel < 0) return res.status(400).json({ error: 'reorderLevel must be 0 or more' });

    const item = await MovingItem.create(body);
    res.status(201).json(item);
});

router.put('/items/:id', async (req, res) => {
    const patch = {};
    const fields = ['sku', 'name', 'category', 'sizeLabel', 'unit', 'notes'];
    for (const f of fields) {
        if (req.body[f] !== undefined) patch[f] = String(req.body[f] || '').trim();
    }
    if (req.body.lengthCm !== undefined) patch.lengthCm = req.body.lengthCm === '' ? null : Number(req.body.lengthCm);
    if (req.body.widthCm !== undefined) patch.widthCm = req.body.widthCm === '' ? null : Number(req.body.widthCm);
    if (req.body.heightCm !== undefined) patch.heightCm = req.body.heightCm === '' ? null : Number(req.body.heightCm);
    if (req.body.reorderLevel !== undefined) patch.reorderLevel = Number(req.body.reorderLevel);
    if (req.body.active !== undefined) patch.active = Boolean(req.body.active);

    if (patch.reorderLevel != null && (!Number.isFinite(patch.reorderLevel) || patch.reorderLevel < 0)) {
        return res.status(400).json({ error: 'reorderLevel must be 0 or more' });
    }

    const item = await MovingItem.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
});

router.post('/transactions', async (req, res) => {
    const item = await MovingItem.findById(req.body.item);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const txnType = String(req.body.txnType || '').trim();
    if (!['in', 'out', 'adjustment', 'transfer', 'return'].includes(txnType)) {
        return res.status(400).json({ error: 'Invalid transaction type' });
    }

    const qtyInput = Number(req.body.qty);
    if (!Number.isFinite(qtyInput) || qtyInput === 0) {
        return res.status(400).json({ error: 'qty must be a non-zero number' });
    }

    const delta = txnType === 'adjustment'
        ? qtyInput
        : (txnType === 'in' || txnType === 'return' ? Math.abs(qtyInput) : -Math.abs(qtyInput));

    const previousOnHand = Number(item.onHand || 0);
    const resultingOnHand = previousOnHand + delta;
    if (resultingOnHand < 0) {
        return res.status(409).json({ error: `Not enough stock. On hand: ${previousOnHand}` });
    }

    item.onHand = resultingOnHand;
    await item.save();

    const txn = await MovingStockTxn.create({
        item: item._id,
        txnType,
        qty: qtyInput,
        previousOnHand,
        resultingOnHand,
        unitCost: Number(req.body.unitCost || 0),
        reason: String(req.body.reason || '').trim(),
        takenBy: String(req.body.takenBy || req.user?.name || '').trim(),
        contract: req.body.contract || undefined,
        customer: req.body.customer || undefined,
        txnDate: req.body.txnDate ? new Date(req.body.txnDate) : new Date(),
        notes: String(req.body.notes || '').trim(),
        createdBy: req.user?.id,
    });

    res.status(201).json(await txn.populate('item', 'sku name sizeLabel unit').populate('contract', 'contractNo').populate('customer', 'fullName'));
});

router.get('/transactions', async (req, res) => {
    const filter = {};
    if (req.query.item) filter.item = req.query.item;
    if (req.query.txnType) filter.txnType = String(req.query.txnType);
    if (req.query.contract) filter.contract = req.query.contract;
    if (req.query.customer) filter.customer = req.query.customer;

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (from || to) {
        filter.txnDate = {};
        if (from) filter.txnDate.$gte = from;
        if (to) filter.txnDate.$lte = to;
    }

    if (req.query.search) {
        const re = new RegExp(escRegex(req.query.search), 'i');
        filter.$or = [{ takenBy: re }, { reason: re }, { notes: re }];
    }

    const txns = await MovingStockTxn.find(filter)
        .populate('item', 'sku name sizeLabel unit')
        .populate('contract', 'contractNo')
        .populate('customer', 'fullName')
        .sort({ txnDate: -1, createdAt: -1 })
        .limit(Math.min(Number(req.query.limit) || 200, 500));

    res.json(txns);
});

export default router;
