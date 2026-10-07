import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lead } from '../models/index.js';
import { findLeadsOrdered } from './leads.js';

// A just-enough stand-in for Lead.find / countDocuments: the two clauses
// findLeadsOrdered builds ($and, $or, $ne, $nin, $in and plain equality).
const eq = (a, b) => (a === null || a === undefined ? b === null : a === b);
function match(doc, f) {
  return Object.entries(f).every(([k, v]) => {
    if (k === '$and') return v.every((x) => match(doc, x));
    if (k === '$or') return v.some((x) => match(doc, x));
    const val = doc[k];
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('$ne' in v) return !eq(val, v.$ne);
      if ('$nin' in v) return !v.$nin.includes(val);
      if ('$in' in v) return v.$in.includes(val);
    }
    return eq(val, v);
  });
}
function fakeLead(docs) {
  Lead.countDocuments = async (f) => docs.filter((d) => match(d, f)).length;
  Lead.find = (f) => {
    let rows = docs.filter((d) => match(d, f)); let sort = {}; let skip = 0; let lim = Infinity;
    const q = {
      select: () => q, populate: () => q, lean: () => q, allowDiskUse: () => q,
      sort: (s) => { sort = s; return q; }, skip: (n) => { skip = n; return q; }, limit: (n) => { lim = n; return q; },
      then: (res, rej) => {
        const keys = Object.keys(sort);
        const out = [...rows].sort((a, b) => {
          for (const k of keys) {
            const av = a[k] ? +new Date(a[k]) : 0; const bv = b[k] ? +new Date(b[k]) : 0;
            if (av !== bv) return (av - bv) * sort[k];
          }
          return 0;
        }).slice(skip, skip + lim);
        return Promise.resolve(out).then(res, rej);
      },
    };
    return q;
  };
}

const d = (day) => new Date(`2026-10-${day}T09:00:00Z`);
const leads = [
  { _id: 'new-nodate', status: 'new', followUpAt: null, leadDateTime: d('06') },
  { _id: 'later', status: 'follow_up_scheduled', followUpAt: d('28'), leadDateTime: d('01') },
  { _id: 'overdue', status: 'follow_up_scheduled', followUpAt: d('02'), leadDateTime: d('01') },
  { _id: 'soon', status: 'contacted', followUpAt: d('09'), leadDateTime: d('03') },
  { _id: 'won-old-date', status: 'won', followUpAt: d('01'), leadDateTime: d('02') },
  { _id: 'old-nodate', status: 'contacted', followUpAt: null, leadDateTime: d('04') },
];
const ids = (rows) => rows.map((r) => r._id);
const run = (skip, limit, key = 'followUp') => findLeadsOrdered({}, key, { skip, limit });

test('follow-up sort: soonest first with overdue on top, then leads with no date, newest first', async () => {
  fakeLead(leads);
  assert.deepEqual(ids(await run(0, 50)), ['overdue', 'soon', 'later', 'new-nodate', 'old-nodate', 'won-old-date']);
});

test('a closed lead with an old follow-up date is treated as having none', async () => {
  fakeLead(leads);
  const all = ids(await run(0, 50));
  assert.ok(all.indexOf('won-old-date') > all.indexOf('later'));
});

test('paging crosses from dated to undated leads without repeating or dropping any', async () => {
  fakeLead(leads);
  const pages = [...(await run(0, 2)), ...(await run(2, 2)), ...(await run(4, 2))];
  assert.deepEqual(ids(pages), ['overdue', 'soon', 'later', 'new-nodate', 'old-nodate', 'won-old-date']);
  assert.deepEqual(ids(await run(3, 2)), ['new-nodate', 'old-nodate']);
});

test('the default sort is unchanged: newest first', async () => {
  fakeLead(leads);
  assert.deepEqual(ids(await run(0, 50, 'newest')), ['new-nodate', 'old-nodate', 'soon', 'won-old-date', 'later', 'overdue']);
});
