# Staff app: syncing the call log to the CRM

The CRM side is ready (`/api/calls`). This is what the PurpleBox **staff** app
(Android) needs to do.

## What it sends

`POST https://api.purplebox.ae/api/calls/sync` with the rep's normal login token
(`Authorization: Bearer …`), body:

```json
{ "calls": [
  { "id": "48213", "number": "+971502814305", "type": "outgoing",
    "timestamp": 1792662000000, "duration": 125 }
] }
```

| field | meaning |
|---|---|
| `id` | the call's id in Android's call log (used so a re-sync never counts it twice) |
| `number` | the other party, any format (05…, +971…, 00971…) |
| `type` | `outgoing`, `incoming`, `missed` or `rejected` |
| `timestamp` | call start, milliseconds since epoch |
| `duration` | seconds |

Send up to 500 per request; the reply says how many were saved, ignored and duplicates.
Sending everything is fine: **the server keeps only calls to leads and customers** and
drops the rest without storing them. The app may also filter first.

Optional: after a call to a lead, ask the rep for a one-line note and send it with
`PATCH /api/calls/:id/note { "note": "…" }`. The sync reply's `leadCalls` lists the
saved calls to leads (`id`, `leadId`, `name`, `direction`, `durationSec`, `at`).

## How the app reads the call log

- Android only: iOS does not let apps read call history.
- Permission `READ_CALL_LOG` (runtime permission; ask once with a short why).
- Built in PurpleBoxMobile: a local Expo module (`modules/call-log`) reads the call
  log, `src/lib/callSync.ts` syncs it on open, on return to the app and every ~15 min
  (`expo-background-task`), remembering the last synced timestamp. Needs an EAS build,
  not Expo Go.

## Distribution

Google Play only allows `READ_CALL_LOG` for a few app types (dialers, etc.). A
**company-internal** app is fine: install it as an APK, or through Play's
internal testing track / managed Google Play for the company's devices. A public
Play Store listing with this permission would be rejected.

## What the CRM does with each call

- Matched to a lead by the last 9 digits of the number.
- Outgoing to a lead → a call attempt, exactly like "Log attempt": answered if
  10 seconds or more, otherwise no answer; a New lead moves to Contact attempted;
  the next chase date is set by the follow-up plan.
- Incoming / missed → a line on the lead's activity.
- Calls page (`/calls`): per rep calls made, answered, talk time, leads called,
  incoming, missed; per day; and the latest calls.
