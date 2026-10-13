# Customer app: profile, files, access people, saved cards and auto-pay

All routes need the customer login (`Authorization: Bearer …`) and are under `/api/customer-portal`.

## Complete your profile — `/profile`
| Route | What it does |
|---|---|
| `GET /` | What we hold and the checklist (`items`, `done`, `total`, `percent`). Every step is optional. |
| `POST /email/request` `{email}` · `POST /email/verify` `{email, code}` | Code to that mailbox; verifying marks it proven (`emailVerifiedAt`, `emailFromApp=false`) so it can match the customer's invoices in Zoho Books. |
| `POST /whatsapp/same` | WhatsApp = the login number. Records the opt-in (`whatsappOptIn`, source `app`). |
| `POST /whatsapp/request` `{phone}` · `POST /whatsapp/verify` `{phone, code}` | Another WhatsApp number, proven with a code. |
| `PATCH /details` `{emergencyNumber, nationality, address}` | Plain details. |

`whatsappNumberFor(customer)` (services/profileChecklist.js) is the number WhatsApp messages should use; call it where messages are sent. Logging in with a phone code sets `phoneVerifiedAt`.

## ID documents and files — `/storage/identity`
* `POST` (multipart `file`, `type` = `emirates_id`|`passport`, `side`) saves to the PurpleBox **Google Drive** in the customer's folder, **private** (not "anyone with the link"), and copies the ID onto every live contract (and onto a contract created later by an app booking).
* `GET` lists the customer's current ID files plus anything staff filed for them or their contracts. `GET /:id/file` streams one, only to its owner.

## People who can access a unit — `/storage/contracts/:id/access`
`GET`, `POST {name, phone, relation, idType, idNumber}`, `DELETE /:index`. Writes `Contract.authorizedPersons` (what staff use) and adds a line to the contract timeline. Up to 6 people.

## Saved card and auto-pay — `/autopay`
* `GET /` state · `POST /setup {embedded, enable}` Stripe card-only session · `PATCH / {enabled, consent}` · `DELETE /card`.
* `POST /storage/invoices/:id/pay` now accepts `saveCard` and `autopayConsent`.
* `POST /storage/invoices/:id/pay-sheet` (native payment sheet) answers 404 until `STRIPE_MOBILE_API_VERSION` is set.
* The Stripe webhook now also handles `payment_intent.succeeded` and saves the card from setup / save-card sessions.

### Settings (server `.env`)
| Variable | Meaning |
|---|---|
| `AUTOPAY_ENABLED=true` | Schedules the daily auto-pay job. **Off by default.** |
| `AUTOPAY_DRY_RUN=true` | The job only logs what it would charge. Use this first. |
| `AUTOPAY_HOUR` | Hour (server local time) the job runs. Default 10. |
| `ZOHO_RECORD_ONLINE_PAYMENTS=true` | Also record Stripe payments in Zoho Books (needs `Invoice.zohoBooksSyncId`). Leave off if staff record them by hand. |
| `STRIPE_MOBILE_API_VERSION` | Enables the native payment sheet. Set to the API version the app's Stripe SDK uses. |

Auto-pay only charges customers who switched it on with a saved card, only for invoices already due, once per invoice per day, and switches itself off after 3 failed attempts (the customer is emailed each time). Rules: `services/autopayRules.js`.

Webhook events to subscribe to in Stripe: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `payment_intent.succeeded`, `payment_intent.payment_failed`.
