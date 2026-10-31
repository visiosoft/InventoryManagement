import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, playbookOf, cleanPlaybook, promptVersion, agentSystem, cleanTurn, weightedScore, codeChecks, grade, summarizeRun, regressions, gateResults, allPassed, canMoveTo } from '../src/core/playbook.js';
import { storageSeeds } from '../src/core/seeds.js';
import * as sales from '../src/sales.js';
import { shared } from '../src/routes/public.js';

const P = cleanPlaybook(TEMPLATES.self_storage_sales);

/* ---------- playbook ---------- */

test('the self-storage playbook carries the specification: 11 states, 13 actions, weights to 100, 8 automatic fails', () => {
   assert.equal(P.states.length, 11);
   assert.equal(P.actions.length, 13);
   assert.equal(P.rubric.reduce((s, r) => s + r.weight, 0), 100);
   assert.equal(P.rubric.find((r) => r.key === 'accuracy').weight, 25);
   assert.equal(P.autoFails.length, 8);
   assert.deepEqual(P.gates, { corePass: 95, factual: 100, autoFails: 0, avgScore: 90, blind: 90, completion: 90, escalation: 100, maxDrop: 2, blindSample: 20 });
   assert.match(agentSystem({ name: 'PurpleBox' }, P), /book_visit/);
   assert.match(agentSystem({ name: 'PurpleBox' }, P), /never claim something was done/i);
});

test('an organisation without a playbook uses the general one; a saved playbook is cleaned', () => {
   assert.equal(playbookOf({}).template, 'customer_service');
   const p = cleanPlaybook({ ...TEMPLATES.self_storage_sales, actions: [...TEMPLATES.self_storage_sales.actions, { key: 'Bad Key!', label: 'x' }], rubric: [{ key: 'accuracy', label: 'A', weight: 900 }] });
   assert.ok(!p.actions.some((a) => a.key === 'Bad Key!'), 'invalid keys dropped');
   assert.equal(p.rubric[0].weight, 100, 'weights capped');
   assert.throws(() => cleanPlaybook({ ...TEMPLATES.self_storage_sales, actions: [{ key: 'answer', label: 'A' }] }), /escalate/);
   assert.notEqual(promptVersion(P), promptVersion({ ...P, contract: `${P.contract} Be brief.` }), 'a contract change is a new version');
   assert.equal(promptVersion(P), promptVersion({ ...P, gates: { ...P.gates, avgScore: 50 } }), 'gates do not change the agent');
});

test('a model turn keeps only known states, actions, fields and media; escalation implies a hand-over', () => {
   const t = cleanTurn({ state: 'price', nba: 'escalate', lead: { estimated_size: { value: '75', confidence: 2 }, made_up: 'x', items: null }, reply: 'Let me check', media: ['facility_tour', 'hack'], actions: [{ type: 'book', detail: 'x' }] }, P);
   assert.equal(t.state, 'price');
   assert.deepEqual(t.lead, { estimated_size: { value: '75', confidence: 1 } });
   assert.deepEqual(t.media, ['facility_tour']);
   assert.equal(t.needsHuman, true);
   assert.equal(t.actions[0].simulated, true);
   assert.equal(cleanTurn({ nba: 'give_discount' }, P).nba, '', 'unknown action not trusted');
});

/* ---------- scoring ---------- */

test('weighted score follows the scorecard weights', () => {
   const all = Object.fromEntries(P.rubric.map((r) => [r.key, 100]));
   assert.equal(weightedScore(all, P.rubric), 100);
   assert.equal(weightedScore({ ...all, accuracy: 0 }, P.rubric), 75, 'accuracy is 25%');
   assert.equal(weightedScore({ ...all, tone: 0 }, P.rubric), 95, 'tone is 5%');
});

test('code catches an invented price, an unauthorised discount and a missed escalation', () => {
   const facts = '50 sq ft: AED 520 per 4 weeks';
   const ok = codeChecks({ out: { reply: 'Our 50 sq ft unit is AED 520 per 4 weeks.', needsHuman: false }, message: 'price 50?', facts });
   assert.deepEqual(ok.autoFails, []);
   const bad = codeChecks({ out: { reply: 'It is AED 480, and I can give you 10% off today.', needsHuman: false }, message: 'price 50?', facts, mustEscalate: true });
   assert.deepEqual(bad.autoFails.sort(), ['invented_price', 'no_escalation', 'unauthorized_discount']);
   assert.deepEqual(codeChecks({ out: { reply: 'We have a 10% off promotion this month.', needsHuman: false }, message: 'offers?', facts: 'Promotion: 10% off first month' }).autoFails, [], 'a listed promotion may be mentioned');
});

test('a reply passes only with no automatic fail, the pass mark, an acceptable action and the hand-over it needed', () => {
   const judge = { scores: Object.fromEntries(P.rubric.map((r) => [r.key, 95])), autoFails: [], nbaOk: true };
   const out = { nba: 'give_price', needsHuman: false };
   assert.equal(grade({ p: P, out, judge, code: { autoFails: [] }, scenario: { nba: ['give_price'] } }).pass, true);
   assert.equal(grade({ p: P, out, judge, code: { autoFails: [] }, scenario: { nba: ['invite_visit'] } }).pass, false, 'wrong action');
   assert.equal(grade({ p: P, out, judge, code: { autoFails: ['invented_price'] }, scenario: {} }).pass, false);
   assert.equal(grade({ p: P, out, judge: { ...judge, autoFails: ['pressure', 'not_a_rule'] }, code: { autoFails: [] }, scenario: {} }).autoFails.join(), 'pressure', 'only the playbook\'s fails count');
   const g = grade({ p: P, out: { nba: 'book_visit', needsHuman: false }, judge, code: { autoFails: [] }, scenario: { nba: ['book_visit'], outcome: 'visit' } });
   assert.equal(g.completed, true);
   assert.equal(grade({ p: P, out, judge, code: { autoFails: [] }, scenario: { mustEscalate: true } }).escalationOk, false);
});

const caseOf = (pass, extra = {}) => ({ scenario: extra.id || String(Math.random()), core: true, factual: true, mustEscalate: false, grade: { pass, score: pass ? 95 : 60, autoFails: pass ? [] : ['invented_price'], factualOk: pass, nbaOk: true, escalationOk: true, completed: null }, ...extra });

test('gates: pending with nothing to measure, failing on any automatic fail, stability against the last run', () => {
   const good = Array.from({ length: 20 }, (_, i) => caseOf(true, { id: `s${i}`, blind: { rating: i < 19 ? 'send' : 'major' } }));
   const s = summarizeRun(good);
   assert.equal(s.corePct, 100); assert.equal(s.blindOkPct, 95);
   let gates = gateResults(s, P.gates);
   assert.equal(gates.find((x) => x.key === 'stability').status, 'pending', 'first run is the baseline');
   assert.equal(gates.find((x) => x.key === 'escalation').status, 'pending', 'no escalation cases: not counted as passed');
   assert.equal(allPassed(gates), false);
   const withEsc = [...good, { ...caseOf(true, { id: 'e1' }), mustEscalate: true, grade: { ...caseOf(true).grade, completed: true } }];
   gates = gateResults(summarizeRun(withEsc), P.gates, { prev: s, regressed: [] });
   assert.equal(allPassed(gates), true);
   const worse = withEsc.map((c, i) => (i < 2 ? caseOf(false, { id: c.scenario }) : c));
   const reg = regressions(withEsc, worse);
   assert.deepEqual(reg, ['s0', 's1']);
   gates = gateResults(summarizeRun(worse), P.gates, { prev: s, regressed: reg });
   for (const k of ['core', 'factual', 'autoFails', 'stability']) assert.equal(gates.find((x) => x.key === k).status, 'fail', k);
});

test('rollout moves one stage at a time, and past shadow only on a fully passing run', () => {
   assert.equal(canMoveTo('sandbox', 'shadow', false).ok, true, 'shadow sends nothing');
   assert.equal(canMoveTo('shadow', 'approval', false).ok, false);
   assert.equal(canMoveTo('shadow', 'approval', true).ok, true);
   assert.equal(canMoveTo('shadow', 'limited', true).ok, false, 'no skipping');
   assert.equal(canMoveTo('limited', 'sandbox', false).ok, true, 'going back is always allowed');
   assert.deepEqual(shared({ rollout: { stage: 'shadow' }, playbook: { ...P, shareContract: false } }), { stage: 'shadow', contract: '' });
   assert.match(shared({ playbook: { ...P, shareContract: true } }).contract, /Never/);
});

test('starter scenarios cover every group of the matrix and use only the playbook\'s actions', () => {
   const seeds = storageSeeds();
   const actions = new Set(P.actions.map((a) => a.key));
   for (const g of P.groups) assert.ok(seeds.some((s) => s.group === g.key), g.key);
   for (const s of seeds) {
      assert.ok(s.nba.length && s.nba.every((k) => actions.has(k)), s.title);
      assert.equal(s.status, 'draft', 'the business approves them');
      assert.equal(s.idealResponse, undefined, 'no invented wording');
      if (s.mustEscalate) assert.ok(s.nba.includes('escalate'), s.title);
   }
   assert.ok(seeds.length >= 70);
});

/* ---------- the sandbox and suite against a fake model ---------- */

function fakeHost({ reply = 'Our 50 sq ft unit is AED 520 per 4 weeks. Would you like to see it?', nba = 'give_price', judged = 95 } = {}) {
   const calls = [];
   return {
      calls,
      facts: async () => ({ text: '50 sq ft: AED 520 per 4 weeks', values: {} }),
      snapshotItems: async () => [],
      modelName: async () => 'anthropic:test',
      connectedReply: async () => ({ reply: 'from their agent', needsHuman: false, tools: ['price_lookup'] }),
      llmFor: (feature) => ({
         json: async ({ user }) => {
            calls.push({ feature, user });
            if (feature === 'agent') return { state: 'price', nba, lead: { estimated_size: { value: '50', confidence: 0.9 } }, reply, media: ['unit_medium'], factsUsed: ['50 sq ft: AED 520'], needsHuman: nba === 'escalate' };
            if (feature === 'observe') return { state: 'price', nba: 'give_price', lead: {} };
            return { scores: Object.fromEntries(P.rubric.map((r) => [r.key, judged])), autoFails: [], nbaOk: true, note: 'ok' };
         },
      }),
   };
}

test('a sandbox turn returns the lead state, action, media and trace; the lead carries forward', async () => {
   const org = { name: 'PB', playbook: P, activeSnapshot: 3 };
   const host = fakeHost();
   const out = await sales.turn(host, org, { message: 'How much is 50 sq ft?', lead: { customer_type: { value: 'Personal', confidence: 0.8 } } });
   assert.equal(out.nba, 'give_price');
   assert.deepEqual(Object.keys(out.lead).sort(), ['customer_type', 'estimated_size']);
   assert.equal(out.trace.media[0].label, 'Medium unit video (50–75 sq ft)');
   assert.equal(out.knowledgeVersion, 3);
   assert.equal(out.model, 'anthropic:test');
   const g = await sales.score(host, org, { message: 'How much is 50 sq ft?', scenario: { nba: ['give_price'] } }, out);
   assert.equal(g.pass, true);
   assert.equal(g.score, 95);
   // A connected organisation can test its own agent; the trainer only observes.
   const c = await sales.turn(host, { ...org, connector: { enabled: true } }, { message: 'hi', agent: 'connected' });
   assert.equal(c.reply, 'from their agent');
   assert.deepEqual(c.trace.tools, ['price_lookup']);
   assert.equal((await sales.turn(host, org, { message: 'hi', agent: 'connected' })).agent, 'Playbook agent', 'no connector: hosted agent');
});

test('an invented price fails the reply even when the model judge liked it', async () => {
   const org = { name: 'PB', playbook: P };
   const host = fakeHost({ reply: 'It is only AED 399 today!' });
   const out = await sales.turn(host, org, { message: 'price 50?' });
   const g = await sales.score(host, org, { message: 'price 50?', scenario: {} }, out);
   assert.equal(g.pass, false);
   assert.deepEqual(g.autoFails, ['invented_price']);
});

function memory() {
   let n = 0;
   const coll = () => {
      const rows = [];
      const match = (d, f = {}) => Object.entries(f).every(([k, v]) => (v && typeof v === 'object' && '$in' in v ? v.$in.includes(d[k]) : v && typeof v === 'object' && '$lt' in v ? d[k] < v.$lt : d[k] === v));
      return {
         rows,
         find: async (f) => rows.filter((d) => match(d, f)).map((d) => structuredClone(d)),
         findOne: async (f) => structuredClone(rows.filter((d) => match(d, f)).sort((a, b) => b.createdAt - a.createdAt)[0] || null),
         byId: async (id) => structuredClone(rows.find((d) => d._id === String(id)) || null),
         count: async (f) => rows.filter((d) => match(d, f)).length,
         create: async (d) => { const doc = { _id: String(++n), createdAt: n, ...structuredClone(d) }; rows.push(doc); return doc; },
         updateOne: async (f, u) => { const d = rows.find((x) => match(x, f)); if (d) for (const [k, v] of Object.entries(u.$set || {})) d[k] = v; },
      };
   };
   return { scenarios: coll(), runs: coll(), audit: coll() };
}

const settle = async (r) => { for (let i = 0; i < 100 && r.runs.rows.some((x) => x.status !== 'done'); i++) await new Promise((ok) => setTimeout(ok, 5)); };

test('the suite runs approved scenarios only, records versions, sets gates, and finds a regression', async () => {
   const r = memory();
   const org = { name: 'PB', playbook: P, activeSnapshot: 2 };
   await r.scenarios.create({ title: 'Price', group: 'pricing', message: 'How much is 50?', nba: ['give_price'], status: 'approved', core: true, factual: true, mustEscalate: false });
   await r.scenarios.create({ title: 'Complaint', group: 'escalation', message: 'My unit was open!', nba: ['escalate'], status: 'approved', core: true, factual: false, mustEscalate: true, outcome: 'escalation' });
   await r.scenarios.create({ title: 'Draft', group: 'pricing', message: 'x', nba: ['give_price'], status: 'draft', core: true });

   const run = await sales.startSuite(r, org, fakeHost(), { scope: 'core' }, { id: 'u', name: 'Mase' });
   assert.equal(run.progress.total, 2, 'drafts are not tested');
   assert.equal(run.promptVersion, promptVersion(P));
   assert.equal(run.knowledgeVersion, 2);
   await settle(r);
   const first = r.runs.rows[0];
   assert.equal(first.status, 'done');
   assert.equal(first.summary.passed, 1, 'the complaint was not handed over');
   assert.equal(first.gates.find((g) => g.key === 'escalation').status, 'fail');
   assert.equal(first.gates.find((g) => g.key === 'stability').status, 'pending');

   await sales.startSuite(r, org, fakeHost({ reply: 'Only AED 100!' }), { scope: 'core' }, { id: 'u' });
   await settle(r);
   const second = r.runs.rows[1];
   assert.deepEqual(second.regressions, [first.cases[0].scenario], 'the price case passed before and fails now');
   assert.equal(second.passedAll, false);
});

test('one-click link: only from this machine, not through a proxy, with the right token; picks the PurpleBox organisation', async () => {
   const { linkAllowed, pickOrg } = await import('../src/routes/link.js');
   const ok = { remote: '127.0.0.1', forwarded: undefined, token: 'abc', expected: 'abc' };
   assert.equal(linkAllowed(ok), true);
   assert.equal(linkAllowed({ ...ok, remote: '203.0.113.9' }), false, 'remote address');
   assert.equal(linkAllowed({ ...ok, forwarded: '203.0.113.9, 127.0.0.1' }), false, 'came through the public proxy');
   assert.equal(linkAllowed({ ...ok, token: 'abd' }), false);
   assert.equal(linkAllowed({ ...ok, expected: '' }), false, 'not set up: refused');
   const orgs = [{ name: 'Acme', slug: 'acme', createdAt: '2026-10-01' }, { name: 'PurpleBox Storage', slug: 'purplebox-storage', createdAt: '2026-10-31' }, { name: 'Purple Box test', slug: 'pb-test', createdAt: '2026-11-01' }];
   assert.equal(pickOrg(orgs, 'purplebox').name, 'PurpleBox Storage', 'the oldest match');
   assert.equal(pickOrg([orgs[0]], 'purplebox'), null);
});
