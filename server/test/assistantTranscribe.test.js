import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AssistantConfig } from '../src/models/index.js';
import assistantRouter from '../src/routes/assistant.js';

// Only the route's own guards (auth, file presence) — not the OpenAI call
// itself, which needs a real network call to actually transcribe. That
// success path is exercised by hand, not by this suite.
let mongod;

before(async () => {
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'assistant_transcribe_test' });
  await AssistantConfig.init();
}, { timeout: 240000 });

after(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token) { try { req.user = JSON.parse(token); } catch { /* not for this test */ } }
    next();
  });
  a.use('/assistant', assistantRouter);
  return a;
}

const authAs = (role) => `Bearer ${JSON.stringify({ id: '507f1f77bcf86cd799439011', role })}`;

test('transcribe refuses a role the assistant is not enabled for', async () => {
  await request(app()).post('/assistant/transcribe').set('Authorization', authAs('vendor')).expect(403);
});

test('transcribe requires an audio file', async () => {
  await request(app()).post('/assistant/transcribe').set('Authorization', authAs('sales_rep')).expect(400);
});
