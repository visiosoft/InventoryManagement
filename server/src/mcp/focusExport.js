import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { responseTimeReport, slowFirstReplies, customersWaitingForReply, followUpList, FOLLOW_UP_LISTS } from './crmTools.js';

/**
 * The sales team's focus lists as one Excel workbook: a tab for how fast they
 * answer, a tab per list of people to chase. Handed out as a short-lived signed
 * link, so Claude can give you a file without any login in the browser.
 */

const secret = () => process.env.MCP_ACCESS_TOKEN || '';
const sign = (exp, days) => crypto.createHmac('sha256', secret()).update(`focus.${exp}.${days}`).digest('hex');

export function signedExportUrl(base, { days = 30, ttlMinutes = 30 } = {}) {
  if (!secret()) return null;
  const exp = Date.now() + ttlMinutes * 60_000;
  return `${base.replace(/\/$/, '')}/api/mcp-export/focus/${exp}/${days}/${sign(exp, days)}.xlsx`;
}

export function verifyExport(exp, days, sig) {
  if (!secret() || !exp || Date.now() > Number(exp)) return false;
  const want = Buffer.from(sign(exp, days));
  const got = Buffer.from(String(sig));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

const SHEET_NAMES = {
  visit_confirmed: 'Visit booked',
  visit_invited_unconfirmed: 'Invited, not confirmed',
  visit_past_no_outcome: 'Visited - no outcome',
  quoted_no_decision: 'Quoted, no decision',
  overdue_followups: 'Overdue follow-ups',
  hot_or_warm_gone_quiet: 'Hot-warm gone quiet',
  no_next_step: 'No next step',
  customers_waiting: 'Waiting for a reply',
};

function addSheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 22 }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  rows.forEach((r) => ws.addRow(r));
  if (!rows.length) ws.addRow({ [columns[0].key]: 'Nobody on this list' });
  return ws;
}

export async function buildFocusWorkbook({ days = 30 } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PurpleBox CRM';
  const rt = await responseTimeReport({ days });
  addSheet(wb, 'Response time', [
    { header: 'Rep', key: 'rep' }, { header: 'Leads', key: 'leads', width: 10 }, { header: 'Answered', key: 'answered', width: 10 },
    { header: 'Never answered', key: 'neverAnswered', width: 15 }, { header: 'Average', key: 'averageReadable', width: 12 }, { header: 'Median', key: 'medianMinutes', width: 12 },
    { header: 'Within 5 min %', key: 'within5MinPct', width: 14 }, { header: 'Within 1 h %', key: 'within1HourPct', width: 14 }, { header: 'Over 24 h %', key: 'over24HoursPct', width: 14 },
  ], [{ rep: 'TEAM', leads: rt.team.leadsConsidered, answered: rt.team.answered, neverAnswered: rt.team.leadsNeverAnswered, averageReadable: rt.team.averageReadable, medianMinutes: rt.team.medianReadable, within5MinPct: rt.team.within5MinPct, within1HourPct: rt.team.within1HourPct, over24HoursPct: rt.team.over24HoursPct }, ...rt.perRep.map((r) => ({ ...r, medianMinutes: r.medianMinutes == null ? '' : `${r.medianMinutes} min` }))]);

  const slow = await slowFirstReplies({ days, overMinutes: 60, limit: 200 });
  addSheet(wb, 'Slow first replies', [
    { header: 'Name', key: 'name' }, { header: 'Phone', key: 'phone' }, { header: 'Rep', key: 'rep' }, { header: 'Status', key: 'status' },
    { header: 'Waited', key: 'waited', width: 14 }, { header: 'Still unanswered', key: 'stillUnanswered', width: 16 }, { header: 'Assigned at', key: 'assignedAt', width: 26 },
  ], slow.rows.map((r) => ({ ...r, stillUnanswered: r.stillUnanswered ? 'YES' : '' })));

  for (const key of Object.keys(FOLLOW_UP_LISTS)) {
    const l = await followUpList({ list: key, limit: 200 });
    addSheet(wb, SHEET_NAMES[key], [
      { header: 'Name', key: 'name' }, { header: 'Phone', key: 'phone' }, { header: 'Rep', key: 'rep' }, { header: 'Status', key: 'status' }, { header: 'Why', key: 'why', width: 60 },
    ], l.rows || []);
  }
  return wb;
}
