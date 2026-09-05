/**
 * What the agents would find, without running one.
 *
 * Read-only: it opens the database, runs an agent's `collect` and `judge`
 * against the live data and prints the result. Nothing is written — no run, no
 * findings, no messages. The point is to see whether a predicate is right
 * before any of it reaches a screen, because a sweep that quietly returns
 * everybody or nobody looks identical to a working one from the outside.
 *
 *   node scripts/agents-dry-run.mjs unanswered_chats
 *   node scripts/agents-dry-run.mjs unanswered_chats --top 30 --from 2026-08-01
 */
import 'dotenv/config';
import dns from 'node:dns';
import mongoose from 'mongoose';
import { estimateValue, windowOpen } from '../src/services/agents/shared.js';

// Atlas' SRV lookup fails on some networks with the default resolver.
dns.setServers(['8.8.8.8', '1.1.1.1']);

const args = process.argv.slice(2);
const typeKey = args.find((a) => !a.startsWith('--')) || 'unanswered_chats';
const flag = (name, fallback = null) => {
   const i = args.indexOf(`--${name}`);
   return i === -1 ? fallback : args[i + 1];
};
const top = Number(flag('top', 20));

/* The bands the plan was approved against, measured on production on
 * 2026-09-06. A count far outside one of these means a predicate is wrong, and
 * that is much easier to see here than in a list of plausible-looking names. */
const EXPECTED = {
   unanswered_chats: { low: 40, high: 220, note: '113 when the plan was written' },
   missed_leads: { low: 100, high: 700, note: 'dominated by "never quoted"' },
};

const money = (n) => (n == null ? '—' : `AED ${Number(n).toLocaleString('en-GB')}`);

async function main() {
   await mongoose.connect(process.env.MONGODB_URI, {
      dbName: process.env.DB_NAME || 'PurpleBoxNew',
      autoIndex: false,
   });
   console.log(`db: ${mongoose.connection.name}\n`);

   await import('../src/services/agents/types/unansweredChats.js');
   await import('../src/services/agents/types/missedLeads.js');
   const { agentType } = await import('../src/services/agents/engine.js');

   const type = agentType(typeKey);
   if (!type) {
      console.error(`No agent type "${typeKey}".`);
      process.exitCode = 1;
      return;
   }

   // A reporter that prints instead of writing to a run document.
   const report = {
      stage: () => {},
      step: () => {},
      say: (text, level = 'info') => {
         if (level === 'error' || level === 'warn') console.log(`  ${level}: ${text}`);
      },
      flush: async () => {},
      stopped: false,
   };

   const ctx = {
      config: { ...(type.defaults || {}), from: flag('from'), to: flag('to') },
      definition: { _id: null, config: {} },
      report,
      now: new Date(),
      model: 'dry-run',
   };

   console.log(`agent: ${type.label}${type.judges === false ? '  (no model calls)' : ''}`);
   const started = Date.now();
   const rows = await type.collect(ctx);
   console.log(`collected: ${rows.length} in ${((Date.now() - started) / 1000).toFixed(1)}s`);

   const band = EXPECTED[typeKey];
   if (band) {
      const ok = rows.length >= band.low && rows.length <= band.high;
      console.log(`expected:  ${band.low}–${band.high} (${band.note}) → ${ok ? 'in range' : 'OUT OF RANGE — check the predicate'}`);
   }

   /* The split is the number that matters. A predicate that has quietly
      swallowed everything, or caught nothing, is obvious here and invisible in
      a list of plausible-looking names. */
   if (rows.some((r) => r.category)) {
      const counts = {};
      const value = {};
      for (const r of rows) {
         counts[r.category] = (counts[r.category] || 0) + 1;
         const v = estimateValue({ lead: r.lead, quote: r.quote, contracts: r.contracts }, ctx.people.priceBySize);
         if (v.aed) value[r.category] = (value[r.category] || 0) + v.aed;
      }
      console.log('\nby category:');
      for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
         console.log(`  ${k.padEnd(18)} ${String(n).padStart(4)}   ${money(value[k] || null).padStart(14)} a month`);
      }
      const open = rows.filter((r) => windowOpen(r.thread?.lastInboundAt, ctx.now)).length;
      const optIn = rows.filter((r) => r.lead?.whatsappOptIn?.at || r.customer?.whatsappOptIn?.at).length;
      console.log(`\n  ${open} still inside the 24-hour window`);
      console.log(`  ${optIn} have a recorded WhatsApp opt-in`);
   }

   if (type.judges !== false) {
      console.log('\nJudging is skipped in a dry run — it would spend money. Counts only.\n');
   }

   const findings = [];
   for (const row of rows) {
      // Safe for a deterministic agent; a judging one is counted, not called.
      if (type.judges === false) findings.push(await type.judge(row, ctx));
   }

   if (findings.length) {
      findings.sort((a, b) => b.score - a.score);
      console.log(`\ntop ${Math.min(top, findings.length)} of ${findings.length}:\n`);
      for (const f of findings.slice(0, top)) {
         console.log(`  ${String(f.score).padStart(3)}  ${f.title.slice(0, 32).padEnd(32)} ${money(f.data.valueAed).padStart(12)}  ${f.data.windowOpen ? 'window open  ' : 'window closed'}  ${f.factors[0]}`);
      }

      const withValue = findings.filter((f) => f.data.valueAed);
      const total = withValue.reduce((n, f) => n + f.data.valueAed, 0);
      console.log(`\n  ${withValue.length} of ${findings.length} have an estimated value · ${money(total)} a month in total`);
      console.log(`  ${findings.filter((f) => f.data.windowOpen).length} can still be replied to normally`);
      console.log(`  ${findings.filter((f) => !f.data.subjectId && !f.campaignable).length} could not be matched to a lead or customer`);
   }

   await mongoose.disconnect();
}

main().catch(async (e) => {
   console.error('failed:', e.message);
   await mongoose.disconnect().catch(() => {});
   process.exitCode = 1;
});
