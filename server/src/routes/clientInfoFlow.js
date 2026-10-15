import { Router } from 'express';
import { sendClientInfoFlow } from '../services/clientInfoFlow.js';

/** /api/client-info — send the client-details WhatsApp Flow. The answers come
 *  back to the flow endpoint, POST /api/whatsapp/flow. */
const router = Router();

// POST /api/client-info/send  { phone, name? }
router.post('/send', async (req, res) => {
    try {
        res.json(await sendClientInfoFlow({ phone: req.body?.phone, name: req.body?.name }));
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
});

export default router;
