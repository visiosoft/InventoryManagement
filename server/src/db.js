import dns from 'dns';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mongoose from 'mongoose';

// Some networks/DNS servers refuse SRV/TXT lookups, which mongodb+srv:// URIs
// require. If the default resolver can't answer the SRV query, fall back to
// public resolvers before connecting.
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

  const srvMatch = uri.match(/^mongodb\+srv:\/\/(?:[^@]+@)?([^/?]+)/);
  if (srvMatch) {
    try {
      await dns.promises.resolveSrv(`_mongodb._tcp.${srvMatch[1]}`);
    } catch {
      dns.setServers(['8.8.8.8', '1.1.1.1']);
    }
  }
  await mongoose.connect(uri, { dbName: process.env.DB_NAME || 'PurpleBox' });
}
