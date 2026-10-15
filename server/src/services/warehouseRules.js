export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

export function normalizeBarcode(value) {
  if (typeof value !== 'string' || !/^PBX-[A-Z0-9-]{3,90}$/.test(value.trim().toUpperCase())) fail('Barcode not recognized. Scan again or search inventory.');
  return value.trim().toUpperCase();
}

export function nextAction(container) {
  if (container.currentStatus === 'DISPATCHED') return 'Dispatched to the customer.';
  if (container.currentStatus === 'CREATED') return 'Scan this label to receive the item.';
  if (!container.photoCount) return 'Photograph the item before putaway.';
  if (['RECEIVED', 'AWAITING_PUTAWAY'].includes(container.currentStatus)) return 'Scan a storage location to confirm putaway.';
  return 'In storage. A supervisor authorization is required to relocate this item.';
}

/** The one-way trip out — a customer picking their item back up. Any active
 *  status can be dispatched (it doesn't have to have made it to a shelf
 *  first); once dispatched, that's final. */
export function validateDispatch(item, location) {
  if (!location) fail('Scan a dispatch point first.');
  if (String(item.site) !== String(location.site) || item.warehouse !== location.warehouse) fail('WRONG LOCATION: the item and dispatch point belong to different warehouses.', 409);
  if (location.kind !== 'DISPATCH') fail('Select a dispatch location.');
  if (item.currentStatus === 'DISPATCHED') fail('ALREADY SCANNED: this item has already been dispatched.', 409);
}

export function validateMovement(item, location, action, supervisor) {
  if (!location) fail('Scan a destination location first.');
  if (String(item.site) !== String(location.site) || item.warehouse !== location.warehouse) fail('WRONG LOCATION: the item and location belong to different warehouses.', 409);
  if (!['SHELF', 'BIN', 'RACK'].includes(location.kind)) fail('Select a rack, shelf or bin for storage.');
  if (item.currentLocation === location._id) fail('ALREADY SCANNED: item is already at this location.', 409);
  if (action === 'RELOCATE') {
    if (!supervisor) fail('Supervisor permission required.', 403);
    if (item.currentStatus !== 'IN_STORAGE') fail('Only stored items can be relocated.', 409);
  } else if (!['RECEIVED', 'AWAITING_PUTAWAY'].includes(item.currentStatus)) {
    fail('NO ACTIVE MOVEMENT AUTHORIZATION: receive this item first, or ask a supervisor to relocate it.', 409);
  }
  if (!item.photoCount) fail('Take a condition photo before putaway.', 409);
  for (const [max, used, amount, label] of [
    ['maxContainers', 'usedContainers', 1, 'container'],
    ['maxWeight', 'usedWeight', item.weight, 'weight'],
    ['maxVolume', 'usedVolume', item.volume, 'volume'],
  ]) {
    if (location[max] != null && amount == null) fail(`Record the item ${label} before using a location with a ${label} limit.`);
    if (location[max] != null && location[used] + amount > location[max] + 1e-9) fail(`Location ${label} capacity exceeded.`, 409);
  }
}

export function photoMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  fail('Use a JPEG, PNG or WebP photo.');
}
