# Claude connector for the PurpleBox CRM (MCP, read-only)

Lets Claude answer questions from the live CRM: how fast the sales team replies,
who is waiting, who to chase, quotes, invoices, payments, contracts.

## Turn it on (server)
1. Make a long random secret: `openssl rand -hex 32`
2. Set it on the server as `MCP_ACCESS_TOKEN`. Optional: `PUBLIC_API_URL=https://api.purplebox.ae`
   (used to build the Excel download link). Redeploy.
   Without `MCP_ACCESS_TOKEN` the endpoint answers 503 and does nothing.

## Connect Claude
Endpoint: `https://api.purplebox.ae/api/mcp`

- **Claude app / claude.ai** → Settings → Connectors → Add custom connector →
  URL `https://api.purplebox.ae/api/mcp/<YOUR_TOKEN>` (the token is the password;
  anyone with this URL can read CRM data, so share it like a password).
- **Claude Code**:
  `claude mcp add --transport http purplebox https://api.purplebox.ae/api/mcp --header "Authorization: Bearer <YOUR_TOKEN>"`
- Rotate by changing `MCP_ACCESS_TOKEN` (old URLs stop working at once).

## What it can do (all read-only)
- `response_time_report`, `slow_first_replies`, `customers_waiting_for_reply`
- `people_to_follow_up` (visit booked, invited not confirmed, visited no outcome,
  quoted no decision, overdue follow-ups, hot/warm gone quiet, no next step, waiting)
- `export_focus_workbook` → Excel link (30 min), one tab per list
- `list_invoices`, `pending_payments`, `payments_received`, `list_quotes`, `contract_detail`
- the assistant's lookups, prefixed `crm_`: units, pricing, customers, contracts,
  expiring contracts, tasks, WhatsApp activity, report blocks (occupancy, revenue, funnel, reps)

It cannot create, edit, send or delete anything.

## Privacy
It exposes customer names and phone numbers to whoever holds the token and to
Claude while it answers. Use it on accounts you trust.
