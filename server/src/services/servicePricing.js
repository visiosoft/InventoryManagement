/* Prices and capacity for valet services booked from the customer app.
 *
 * PLACEHOLDERS: every number below is a stand-in until PurpleBox sets the
 * real prices and how many vans and workers a day can take. They live here,
 * on the server, so the app only ever shows what the server will quote —
 * the app reads them from GET /services/catalog and never prices on its own.
 */
export const SERVICE_PRICES = {
  pickup: 250,          // service fee, collect from the customer
  dropoff: 250,         // service fee, deliver stored items back
  both: 450,            // both in one trip
  box: 10,              // handling per box collected
  bulky: 40,            // per furniture / bulky piece collected
  deliveredItem: 30,    // per stored item delivered
  eveningSlot: 50,      // 18:00 – 20:00 surcharge
  workerHourly: 50,
  workerMinHours: 1,
  workerMaxHours: 12,
  supplyBox: 10,        // per packing box (labels included)
  supplyDelivery: 50,
};

export const CAPACITY = {
  slotCapacity: 3,      // vans per two-hour slot
  workers: 2,           // workers on shift at any half hour
};

export const SLOTS = [
  { id: '08-10', label: '08:00 – 10:00', evening: false },
  { id: '10-12', label: '10:00 – 12:00', evening: false },
  { id: '12-14', label: '12:00 – 14:00', evening: false },
  { id: '14-16', label: '14:00 – 16:00', evening: false },
  { id: '16-18', label: '16:00 – 18:00', evening: false },
  { id: '18-20', label: '18:00 – 20:00', evening: true },
];
export const slotById = (id) => SLOTS.find((s) => s.id === id) || null;

// The worker helps at the customer's unit during facility hours. A booking
// has to finish by closing, not just start before it.
export const WORKER_HOURS = {
  firstStart: '08:00', lastEnd: '20:00', stepMinutes: 30, closedWeekdays: [0],
  minHours: SERVICE_PRICES.workerMinHours, maxHours: SERVICE_PRICES.workerMaxHours,
};

export const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const fromMinutes = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Every half hour a worker could start, regardless of length.
export function workerStartTimes() {
  const out = [];
  const last = toMinutes(WORKER_HOURS.lastEnd) - WORKER_HOURS.stepMinutes;
  for (let m = toMinutes(WORKER_HOURS.firstStart); m <= last; m += WORKER_HOURS.stepMinutes) out.push(fromMinutes(m));
  return out;
}

export const workerEndTime = (startTime, hours) => fromMinutes(toMinutes(startTime) + hours * 60);

// Dubai has no daylight saving, so "today" there is simply UTC+4. Dates are
// compared as 'YYYY-MM-DD' strings, which sort the same as the days do.
export const dubaiToday = (now = Date.now()) => new Date(now + 4 * 3_600_000).toISOString().slice(0, 10);
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Rejects 2026-02-30 as well as 'soon': a real day round-trips unchanged.
export const isDateString = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
export const workerClosed = (date) => WORKER_HOURS.closedWeekdays.includes(weekday(date));

/* What the app quotes. Line labels are shown to the customer as-is.
 * `counts` = { boxes, bulky } collected, `items` delivered, `supplyBoxes`,
 * `evening` and `hours` — whichever apply to the type. */
export function estimateFor(type, { boxes = 0, bulky = 0, items = 0, supplyBoxes = 0, evening = false, hours = 0 } = {}) {
  const P = SERVICE_PRICES;
  const lines = [];
  const add = (label, amount) => lines.push({ label, amount });
  const collects = type === 'pickup' || type === 'both';
  const delivers = type === 'dropoff' || type === 'both';

  if (type === 'worker') {
    add(`Worker · ${hours} h × AED ${P.workerHourly}`, hours * P.workerHourly);
  } else if (type === 'supplies') {
    add(`Boxes & labels × ${supplyBoxes}`, supplyBoxes * P.supplyBox);
    add('Delivery', P.supplyDelivery);
  } else {
    add('Service fee', P[type]);
    if (collects && boxes > 0) add(`Boxes × ${boxes}`, boxes * P.box);
    if (collects && bulky > 0) add(`Furniture & bulky × ${bulky}`, bulky * P.bulky);
    if (delivers) add(`Delivered items × ${items}`, items * P.deliveredItem);
  }
  if (type !== 'worker' && evening) add('Evening slot', P.eveningSlot);
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

export const SERVICE_CATALOG = [
  { type: 'supplies', title: 'Boxes & labels', sub: 'Packing boxes and item labels delivered to you', from: SERVICE_PRICES.supplyDelivery },
  { type: 'pickup', title: 'Pickup to storage', sub: 'From your home or office', from: SERVICE_PRICES.pickup },
  { type: 'dropoff', title: 'Drop-off to you', sub: 'Stored items to your door', from: SERVICE_PRICES.dropoff },
  { type: 'both', title: 'Pickup & drop-off', sub: 'Both in one trip', from: SERVICE_PRICES.both },
  { type: 'worker', title: 'Rent a worker', sub: `Help at your unit · AED ${SERVICE_PRICES.workerHourly}/hour, min ${SERVICE_PRICES.workerMinHours} hour`, from: SERVICE_PRICES.workerHourly },
];
