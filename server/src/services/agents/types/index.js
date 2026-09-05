/**
 * Every agent this deployment offers.
 *
 * Registering a type is what puts it in the catalogue, so a type nobody
 * imports does not exist — and the failure is silent: the page simply does not
 * list it, and a schedule set against it never fires. Importing them from one
 * place means adding an agent is one line here rather than a thing to remember
 * in three files.
 *
 * Order is the order the catalogue offers them in.
 */
import './missedLeads.js';
import './unansweredChats.js';
import './renewalsAtRisk.js';
import './repCoaching.js';
import './debt.js';
