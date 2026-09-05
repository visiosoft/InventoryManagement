import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this file, not the working directory, so the guard holds
// wherever the tests are started from.
const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, '../../..');

/**
 * Agents recommend. They do not send.
 *
 * That is a promise made to the person who approved this feature, and it is
 * one line of code away from being broken by someone doing something helpful.
 * The rule is easy to hold when there are two agents and easy to lose when
 * there are ten, so it is asserted rather than remembered: a WhatsApp or email
 * send may not be reachable from anything under services/agents or from the
 * agents route. Sending happens in the console built for it, where the opt-in
 * and 24-hour checks already live.
 */

/* Not on the list: notifyTaskAssigned. That emails a member of staff about a
 * task on their own board — the same thing a hand-made task does — and never
 * reaches a customer. The promise is about customers. */
const SENDERS = [
   'sendWhatsAppText',
   'sendWhatsAppMedia',
   'sendWhatsAppTemplate',
   'sendWhatsAppLocation',
   'sendMail',
   'send-template',
   'send-quick-reply',
];

function jsFilesIn(dir) {
   const out = [];
   for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) out.push(...jsFilesIn(path));
      else if (name.endsWith('.js') && !name.endsWith('.test.js')) out.push(path);
   }
   return out;
}

test('nothing in the agent code can send a message', () => {
   const files = [...jsFilesIn(HERE), join(SERVER, 'src/routes/agents.js')];
   assert.ok(files.length >= 4, 'expected to actually find the agent files');

   for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const sender of SENDERS) {
         assert.ok(
            !source.includes(sender),
            `${file} reaches ${sender}. Agents recommend; the console sends.`,
         );
      }
   }
});

test('the agent route is admin-only', () => {
   // These lists carry every lead's estimated value, and in time an assessment
   // of the reps themselves. A permission module could be granted to a rep.
   const source = readFileSync(join(SERVER, 'src/routes/agents.js'), 'utf8');
   assert.match(source, /router\.use\(requireAdmin\)/);
});
