/**
 * Every agent this deployment offers.
 *
 * Registering a type is what puts it in the catalogue, so a type nobody
 * imports does not exist — and the failure is silent: the page simply does not
 * list it, and a schedule set against it never fires. Importing them from one
 * place means adding an agent is one line here rather than a thing to remember
 * in two files.
 */
import './unansweredChats.js';
import './missedLeads.js';
