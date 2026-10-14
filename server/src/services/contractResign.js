import { AiBotConfig, Task, User } from '../models/index.js';
import { pushConfigured, pushToUser } from './push.js';

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/**
 * The check-in date of a signed contract was moved, so the customer has to
 * sign again. Tell the sales rep: a task on their list and a push. Falls back
 * to the person who receives hand-overs, then to an admin, so it never lands
 * on nobody.
 */
export async function notifyResignNeeded({ contract, previousStart, newStart, previousEnd, newEnd, byName = '' }) {
  try {
    let assignee = contract.salesRep ? await User.findById(contract.salesRep).select('_id name email isActive').lean() : null;
    if (!assignee || assignee.isActive === false) {
      const cfg = await AiBotConfig.findOne().select('escalateTo').lean();
      assignee = cfg?.escalateTo ? await User.findById(cfg.escalateTo).select('_id name email isActive').lean() : null;
    }
    if (!assignee || assignee.isActive === false) {
      assignee = await User.findOne({ role: 'admin', isActive: { $ne: false } }).select('_id name email').sort({ createdAt: 1 }).lean();
    }
    if (!assignee) return;

    const who = contract.customer?.fullName || 'Tenant';
    const open = await Task.findOne({ leadId: contract._id, status: { $ne: 'done' }, title: /^Re-sign needed/ }).select('_id').lean();
    if (!open) {
      await Task.create({
        title: `Re-sign needed — ${who}`,
        description: [
          `The dates on ${contract.contractNo} were changed after signing. Check-in: ${fmt(previousStart)} → ${fmt(newStart)}. Check-out: ${fmt(previousEnd)} → ${fmt(newEnd)}.`,
          'The customer signed the old date, so send them the contract to sign again (Contract → Allow re-sign).',
          'The unit stays Reserved until the check-in date arrives and the payment is verified in Zoho.',
        ].join('\n'),
        assignedTo: assignee._id,
        createdByName: byName || 'System',
        leadId: contract._id, leadType: 'contract', leadName: who,
        priority: 'high',
        dueDate: new Date(Date.now() + 864e5),
        assignmentHistory: [{ fromId: null, fromName: '', toId: assignee._id, toName: assignee.name || assignee.email, byId: null, byName: byName || 'System', reason: 'Check-in date changed on a signed contract' }],
      });
    }
    if (pushConfigured()) {
      await pushToUser(assignee._id, {
        title: 'Contract needs re-signing',
        body: `${who}: dates changed (${fmt(newStart)} – ${fmt(newEnd)}). Send the contract to sign again.`,
        url: `/contracts/${contract._id}`,
      });
    }
  } catch (e) {
    console.error('[ContractResign]', e.message);
  }
}
