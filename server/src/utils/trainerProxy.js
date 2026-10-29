import http from 'node:http';

/**
 * Forwards /trainer-api/* to the AI Training Center's own process on this
 * machine (127.0.0.1:TRAINER_PORT, path /api/*). The Training Center is a
 * separate product with its own database and accounts; it only shares this
 * server's public address. Bodies are streamed untouched (uploads, signed
 * WhatsApp webhooks), so this is mounted ahead of the JSON parser.
 */
export function trainerProxy({ port = Number(process.env.TRAINER_PORT || 5020) } = {}) {
   return (req, res) => {
      const headers = { ...req.headers, 'x-forwarded-for': [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', '), 'x-forwarded-proto': req.headers['x-forwarded-proto'] || req.protocol || 'https' };
      delete headers.host;
      const upstream = http.request({ host: '127.0.0.1', port, method: req.method, path: `/api${req.url}`, headers, timeout: 300_000 }, (r) => {
         res.writeHead(r.statusCode || 502, r.headers);
         r.pipe(res);
      });
      upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
      upstream.on('error', () => { if (!res.headersSent) res.status(502).json({ error: 'The AI Training Center is not reachable right now' }); else res.end(); });
      req.pipe(upstream);
   };
}
