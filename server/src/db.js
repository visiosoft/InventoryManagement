import dns from 'dns';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mongoose from 'mongoose';

const GOOGLE_DNS_SERVERS = ['1.1.1.1', '1.0.0.1'];
let mongoLookupPatched = false;

function shouldUseGoogleResolver(host) {
  return host.endsWith('.mongodb.net')
    || host.endsWith('.googleapis.com')
    || host === 'oauth2.googleapis.com';
}

function patchMongoDnsLookup() {
  if (mongoLookupPatched) return;
  mongoLookupPatched = true;

  const originalLookup = dns.lookup.bind(dns);

  dns.lookup = function patchedLookup(hostname, options, callback) {
    let cb = callback;
    let opts = options;

    if (typeof options === 'function') {
      cb = options;
      opts = {};
    }

    const normalizedOpts = typeof opts === 'number' ? { family: opts } : (opts || {});
    const host = String(hostname || '').toLowerCase();
    const useGoogleResolver = shouldUseGoogleResolver(host);

    if (!useGoogleResolver) {
      return originalLookup(hostname, normalizedOpts, cb);
    }

    const wantFamily = Number(normalizedOpts.family || 4);
    const wantAll = Boolean(normalizedOpts.all);
    const resolver = wantFamily === 6 ? dns.resolve6.bind(dns) : dns.resolve4.bind(dns);

    return resolver(hostname, (resolveErr, addresses) => {
      if (!resolveErr && Array.isArray(addresses) && addresses.length > 0) {
        if (wantAll) {
          cb(null, addresses.map((address) => ({ address, family: wantFamily })));
          return;
        }
        cb(null, addresses[0], wantFamily);
        return;
      }

      originalLookup(hostname, normalizedOpts, cb);
    });
  };
}

// Some networks/DNS servers refuse SRV/TXT lookups, which mongodb+srv:// URIs
// require. If the default resolver can't answer the SRV query, fall back to
// public resolvers before connecting.
/**
 * Open the cluster, without opening a default database.
 *
 * This used to call `mongoose.connect`, which populates the global
 * `mongoose.connection`. With one company that was harmless. With a database
 * per customer it is the thing that makes a leak possible: any code reaching
 * for `mongoose.connection` — and four places in this codebase do, for raw
 * collection access — would quietly read whichever database happened to be
 * the default, rather than the customer being served.
 *
 * So nothing opens the default connection any more. `createConnection` returns
 * a pool that every organisation's database is reached through, and
 * `mongoose.connection.readyState` stays 0 for the life of the process. Code
 * that goes looking for a database it was not given now finds nothing at all,
 * which is the only safe answer.
 */
export async function connectDb() {
  // Ensure env vars are available even when scripts are launched from subfolders
  // such as server/scripts where dotenv's default cwd lookup does not find server/.env.
  if (!process.env.MONGODB_URI) {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFile);
    const envPath = path.resolve(currentDir, '../.env');
    dotenv.config({ path: envPath });
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is missing. Set it in server/.env');
  }

  const connectOptions = {
    dbName: process.env.DB_NAME || 'PurpleBox',
    /* Indexes are built once, deliberately, when an organisation is
       provisioned — not on the first query each customer happens to make.
       Sixty index builds in front of somebody's first page load is a slow
       first impression and a surprising load on the cluster. */
    autoIndex: false,
    serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 15000),
    family: 4,
  };

  dns.setServers(GOOGLE_DNS_SERVERS);
  dns.setDefaultResultOrder('ipv4first');
  patchMongoDnsLookup();

  const srvMatch = uri.match(/^mongodb\+srv:\/\/(?:[^@]+@)?([^/?]+)/);
  if (srvMatch) {
    try {
      await dns.promises.resolveSrv(`_mongodb._tcp.${srvMatch[1]}`);
    } catch {
      dns.setServers(GOOGLE_DNS_SERVERS);
    }
  }

  try {
    return await mongoose.createConnection(uri, connectOptions).asPromise();
  } catch (firstError) {
    // Retry once with Google DNS for Atlas SRV records in case the local resolver is flaky.
    if (!srvMatch) {
      throw firstError;
    }

    dns.setServers(GOOGLE_DNS_SERVERS);
    dns.setDefaultResultOrder('ipv4first');

    try {
      await dns.promises.resolveSrv(`_mongodb._tcp.${srvMatch[1]}`);
    } catch {
      // Keep retrying connect anyway, the driver may still resolve depending on environment.
    }

    return await mongoose.createConnection(uri, connectOptions).asPromise();
  }
}
