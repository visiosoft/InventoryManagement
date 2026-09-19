import { createHash } from 'node:crypto';
import { Customer, Contract, Unit, Site } from '../models/index.js';
import { StoredContainer, WarehouseLocation, ScanEvent, WarehouseCounter, ItemPhoto, WarehouseJob, CONTAINER_TYPES, LOCATION_TYPES, WAREHOUSE_JOB_TYPES } from '../models/warehouse.js';
import { fail, normalizeBarcode, nextAction, validateMovement, validateDispatch, photoMime } from './warehouseRules.js';
import { softDelete } from '../utils/softDelete.js';

export const operationalPermission = user => Boolean(user && (user.role === 'admin' || user.permissions?.some(p => ['warehouse', 'warehouse_supervisor'].includes(p))));
export const supervisorPermission = user => Boolean(user && (user.role === 'admin' || user.permissions?.includes('warehouse_supervisor')));
export const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const text = (value, max = 1000) => { if (value == null) return ''; if (typeof value !== 'string' || value.length > max) fail(`Text must be at most ${max} characters.`); return value.trim(); };
const objectId = value => { if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) fail('Invalid customer, booking, unit or facility ID.'); return value; };
const amount = (value, label) => {
  if (value === '' || value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9) fail(`Invalid ${label}.`);
  return value;
};
const warehouseCode = value => { const code = text(value, 32).toUpperCase(); if (!/^[A-Z0-9-]{1,32}$/.test(code)) fail('Enter a warehouse code using letters, numbers and hyphens.'); return code; };

async function code(prefix, session) {
  const counter = await WarehouseCounter.findOneAndUpdate({ _id: prefix }, { $inc: { value: 1 } }, { upsert: true, new: true, session });
  return `PBX-${prefix}-${String(counter.value).padStart(6, '0')}`;
}

function event(ctx, fields) {
  return ScanEvent.create([{ requestId: ctx.requestId, requestHash: ctx.hash,
    employee: ctx.user._id, deviceId: ctx.deviceId, ...fields }], { session: ctx.session });
}

function itemEvent(item, previous, fields) {
  return { barcode: item.displayCode, objectType: item.type, objectId: item._id,
    customer: item.customer, booking: item.booking, site: item.site, warehouse: item.warehouse,
    previousStatus: previous.currentStatus, newStatus: item.currentStatus,
    previousLocation: previous.currentLocation, currentLocation: item.currentLocation, ...fields };
}

// No transaction: this deployment's MongoDB is a standalone server, which
// cannot run one. Each write below still lands (the unique index on
// requestId is what makes a retried command safe to replay, not the
// transaction), but a crash between two of them in the same command — e.g.
// the item saved, the event that logs it not yet written — is possible in a
// way it wouldn't be on a replica set. Acceptable here; not for a deployment
// that needs the stronger guarantee.
export async function command(user, input, operation, run) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid command.');
  const requestId = text(input.requestId, 80);
  if (!/^[a-f0-9-]{36}$/i.test(requestId)) fail('A UUID requestId is required.');
  const hash = createHash('sha256').update(JSON.stringify({ operation, input, actor: String(user._id) })).digest('hex');
  const replay = async () => {
    const existing = await ScanEvent.findOne({ requestId }).lean();
    if (!existing) return null;
    if (existing.requestHash !== hash) fail('Request ID already used for a different command.', 409);
    return { ...existing.result, replayed: true };
  };
  const prior = await replay();
  if (prior) return prior;
  try {
    const ctx = { user, requestId, hash, deviceId: text(input.deviceId, 120) };
    return await run(ctx);
  } catch (error) {
    if (error.code === 11000) { const result = await replay(); if (result) return result; fail('A record with this code already exists.', 409); }
    throw error;
  }
}

export async function createContainers(ctx, input) {
  const customer = await Customer.findById(objectId(input.customer)).session(ctx.session);
  const site = await Site.findById(objectId(input.site)).session(ctx.session);
  if (!customer || !site) fail('Customer or facility not found.', 404);
  let booking = null;
  if (input.booking) {
    booking = await Contract.findById(objectId(input.booking)).session(ctx.session);
    if (!booking || String(booking.customer) !== String(customer._id)) fail('Booking does not belong to this customer.');
  }
  if (input.unit) {
    const unit = await Unit.findById(objectId(input.unit)).session(ctx.session);
    if (!unit || (!unit.site ? !site.isDefault : String(unit.site) !== String(site._id))) fail('Storage unit does not belong to this facility.');
    if (!booking || ![booking.unit, ...(booking.units || [])].some(id => String(id) === input.unit)) fail('Select a booking that contains this storage unit.');
  }
  if (!CONTAINER_TYPES.includes(input.type)) fail('Invalid container type.');
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) fail('Create between 1 and 50 items at a time.');
  const weight = amount(input.weight, 'weight');
  const length = amount(input.length, 'length'), width = amount(input.width, 'width'), height = amount(input.height, 'height');
  const volume = [length, width, height].every(v => v != null) ? length * width * height / 1e6 : null;
  if (volume != null && !Number.isFinite(volume)) fail('Invalid volume.');
  const condition = input.condition || 'GOOD';
  if (!['GOOD', 'WORN', 'DAMAGED'].includes(condition)) fail('Invalid condition.');
  const containers = [];
  for (let i = 0; i < quantity; i++) {
    const prefix = { BOX: 'BX', DOCUMENT_BOX: 'BX', PALLET: 'PLT', TOTE: 'TOT' }[input.type] || 'ITM';
    const [item] = await StoredContainer.create([{
      displayCode: await code(prefix, ctx.session), type: input.type, customer: customer._id,
      booking: booking?._id, unit: input.unit || undefined, site: site._id, warehouse: warehouseCode(input.warehouse),
      description: text(input.description), contents: text(input.contents, 4000), condition,
      weight, length, width, height, volume,
    }], { session: ctx.session });
    await event({ ...ctx, requestId: `${ctx.requestId}:${i}` }, itemEvent(item, {}, { eventType: 'CREATED' }));
    containers.push(item.toObject());
  }
  const result = { containers };
  await event(ctx, { barcode: containers[0].displayCode, objectType: 'BATCH', objectId: ctx.requestId, eventType: 'BATCH_CREATED', customer: customer._id, site: site._id, result });
  return result;
}

export async function createLocation(ctx, input) {
  if (!supervisorPermission(ctx.user)) fail('Supervisor permission required.', 403);
  const site = await Site.findById(objectId(input.site)).session(ctx.session);
  if (!site) fail('Facility not found.', 404);
  const warehouse = warehouseCode(input.warehouse);
  if (!LOCATION_TYPES.includes(input.kind)) fail('Invalid location type.');
  if (input.parent) {
    const parent = await WarehouseLocation.findById(input.parent).session(ctx.session);
    if (!parent || String(parent.site) !== String(site._id) || parent.warehouse !== warehouse) fail('Parent location must be in the same warehouse.');
    const levels = ['WAREHOUSE', 'ZONE', 'AISLE', 'RACK', 'SHELF', 'BIN'];
    if (levels.indexOf(parent.kind) < 0 || (levels.indexOf(input.kind) >= 0 && levels.indexOf(input.kind) <= levels.indexOf(parent.kind))) fail('Choose a parent above this location in the hierarchy.');
  }
  const maxContainers = amount(input.maxContainers, 'maximum containers');
  if (maxContainers != null && (!Number.isInteger(maxContainers) || maxContainers < 1)) fail('Maximum containers must be a positive integer.');
  if (!['RACK', 'SHELF', 'BIN'].includes(input.kind) && [input.maxContainers, input.maxWeight, input.maxVolume].some(v => v != null && v !== '')) fail('Capacity limits apply to storage racks, shelves and bins only.');
  const [location] = await WarehouseLocation.create([{
    displayCode: await code('LOC', ctx.session), name: text(input.name, 120), site: site._id, warehouse,
    kind: input.kind, parent: input.parent || null, maxContainers,
    maxWeight: amount(input.maxWeight, 'maximum weight'), maxVolume: amount(input.maxVolume, 'maximum volume'),
  }], { session: ctx.session });
  const result = { location: location.toObject() };
  await event(ctx, { barcode: location.displayCode, objectType: 'LOCATION', objectId: location._id, eventType: 'LOCATION_CREATED', site: site._id, warehouse, result });
  return result;
}

export async function editLocation(ctx, locationId, input) {
  if (!supervisorPermission(ctx.user)) fail('Supervisor permission required.', 403);
  const location = await WarehouseLocation.findById(locationId).session(ctx.session);
  if (!location) fail('Location not found.', 404);
  const previous = location.toObject();
  if (input.name !== undefined) {
    const name = text(input.name, 120);
    if (!name) fail('Location name is required.');
    location.name = name;
  }
  const capacityGiven = ['maxContainers', 'maxWeight', 'maxVolume'].some(key => input[key] !== undefined);
  if (capacityGiven && !['RACK', 'SHELF', 'BIN'].includes(location.kind)) fail('Capacity limits apply to storage racks, shelves and bins only.');
  if (input.maxContainers !== undefined) {
    const maxContainers = amount(input.maxContainers, 'maximum containers');
    if (maxContainers != null && (!Number.isInteger(maxContainers) || maxContainers < 1)) fail('Maximum containers must be a positive integer.');
    location.maxContainers = maxContainers;
  }
  if (input.maxWeight !== undefined) location.maxWeight = amount(input.maxWeight, 'maximum weight');
  if (input.maxVolume !== undefined) location.maxVolume = amount(input.maxVolume, 'maximum volume');
  await location.save({ session: ctx.session });
  const result = { location: location.toObject() };
  const changes = ['name', 'maxContainers', 'maxWeight', 'maxVolume'].filter(key => previous[key] !== location[key]).map(key => `${key}: ${previous[key] ?? '—'} → ${location[key] ?? '—'}`);
  await event(ctx, { barcode: location.displayCode, objectType: 'LOCATION', objectId: location._id, eventType: 'LOCATION_EDITED', site: location.site, warehouse: location.warehouse, notes: changes.join(', '), result });
  return result;
}

export async function deleteLocation(ctx, locationId) {
  if (!supervisorPermission(ctx.user)) fail('Supervisor permission required.', 403);
  const location = await WarehouseLocation.findById(locationId).session(ctx.session);
  if (!location) fail('Location not found.', 404);
  const [itemCount, childCount] = await Promise.all([
    StoredContainer.countDocuments({ currentLocation: location._id }).session(ctx.session),
    WarehouseLocation.countDocuments({ parent: location._id }).session(ctx.session),
  ]);
  if (itemCount > 0) fail('This location still has items on it. Move them first.', 409);
  if (childCount > 0) fail('This location still has other locations nested under it. Remove those first.', 409);
  await WarehouseLocation.deleteOne({ _id: location._id }, { session: ctx.session });
  const result = { deleted: true };
  await event(ctx, { barcode: location.displayCode, objectType: 'LOCATION', objectId: location._id, eventType: 'LOCATION_DELETED', site: location.site, warehouse: location.warehouse, result });
  return result;
}

export async function editContainer(ctx, containerId, input) {
  const item = await StoredContainer.findById(containerId).session(ctx.session);
  if (!item) fail('Item not found.', 404);
  const previous = item.toObject();
  const measuring = ['weight', 'length', 'width', 'height'].some(key => input[key] !== undefined);
  // Once in storage, the item's weight/volume are already counted against its
  // shelf's usedWeight/usedVolume — changing them here would silently desync
  // that location's capacity from what's actually on it.
  if (measuring && item.currentStatus === 'IN_STORAGE') fail('Weight and dimensions can’t be edited while an item is in storage — relocate it first if the measurements were wrong.', 409);
  if (input.description !== undefined) item.description = text(input.description);
  if (input.contents !== undefined) item.contents = text(input.contents, 4000);
  if (input.condition !== undefined) {
    if (!['GOOD', 'WORN', 'DAMAGED'].includes(input.condition)) fail('Invalid condition.');
    item.condition = input.condition;
  }
  if (measuring) {
    if (input.weight !== undefined) item.weight = amount(input.weight, 'weight');
    if (input.length !== undefined) item.length = amount(input.length, 'length');
    if (input.width !== undefined) item.width = amount(input.width, 'width');
    if (input.height !== undefined) item.height = amount(input.height, 'height');
    item.volume = [item.length, item.width, item.height].every(v => v != null) ? item.length * item.width * item.height / 1e6 : null;
  }
  item.revision += 1;
  await item.save({ session: ctx.session });
  const result = { container: item.toObject() };
  await event(ctx, itemEvent(item, previous, { eventType: 'EDITED', result }));
  return result;
}

export async function deleteContainer(ctx, containerId, input) {
  if (!supervisorPermission(ctx.user)) fail('Supervisor permission required.', 403);
  const item = await StoredContainer.findById(containerId).session(ctx.session);
  if (!item) fail('Item not found.', 404);
  const previous = item.toObject();
  if (item.currentStatus === 'IN_STORAGE' && item.currentLocation) {
    await WarehouseLocation.updateOne(
      { _id: item.currentLocation },
      { $inc: { usedContainers: -1, usedWeight: -(item.weight ?? 0), usedVolume: -(item.volume ?? 0) } },
      { session: ctx.session }
    );
  }
  await softDelete(item, ctx.user._id);
  const result = { deleted: true };
  await event(ctx, itemEvent(item, previous, { eventType: 'DELETED', notes: text(input?.notes, 2000), result }));
  return result;
}

export async function scan(ctx, input) {
  const barcode = normalizeBarcode(input.barcode);
  const action = input.action || 'INSPECT';
  if (!['INSPECT', 'RECEIVE', 'PUTAWAY', 'RELOCATE', 'DISPATCH'].includes(action)) fail('Invalid scan action.');
  const item = await StoredContainer.findOne({ displayCode: barcode }).session(ctx.session);
  const location = item ? null : await WarehouseLocation.findOne({ displayCode: barcode }).session(ctx.session);
  if (!item && !location) {
    const result = { recognized: false, message: 'Barcode not recognized. Scan again, search inventory or register a new object.' };
    await event(ctx, { barcode, objectType: 'UNKNOWN', objectId: barcode, eventType: 'UNKNOWN_SCAN', result });
    return result;
  }
  if (location) {
    if (action !== 'INSPECT') fail('Scan the item label for this action.');
    const result = { recognized: true, objectType: 'LOCATION', location: location.toObject(), nextAction: 'Scan an item to receive or put away.' };
    await event(ctx, { barcode, objectType: 'LOCATION', objectId: location._id, eventType: 'SCANNED', site: location.site, warehouse: location.warehouse, result });
    return result;
  }
  const previous = item.toObject();
  if (action === 'RECEIVE') {
    if (item.currentStatus !== 'CREATED') fail('ALREADY SCANNED: this item has already been received.', 409);
    // A receiving area isn't a meaningful location the way a shelf is — it's
    // just "logged in", and requiring a scan of it on top of the item itself
    // was a second scan for no real proof-of-location value. If one is
    // scanned anyway (older client, or a real reason to be specific) it's
    // still validated; otherwise the warehouse's own receiving area is used
    // automatically, as long as there's exactly one.
    let receiving;
    if (input.locationBarcode) {
      receiving = await WarehouseLocation.findOne({ displayCode: normalizeBarcode(input.locationBarcode) }).session(ctx.session);
      if (!receiving || receiving.kind !== 'RECEIVING' || String(receiving.site) !== String(item.site) || receiving.warehouse !== item.warehouse) fail('Scan a receiving area in this item’s warehouse.', 409);
    } else {
      const candidates = await WarehouseLocation.find({ site: item.site, warehouse: item.warehouse, kind: 'RECEIVING' }).session(ctx.session);
      if (!candidates.length) fail('No receiving area set up for this warehouse yet.', 409);
      if (candidates.length > 1) fail('More than one receiving area exists for this warehouse — scan the correct one.', 409);
      [receiving] = candidates;
    }
    item.currentStatus = item.photoCount ? 'AWAITING_PUTAWAY' : 'RECEIVED';
    item.currentLocation = receiving._id;
  }
  if (['PUTAWAY', 'RELOCATE'].includes(action)) {
    const destination = await WarehouseLocation.findOne({ displayCode: normalizeBarcode(input.locationBarcode) }).session(ctx.session);
    validateMovement(item, destination, action, supervisorPermission(ctx.user));
    if (action === 'RELOCATE' && !text(input.notes, 2000)) fail('Enter a reason for supervisor relocation.');
    // validateMovement already checked capacity against the copy of
    // `destination` just read — friendly and fast, but two scans landing on
    // the same location's last free slot at the same moment could both pass
    // it. With no transaction to serialize them, the increment itself has to
    // re-check capacity atomically: a single conditional update that only
    // applies if the location still has room, so the loser gets a real
    // "capacity exceeded" instead of silently overfilling the location.
    const capacityOk = (field, addField, add) => ({
      $or: [{ [field]: null }, { $expr: { $lte: [{ $add: [`$${addField}`, add] }, `$${field}`] } }],
    });
    const claimed = await WarehouseLocation.findOneAndUpdate(
      {
        _id: destination._id,
        $and: [
          capacityOk('maxContainers', 'usedContainers', 1),
          capacityOk('maxWeight', 'usedWeight', item.weight ?? 0),
          capacityOk('maxVolume', 'usedVolume', item.volume ?? 0),
        ],
      },
      { $inc: { usedContainers: 1, usedWeight: item.weight ?? 0, usedVolume: item.volume ?? 0 } },
      { new: true, session: ctx.session }
    );
    if (!claimed) fail('Location capacity exceeded.', 409);
    if (previous.currentStatus === 'IN_STORAGE') {
      await WarehouseLocation.updateOne({ _id: previous.currentLocation }, { $inc: { usedContainers: -1, usedWeight: -(item.weight ?? 0), usedVolume: -(item.volume ?? 0) } }, { session: ctx.session });
    }
    item.currentLocation = destination._id;
    item.currentStatus = 'IN_STORAGE';
    item.storedAt ||= new Date();
  }
  let dispatchPoint = null;
  if (action === 'DISPATCH') {
    dispatchPoint = await WarehouseLocation.findOne({ displayCode: normalizeBarcode(input.locationBarcode) }).session(ctx.session);
    validateDispatch(item, dispatchPoint);
    if (!text(input.notes, 2000)) fail('Enter who is picking this up or how it was confirmed.');
    if (previous.currentStatus === 'IN_STORAGE' && previous.currentLocation) {
      await WarehouseLocation.updateOne({ _id: previous.currentLocation }, { $inc: { usedContainers: -1, usedWeight: -(item.weight ?? 0), usedVolume: -(item.volume ?? 0) } }, { session: ctx.session });
    }
    // The item's own currentLocation is cleared — it's left the warehouse
    // and isn't "at" the dispatch counter in any lasting sense — but the
    // event log still records which dispatch point saw it leave.
    item.currentLocation = null;
    item.currentStatus = 'DISPATCHED';
  }
  item.lastScanAt = new Date(); item.lastScanBy = ctx.user._id; item.revision += 1;
  await item.save({ session: ctx.session });
  const result = { recognized: true, objectType: item.type, container: item.toObject(), nextAction: nextAction(item) };
  await event(ctx, itemEvent(item, previous, { eventType: action === 'INSPECT' ? 'SCANNED' : action, destinationLocation: dispatchPoint?._id ?? item.currentLocation, notes: text(input.notes, 2000), result }));
  return result;
}

export async function addPhoto(ctx, containerId, buffer) {
  const item = await StoredContainer.findById(containerId).session(ctx.session);
  if (!item) fail('Item not found.', 404);
  if (item.photoCount >= 20) fail('Maximum 20 photos per item.');
  const previous = item.toObject();
  const [photo] = await ItemPhoto.create([{ container: item._id, data: buffer, mimeType: photoMime(buffer), employee: ctx.user._id }], { session: ctx.session });
  item.photoCount += 1; item.revision += 1;
  if (item.currentStatus === 'RECEIVED') item.currentStatus = 'AWAITING_PUTAWAY';
  await item.save({ session: ctx.session });
  const result = { photoId: photo._id, container: item.toObject() };
  await event(ctx, itemEvent(item, previous, { eventType: 'PHOTO_ADDED', result }));
  return result;
}

export async function createWarehouseJob(ctx, input) {
  if (!WAREHOUSE_JOB_TYPES.includes(input.type)) fail('Invalid job type.');
  const site = await Site.findById(objectId(input.site)).session(ctx.session);
  if (!site) fail('Facility not found.', 404);
  const warehouse = warehouseCode(input.warehouse);
  const customer = await Customer.findById(objectId(input.customer)).session(ctx.session);
  if (!customer) fail('Customer not found.', 404);
  const address = text(input.address || customer.address, 500);
  if (!address) fail('Enter the pickup or delivery address.');
  const partnerName = text(input.partnerName, 200);
  const partnerPhone = text(input.partnerPhone, 40);
  let containers = [];
  if (input.type === 'DELIVERY') {
    if (!Array.isArray(input.containers) || !input.containers.length) fail('Select at least one stored item to deliver.');
    containers = await StoredContainer.find({ _id: { $in: input.containers }, customer: customer._id, currentStatus: 'IN_STORAGE' }).session(ctx.session);
    if (containers.length !== input.containers.length) fail('One or more selected items are not currently in storage for this customer.');
  }
  const [job] = await WarehouseJob.create([{
    type: input.type, site: site._id, warehouse, customer: customer._id, address, notes: text(input.notes, 2000),
    partnerName, partnerPhone, status: partnerName ? 'ASSIGNED' : 'REQUESTED',
    containers: containers.map(c => c._id), createdBy: ctx.user._id,
  }], { session: ctx.session });
  const result = { job: job.toObject() };
  await event(ctx, { barcode: job._id, objectType: 'JOB', objectId: job._id, eventType: 'JOB_CREATED', customer: customer._id, site: site._id, warehouse, result });
  return result;
}

export async function updateWarehouseJob(ctx, jobId, input) {
  const job = await WarehouseJob.findById(jobId).session(ctx.session);
  if (!job) fail('Job not found.', 404);
  if (['COMPLETED', 'CANCELLED'].includes(job.status)) fail('This job is already closed.', 409);
  if (input.partnerName !== undefined) job.partnerName = text(input.partnerName, 200);
  if (input.partnerPhone !== undefined) job.partnerPhone = text(input.partnerPhone, 40);
  if (input.notes !== undefined) job.notes = text(input.notes, 2000);
  if (input.address !== undefined) {
    const address = text(input.address, 500);
    if (!address) fail('Enter the pickup or delivery address.');
    job.address = address;
  }
  if (input.addContainers !== undefined) {
    if (!Array.isArray(input.addContainers) || !input.addContainers.length) fail('Select at least one item.');
    const found = await StoredContainer.find({ _id: { $in: input.addContainers }, customer: job.customer }).session(ctx.session);
    if (found.length !== input.addContainers.length) fail('One or more items were not found for this customer.', 404);
    job.containers = [...new Set([...job.containers.map(String), ...found.map(c => String(c._id))])];
  }
  if (input.status) {
    if (!['ASSIGNED', 'COMPLETED', 'CANCELLED'].includes(input.status)) fail('Invalid status.');
    if (input.status === 'COMPLETED') {
      if (!job.containers.length) fail('Link at least one item before marking this job complete.', 409);
      const linked = await StoredContainer.find({ _id: { $in: job.containers } }).session(ctx.session);
      if (job.type === 'PICKUP' && linked.some(c => c.currentStatus === 'CREATED')) fail('These items still need to be received before this pickup can be marked complete.', 409);
      if (job.type === 'DELIVERY' && linked.some(c => c.currentStatus !== 'DISPATCHED')) fail('These items still need to be dispatched before this delivery can be marked complete.', 409);
      job.completedAt = new Date();
    }
    job.status = input.status;
  } else if (job.status === 'REQUESTED' && job.partnerName) {
    job.status = 'ASSIGNED';
  }
  await job.save({ session: ctx.session });
  const result = { job: job.toObject() };
  await event(ctx, { barcode: job._id, objectType: 'JOB', objectId: job._id, eventType: `JOB_${job.status}`, customer: job.customer, site: job.site, warehouse: job.warehouse, notes: text(input.notes, 2000), result });
  return result;
}

export async function logLabels(ctx, input) {
  if (!Array.isArray(input.codes) || !input.codes.length || input.codes.length > 50) fail('Select 1–50 labels.');
  const labels = [];
  for (const value of [...new Set(input.codes)]) {
    const barcode = normalizeBarcode(value);
    const item = await StoredContainer.findOne({ displayCode: barcode }).session(ctx.session);
    const location = item ? null : await WarehouseLocation.findOne({ displayCode: barcode }).session(ctx.session);
    if (!item && !location) fail(`Unknown label: ${barcode}`, 404);
    const previousPrint = await ScanEvent.exists({ barcode, eventType: 'LABEL_PRINT_REQUESTED' }).session(ctx.session);
    if (previousPrint && !supervisorPermission(ctx.user)) fail('Supervisor permission required to reprint labels.', 403);
    const obj = item || location;
    // Serialize competing first-print requests for the same label.
    if (item) { item.revision += 1; await item.save({ session: ctx.session }); }
    else await WarehouseLocation.updateOne({ _id: location._id }, { $inc: { __v: 1 } }, { session: ctx.session });
    labels.push({ code: barcode, type: item?.type || location.kind });
    await event({ ...ctx, requestId: `${ctx.requestId}:${labels.length}` }, { barcode, objectType: item?.type || 'LOCATION', objectId: obj._id, eventType: 'LABEL_PRINT_REQUESTED', site: obj.site, notes: previousPrint ? 'Reprint requested' : 'First print requested' });
  }
  const result = { labels };
  await event(ctx, { barcode: labels[0].code, objectType: 'PRINT_JOB', objectId: ctx.requestId, eventType: 'PRINT_JOB_CREATED', result });
  return result;
}
