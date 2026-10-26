import { Router } from 'express';
import multer from 'multer';
import { Customer, DoorEvent, DoorPerson } from '../models/index.js';
import { alertsFrom, doorConfig, ingestDoorAlerts, secretMatches } from '../services/doorAccess.js';

/**
 * The door terminal. `pushRouter` is the public address the device posts its
 * events to (the secret in the path is the only key); the default router is
 * the admin's view: setup, the access log, and who on the device is which
 * customer. Read-only towards the door: nothing here opens or changes it.
 */

export const pushRouter = Router();
const parts = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 6 } });

pushRouter.post('/:secret', parts.any(), async (req, res) => {
   try {
      const config = await doorConfig();
      if (!secretMatches(req.params.secret, config.secret)) return res.status(404).end();
      const result = await ingestDoorAlerts(alertsFrom({ body: req.body, files: req.files }));
      res.json({ ok: true, ...result });
   } catch (e) {
      // A 500 makes the device keep the event and send it again later.
      console.error('[Door] push:', e.message);
      res.status(500).json({ error: 'not stored' });
   }
});

const router = Router();
router.use((req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' })));

const apiBase = () => (process.env.API_PUBLIC_URL || 'https://api.purplebox.ae').replace(/\/+$/, '');

/** Where the device should send its events, and whether it has. */
router.get('/setup', async (_req, res) => {
   try {
      const c = await doorConfig();
      const url = new URL(`${apiBase()}/api/public/door/${c.secret}`);
      res.json({ url: url.toString(), host: url.hostname, path: url.pathname, lastEventAt: c.lastEventAt, lastDevice: c.lastDevice });
   } catch (e) { res.status(500).json({ error: e.message }); }
});

/** The access log: the last `days` days, newest first, optionally for one customer. */
router.get('/events', async (req, res) => {
   try {
      const days = Math.min(90, Math.max(1, Number(req.query.days) || 1));
      const filter = { at: { $gte: new Date(Date.now() - days * 86400000) } };
      if (req.query.customer) filter.customer = req.query.customer;
      const rows = await DoorEvent.find(filter).sort({ at: -1 }).limit(500).populate('customer', 'fullName').select('-raw').lean();
      const people = await DoorPerson.find({ employeeNo: { $in: [...new Set(rows.map((r) => r.employeeNo).filter(Boolean))] } }).populate('customer', 'fullName').lean();
      const personOf = new Map(people.map((p) => [p.employeeNo, p]));
      res.json({
         days,
         events: rows.map((r) => {
            // A person linked since the event happened shows as that customer too.
            const linked = r.customer || personOf.get(r.employeeNo)?.customer || null;
            return { ...r, customer: linked ? { _id: linked._id, fullName: linked.fullName } : null };
         }),
      });
   } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Everyone the device has reported, linked or not. */
router.get('/people', async (_req, res) => {
   try {
      const people = await DoorPerson.find({}).sort({ name: 1 }).populate('customer', 'fullName').lean();
      res.json({ people });
   } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Link a person on the device to a customer (or unlink with null). Earlier events follow. */
router.put('/people/:employeeNo', async (req, res) => {
   try {
      const customerId = req.body?.customerId || null;
      if (customerId && !(await Customer.exists({ _id: customerId }))) return res.status(404).json({ error: 'Customer not found' });
      const person = await DoorPerson.findOneAndUpdate(
         { employeeNo: String(req.params.employeeNo) },
         { $set: { customer: customerId, matchedBy: customerId ? 'admin' : '' } },
         { new: true, upsert: true },
      );
      await DoorEvent.updateMany({ employeeNo: person.employeeNo }, { $set: { customer: customerId } });
      res.json({ ok: true });
   } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
