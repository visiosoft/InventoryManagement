/**
 * Every walkthrough, as data.
 *
 * Adding one means adding an entry here and a `data-tour` attribute on whatever
 * it points at — no new components, no changes to the engine.
 *
 * A step with a `route` navigates first, then waits for its target. A step with
 * no `target` is centred on the screen, which suits an opening or closing note.
 */

export type WalkthroughStep = {
  /** Navigate here before showing the step. Omit to stay on the current page. */
  route?: string
  /** Matched against [data-tour="…"]. Omit for a centred message. */
  target?: string
  title: string
  body: string
  /** Preferred side; the engine flips it when there is no room. */
  placement?: 'top' | 'bottom' | 'left' | 'right'
}

export type Walkthrough = {
  id: string
  title: string
  summary: string
  /** Roles this is meant for. Empty means everyone. */
  roles?: string[]
  steps: WalkthroughStep[]
}

export const WALKTHROUGHS: Walkthrough[] = [
  {
    id: 'book-a-unit',
    title: 'Book a unit',
    summary: 'Take someone from an enquiry to a signed contract without leaving one page.',
    // No roles: booking is a sales rep's core job, and an admin needs to know
    // what a rep is looking at when they ask about it.
    steps: [
      {
        title: 'Booking a unit, start to finish',
        body: 'Booking runs as five steps on a single page — customer, units, quotation, contract, then invoice and payment. It saves as you go, so you can stop halfway and pick it up later from the same place. This shows you what each step wants from you.',
      },
      {
        route: '/quotes',
        target: 'booking-new',
        title: 'Every booking starts here',
        body: 'Book Unit lists every booking in progress along with the finished ones. New Booking starts a fresh one. To carry on with a half-finished booking, open it from the list instead — it reopens on the step you left it on.',
      },
      {
        route: '/quotes/new',
        target: 'booking-stepper',
        title: 'The five steps',
        body: 'This strip is the whole job. It fills in green behind you as each step is done, and you can click back to any step you have already finished. It will not let you skip ahead to one you have not reached.',
      },
      {
        target: 'booking-step-customer',
        title: '1. Customer',
        body: 'Search for an existing tenant before creating one — duplicates here are what break the Zoho payment matching later, since that matches on email and phone. If the booking came from a lead, pick the lead and their details come across with it.',
      },
      {
        target: 'booking-step-units',
        title: '2. Units',
        body: 'Pick the unit or units being rented. Only what is genuinely free for your dates is offered, and a booking can hold more than one unit. The size you choose here drives the price on the next step.',
      },
      {
        target: 'booking-step-quote',
        title: '3. Quotation',
        body: 'Pricing, add-ons and any discount. A month is 28 days and the weekly figure is the monthly price divided by four, so the totals will not match a calendar month. A discount applies to the first four weeks only. You can send the quote to the customer from here.',
      },
      {
        target: 'booking-step-contract',
        title: '4. Contract',
        body: 'Turns the accepted quote into a real contract. From here you can send it for signature, or capture a signature in person. Nothing is committed until this step — up to now it is only a quote.',
      },
      {
        target: 'booking-step-invoice',
        title: '5. Invoice and payment',
        body: 'The first invoice always collects four weeks in advance. Raise it, mark it sent, record what the customer paid, and attach the receipt. This is also the step that unlocks approval.',
      },
      {
        title: 'Then it goes for approval',
        body: 'Send for Approval stays disabled until three things are true: the invoice is marked sent, a payment is recorded, and a receipt is uploaded. The page lists whichever are still missing. An admin then approves it, and only then does the booking become a live contract under Tenants.',
      },
      {
        title: 'That is the whole flow',
        body: 'Replay this any time from Walkthroughs in your profile menu. If a booking ever seems stuck, it is almost always one of the three approval conditions above.',
      },
    ],
  },
  {
    id: 'contract-expiry-reminders',
    title: 'Set up contract expiry reminders',
    summary: 'Email tenants automatically before their contract ends, and let them answer in one click.',
    roles: ['admin'],
    steps: [
      {
        title: 'Reminding tenants their contract is ending',
        body: 'Six settings decide whether these emails go out, spread across three pages. One of them is easy to miss, and while it is set nothing sends at all. This walks you through them in the order they have to happen. It takes about two minutes.',
      },
      {
        route: '/settings',
        target: 'settings-integrations-email',
        title: 'First, email has to be connected',
        body: 'Reminders can be set to send by email and still send nothing if there is no mail account behind them. If this says connected, you are fine. If not, connect Gmail here first — nothing further will work without it.',
      },
      {
        route: '/settings/automation',
        target: 'automation-channels',
        title: 'What can actually send',
        body: 'These two tell you what is ready right now. WhatsApp and email are separate: one can be working while the other is not, and a reminder only goes out on a channel that is ready.',
      },
      {
        target: 'automation-rule-expiry',
        title: 'The Contract Expiry rule',
        body: 'This is the rule that watches end dates. Its steps say when to write — seven days before, then three. You can change those numbers, or add another step.',
      },
      {
        target: 'automation-rule-email',
        title: 'Turn email on for the rule',
        body: 'A rule can be switched on while its email channel is off, which sends WhatsApp only. This is the switch that decides whether the email version goes out.',
      },
      {
        route: '/settings/templates',
        target: 'templates-list',
        title: 'What the tenant receives',
        body: 'The Contract Expiring Reminder is the email itself. Its two buttons — renew, or arrange move-out — record the answer against the contract and raise a task for whoever handles hand-overs. The tenant settles it without anyone calling them.',
      },
      {
        route: '/contracts',
        target: 'contracts-list',
        title: 'Now open any contract',
        body: 'Reminders are set per contract as well as globally. Open a contract, then its Reminders tab, and the next step shows you what to look for there.',
      },
      {
        target: 'contract-reminders-mute',
        title: 'This is the one people miss',
        body: 'Every contract starts muted. Rules can be on, email connected, automatic sending enabled — and a muted contract still receives nothing. If a tenant is not getting reminders, check this before anything else.',
      },
      {
        route: '/settings/automation',
        target: 'automation-preview-run',
        title: 'Read it before you send it',
        body: 'A preview run lists exactly what would go out, to whom, on which channel — and sends nothing. Worth doing every time you change a rule. The first live run tends to be larger than people expect.',
      },
      {
        target: 'automation-autosend',
        title: 'Last, switch it on',
        body: 'This is the master switch. While it is off nothing sends automatically, whatever the rules say. Turn it on once the preview looks right, and the engine takes over from there.',
      },
      {
        title: 'That is the whole thing',
        body: 'You can replay this any time from Walkthroughs in your profile menu, and switch walkthroughs off there if you would rather not see them.',
      },
    ],
  },
]

export const walkthroughById = (id: string) => WALKTHROUGHS.find((w) => w.id === id)
