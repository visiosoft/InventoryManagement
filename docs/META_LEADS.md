# Meta ads → PurpleBox CRM lead capture

## Endpoint (no login)

    POST https://api.purplebox.ae/api/public/meta-lead
    Content-Type: application/json

Required: `phone_number` (any format, e.g. `052 700 9622` or `+971527009622`).
Everything else is optional; any extra field is saved on the lead as a note.

```json
{
  "full_name": "Dr Khalil",
  "phone_number": "052 700 9622",
  "email": "khalil@example.com",
  "What are you looking to store?": "Household items/Furniture",
  "Roughly how much space do you need?": "Not sure",
  "When do you need it": "This Month",
  "campaign_name": "Oct storage offer",
  "ad_name": "Video 1",
  "platform": "instagram",
  "form_name": "Storage enquiry"
}
```

Also accepted: form-encoded bodies, and Meta's own shape
`{"field_data":[{"name":"full_name","values":["Dr Khalil"]}, ...]}`.

Responses: `201 {ok, id, merged:false}` new lead · `200 {ok, id, merged:true}`
same phone already a lead (a note is added, no duplicate) · `400` no phone ·
`429` more than 60 requests/minute from one IP.

Optional lock: set `META_LEAD_KEY` on the server and call
`.../meta-lead?key=<value>` (or header `x-api-key`). Unset = fully open.

## What happens to the lead
Source "Meta Ads", tag `meta-ads`, status New, assigned by the normal
distribution rules (sales rep gets the push), answers in the lead's notes.

## Click-to-WhatsApp / Instagram message forms
No API call needed: when the person's form arrives as a WhatsApp message
("I filled out your form…"), the CRM reads Full name / Phone / Email and the
other answers and fills the lead automatically.

## Connecting it from Meta
Meta does not post to an arbitrary URL by itself. Use one of:
1. **Zapier / Make / Pabbly** (easiest): trigger "Facebook Lead Ads – New Lead",
   action "Webhooks – POST" to the URL above, map the form fields.
2. **Developer**: subscribe the Facebook Page to the `leadgen` webhook, fetch the
   lead from the Graph API with the leadgen_id, then POST `field_data` here.

Test: `curl -X POST URL -H 'Content-Type: application/json' -d '{"full_name":"Test","phone_number":"0501234567"}'`
(then delete the test lead).
