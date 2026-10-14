# Claude connector for the PurpleBox CRM (MCP)

Lets Claude read and act on the live CRM: how fast the sales team replies, who
is waiting, who to chase, and quotes, contracts, invoices, payments, messages.

## Turn it on (server)
1. Make a long random secret: `openssl rand -hex 32`
2. Set it on the server as `MCP_ACCESS_TOKEN`. Optional: `PUBLIC_API_URL=https://api.purplebox.ae`
   (used to build the Excel download link). Redeploy.
   Without `MCP_ACCESS_TOKEN` the endpoint answers 503 and does nothing.

## Connect Claude
Endpoint: `https://api.purplebox.ae/api/mcp`

**Easiest (claude.ai / Claude app):** Settings → Connectors → Add custom connector, URL
`https://api.purplebox.ae/api/mcp` (no token in it), press Connect. A PurpleBox page opens;
enter the access key (`MCP_ACCESS_TOKEN`) once and press Allow. The connector then stays
signed in (30 days, renewed automatically). Changing the key signs everyone out.

- **Claude app / claude.ai** → Settings → Connectors → Add custom connector →
  URL `https://api.purplebox.ae/api/mcp/<YOUR_TOKEN>` (the token is the password;
  anyone with this URL can read CRM data, so share it like a password).
- **Claude Code**:
  `claude mcp add --transport http purplebox https://api.purplebox.ae/api/mcp --header "Authorization: Bearer <YOUR_TOKEN>"`
- Rotate by changing `MCP_ACCESS_TOKEN` (old URLs stop working at once).

## What it can read
- **Analysis and forecasting:** `business_snapshot` (the whole picture), `occupancy_revenue_trend`,
  `conversion_report` (by source and rep, lost reasons), `forecast` (occupancy and revenue,
  low/base/high, with its assumptions; accepts your own renewal rate / new-tenant pace), `cash_forecast`
- **Follow-ups, with the messages:** `lead_followup_file` (one lead: plan, what the rep did, conversation, whose turn),
  `followup_briefing` (a batch of leads each with its latest messages, for Claude to read and prioritise),
  `followup_adherence` (on time / late / missed per rep)
- **Direct data access (read-only):** `describe_data`, `query_data` (any allowed collection: filter, fields, sort, count or aggregation),
  `api_get` (the CRM's own GET API), `connector_status` (build and tool list). Secrets, users, sign-in tokens and the
  audit log are never returned; filters cannot run code or write.
- **Zoho Books** (through the connection the CRM already has): `zoho_outstanding`,
  `zoho_customer_ledger`, `zoho_expenses`
- **WhatsApp analysis:** `whatsapp_reply_time_report` (from real messages: person vs AI, working
  hours vs not, per rep), `whatsapp_volume_report`, `whatsapp_topics_report`, `whatsapp_inbound_sample`
  (customer wording, no names or numbers), plus `crm_whatsapp_activity` / `crm_whatsapp_messages`
- `response_time_report`, `slow_first_replies`, `customers_waiting_for_reply`
- `people_to_follow_up` (visit booked, invited not confirmed, visited no outcome,
  quoted no decision, overdue follow-ups, hot/warm gone quiet, no next step, waiting)
- `export_focus_workbook` → Excel link (30 min), one tab per list
- `list_invoices`, `pending_payments`, `payments_received`, `list_quotes`, `contract_detail`
- the assistant's lookups, prefixed `crm_`: units, pricing, customers, contracts,
  expiring contracts, tasks, WhatsApp activity, report blocks (occupancy, revenue, funnel, reps)

## What it can do (acts immediately unless noted)
- Quotation, contract (with its first draft invoice) and email: `crm_propose_quotation`,
  `crm_propose_contract`, `crm_propose_email` only PREPARE and return a summary;
  `confirm_action` carries it out after you agree.
- `create_invoice`, `record_invoice_payment`, `record_scheduled_payment`, `send_invoice`
- `send_contract_whatsapp` (approved template), `list_message_templates`
- `mark_payment_verified`, `extend_contract`, `update_lead_status`
- `crm_create_lead`, `crm_schedule_follow_up`

All of it goes through the CRM's own API, so numbering, unit holds, Zoho sync and
timelines behave exactly as on the pages. Entries show "Claude (MCP)". It cannot
delete anything. Set `MCP_READ_ONLY=1` to switch every action off.

## Privacy
It exposes customer names and phone numbers to whoever holds the token and to
Claude while it answers. Use it on accounts you trust.
