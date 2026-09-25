import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerForBucket, defaultAgent, routeFirstOwner, handoffFor, withinBudget } from './team.js';

const aisha = { _id: 'a', name: 'Aisha', mode: 'shadow', isActive: true, ownsBuckets: ['new', 'engaged'], languages: ['en', 'ar'], whatsappNumbers: ['97143293924'], isDefault: true };
const omar = { _id: 'o', name: 'Omar', mode: 'shadow', isActive: true, ownsBuckets: ['quiet', 'dormant'] };
const layla = { _id: 'l', name: 'Layla', mode: 'shadow', isActive: true, ownsBuckets: ['quoted', 'booking'] };
const sam = { _id: 's', name: 'Sam', mode: 'off', isActive: true, ownsBuckets: ['tenant'] };
const team = [aisha, omar, layla, sam];

test('a bucket has one owner, and an agent that is off duty owns nothing', () => {
    assert.equal(ownerForBucket(team, 'quiet').name, 'Omar');
    assert.equal(ownerForBucket(team, 'quoted').name, 'Layla');
    assert.equal(ownerForBucket(team, 'tenant'), null, 'Sam is off duty');
    assert.equal(ownerForBucket(team, 'lost'), null, 'nobody claims Lost');
});

test('a new lead goes to whoever owns New, and the default catches the rest', () => {
    assert.equal(routeFirstOwner(team, {}).name, 'Aisha');
    const noNewOwner = [omar, layla];
    assert.equal(routeFirstOwner(noNewOwner, {}).name, 'Omar', 'first on duty when nobody is flagged default');
    assert.equal(defaultAgent(team).name, 'Aisha');
});

test('routing signals are checked in order: tenant, number, language', () => {
    const samOn = { ...sam, mode: 'shadow' };
    assert.equal(routeFirstOwner([aisha, omar, layla, samOn], { isTenant: true }).name, 'Sam');
    assert.equal(routeFirstOwner(team, { isTenant: true }).name, 'Aisha', 'tenant rule falls through while Sam is off');
    const arabicAgent = { _id: 'r', name: 'Rania', mode: 'shadow', isActive: true, ownsBuckets: [], languages: ['ar'] };
    assert.equal(routeFirstOwner([aisha, arabicAgent], { language: 'ar' }).name, 'Aisha', 'Aisha lists Arabic too and comes first');
    assert.equal(routeFirstOwner([arabicAgent, aisha], { language: 'ar' }).name, 'Rania');
    assert.equal(routeFirstOwner(team, { businessNumber: '+971 4 329 3924' }).name, 'Aisha');
});

test('no agents on duty means no owner, not a crash', () => {
    assert.equal(routeFirstOwner([sam], {}), null);
    assert.equal(routeFirstOwner([], {}), null);
});

test('entering a bucket someone else owns hands the lead over', () => {
    const to = handoffFor(team, { currentAgentId: 'a', bucketBefore: 'engaged', bucketAfter: 'quoted', event: 'quote_sent' });
    assert.equal(to.name, 'Layla');
    const toOmar = handoffFor(team, { currentAgentId: 'a', bucketBefore: 'engaged', bucketAfter: 'quiet', event: 'silence' });
    assert.equal(toOmar.name, 'Omar');
});

test('coming back to Engaged never changes hands, and neither does going to a person', () => {
    assert.equal(handoffFor(team, { currentAgentId: 'o', bucketBefore: 'quiet', bucketAfter: 'engaged', event: 'inbound' }), null);
    assert.equal(handoffFor(team, { currentAgentId: 'l', bucketBefore: 'quoted', bucketAfter: 'with_person', event: 'escalate' }), null);
});

test('a move inside an agent\'s own buckets is not a handoff', () => {
    assert.equal(handoffFor(team, { currentAgentId: 'l', bucketBefore: 'quoted', bucketAfter: 'booking', event: 'confirmed' }), null);
    assert.equal(handoffFor(team, { currentAgentId: 'o', bucketBefore: 'quiet', bucketAfter: 'dormant', event: 'exhausted' }), null);
});

test('a bucket nobody owns leaves the lead with its current agent', () => {
    assert.equal(handoffFor(team, { currentAgentId: 'o', bucketBefore: 'dormant', bucketAfter: 'lost', event: 'exhausted' }), null);
});

test('a budget of zero means no budget', () => {
    assert.equal(withinBudget({ dailyBudgetAed: 0 }, 999), true);
    assert.equal(withinBudget({ dailyBudgetAed: 40 }, 39.5), true);
    assert.equal(withinBudget({ dailyBudgetAed: 40 }, 40), false);
});
