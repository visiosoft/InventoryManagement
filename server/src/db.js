import dns from 'dns';
import mongoose from 'mongoose';

// Some networks/DNS servers refuse SRV/TXT lookups, which mongodb+srv:// URIs
// require. If the default resolver can't answer the SRV query, fall back to
// public resolvers before connecting.
export async function connectDb() {
  const uri = process.env.MONGODB_URI;
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
