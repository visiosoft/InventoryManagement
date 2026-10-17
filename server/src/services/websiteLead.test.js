import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { Customer, Lead, LeadRoutingConfig } from '../models/index.js';
import { ingestWebsiteLead } from './websiteLead.js';

const AT = new Date('2026-10-17T07:31:08Z');
const form = (extra = {}) => ({
    full_name: 'Zulfiqar Khan', mobile: '+971 50 123 4567', email: 'z@example.com',
    source_page_name: 'Landing - Local Storage Dubai', source_page: 'https://purplebox.ae/local-self-storage-units-in-dubai',
    unit_size: 'medium', ...extra,
});

/** Deps that record what happened instead of touching a database. */
function fakeDeps({ existing = null, tenant = false, decision = { ownerId: 'rep1', reason: '50% share, 0 of 0 today' } } = {}) {
    const log = { created: null, claims: [], notified: [] };
    return {
        log,
        deps: {
            findLead: async () => existing,
            createLead: async (doc) => { log.created = doc; return { _id: 'new1', ...doc }; },
            claim: async (id, update) => { log.claims.push({ id, update }); return { modifiedCount: 1 }; },
            isTenant: async () => tenant,
            route: async () => decision,
            notify: (lead, ownerId) => { log.notified.push(String(ownerId)); },
        },
    };
}

test('new phone: a lead is created, at the top, and assigned by the rules', async () => {
    const { deps, log } = fakeDeps();
    const out = await ingestWebsiteLead(form(), { at: AT, deps });
    assert.equal(out.created, true);
    assert.equal(log.created.status, 'new');
    assert.equal(log.created.source, 'website');
    assert.deepEqual(log.created.tags, ['website']);
    assert.equal(log.created.leadDateTime, AT);
    assert.equal(log.claims[0].update.$set.owner, 'rep1');
    assert.deepEqual(log.notified, ['rep1']);
});

test('existing lost lead: reopened as New, to the top, reassigned by the rules', async () => {
    const existing = new Lead({
        fullName: 'Zulfiqar khan', phone: '0501234567', phoneNormalized: '971501234567', unitsNeeded: 1,
        status: 'lost', lostReason: 'price', source: 'whatsapp', owner: '6a8d76511e977cdd59eb1745',
        assignedAt: new Date('2026-09-01'), ownerSeenAt: new Date('2026-09-01'), firstResponseAt: new Date('2026-09-01'),
        slaNudgedAt: new Date('2026-09-01'), leadDateTime: new Date('2026-09-01'), tags: ['hot'],
    });
    let saved = false;
    existing.save = async function () { saved = true; return this; };
    // As stored: status was lost before this request.
    existing.isNew = false;
    const { deps, log } = fakeDeps({ existing, decision: { ownerId: 'rep2', reason: 'random pick of 2 available' } });

    const out = await ingestWebsiteLead(form(), { at: AT, deps });
    assert.equal(out.reopened, true);
    assert.equal(saved, true);
    assert.equal(existing.status, 'new');
    assert.ok(existing.isModified('status'));               // the save hook writes stageHistory from this
    assert.equal(existing.lostReason, '');
    assert.equal(existing.leadDateTime, AT);
    assert.equal(existing.source, 'website');
    assert.deepEqual([...existing.tags], ['hot', 'website']);
    for (const f of ['owner', 'assignedAt', 'ownerSeenAt', 'firstResponseAt', 'slaNudgedAt']) assert.equal(existing[f], null, f);
    const notes = existing.timeline.map((t) => t.text);
    assert.match(notes[0], /^Reopened by website form: Landing - Local Storage Dubai \(was lost, lost reason: price, original source: whatsapp\)/);
    assert.match(notes[1], /Landing page: .*\nRequested size: medium/);
    assert.equal(log.claims[0].update.$set.owner, 'rep2');
    assert.equal(log.claims[0].update.$push.timeline.text, 'Assigned by distribution rules — random pick of 2 available');
    assert.deepEqual(log.notified, ['rep2']);
});

test('existing tenant: surfaced as New and tagged existing_customer', async () => {
    const existing = new Lead({ fullName: 'WhatsApp Contact 4441', phone: '971504444441', phoneNormalized: '971504444441', unitsNeeded: 1, status: 'already_customer' });
    existing.isNew = false;
    existing.save = async function () { return this; };
    const { deps } = fakeDeps({ existing, tenant: true });
    const out = await ingestWebsiteLead(form({ mobile: '0504444441' }), { at: AT, deps });
    assert.equal(out.existingCustomer, true);
    assert.equal(existing.status, 'new');
    assert.ok(existing.tags.includes('existing_customer'));
    assert.equal(existing.fullName, 'Zulfiqar Khan');   // the placeholder name takes the form's

    const fresh = fakeDeps({ tenant: true });
    await ingestWebsiteLead(form({ mobile: '0509999999' }), { at: AT, deps: fresh.deps });
    assert.deepEqual(fresh.log.created.tags, ['website', 'existing_customer']);
});

test('nobody on shift: the lead waits unassigned for the sweep', async () => {
    const { deps, log } = fakeDeps({ decision: { ownerId: null, reason: 'nobody is available' } });
    const out = await ingestWebsiteLead(form(), { at: AT, deps });
    assert.equal(out.ownerId, null);
    assert.equal(log.claims.length, 0);
});

test('mobile-only payload is accepted through the public route; no mobile is refused', async () => {
    const { publicLeadRouter } = await import('../routes/movingLeads.js');
    const app = express();
    app.use(express.json());
    app.use('/api/moving-leads/public', publicLeadRouter);

    let created = null;
    const orig = { findOne: Lead.findOne, create: Lead.create, updateOne: Lead.updateOne, cfg: LeadRoutingConfig.findOne, cust: Customer.find };
    const q = (v) => ({ select() { return this; }, lean: async () => v });
    Lead.findOne = async () => null;
    Lead.create = async (doc) => { created = doc; return { _id: 'abc', ...doc }; };
    Lead.updateOne = async () => ({ modifiedCount: 1 });
    LeadRoutingConfig.findOne = () => q({ enabled: false });
    Customer.find = () => q([]);
    try {
        const ok = await request(app).post('/api/moving-leads/public').send({ mobile: '0501112222' });
        assert.equal(ok.status, 201);
        assert.equal(created.fullName, 'Website lead 2222');
        assert.equal(created.email, '');
        const bad = await request(app).post('/api/moving-leads/public').send({ full_name: 'No Phone' });
        assert.equal(bad.status, 400);
        assert.match(bad.body.error, /mobile/);
    } finally {
        Object.assign(Lead, { findOne: orig.findOne, create: orig.create, updateOne: orig.updateOne });
        LeadRoutingConfig.findOne = orig.cfg;
        Customer.find = orig.cust;
    }
});
