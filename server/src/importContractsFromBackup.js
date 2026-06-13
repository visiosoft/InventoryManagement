import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { connectDb } from './db.js';
import { Contract, Customer, Unit } from './models/index.js';

function toDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function toNumber(value, fallback = 0) {
    const n = Number(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : fallback;
}

function toBool(value) {
    if (typeof value === 'boolean') return value;
    const s = String(value ?? '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'y'].includes(s);
}

function parseJsonField(value, fallback = null) {
    if (value == null || value === '') return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(String(value));
    } catch {
        return fallback;
    }
}

function normalizeStatus(status) {
    const s = String(status || '').trim().toLowerCase();
    if (s === 'active') return 'active';
    if (s === 'ended' || s === 'cancelled') return 'ended';
    return 'draft';
}

function parseUnitIds(unitIdsRaw) {
    const arr = parseJsonField(unitIdsRaw, []);
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x));
}

function sameDay(a, b) {
    return a && b && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
    if (!aStart || !aEnd || !bStart || !bEnd) return false;
    return aStart <= bEnd && bStart <= aEnd;
}

async function inferUnitFromImportedTenantContracts(customerId, moveIn, moveOut) {
    const existing = await Contract.find({ customer: customerId, source: 'import_json' })
        .populate('unit', 'unitNumber')
        .select('unit startDate endDate');

    const candidates = [];
    for (const c of existing) {
        if (!c.unit?._id) continue;
        if (sameDay(moveIn, c.startDate) || intervalsOverlap(moveIn, moveOut, c.startDate, c.endDate)) {
            candidates.push(c.unit);
        }
    }

    const unique = new Map(candidates.map((u) => [String(u._id), u]));
    if (unique.size === 1) return [...unique.values()][0];
    return null;
}

function mapCustomerFromTenant(tenant) {
    const phones = parseJsonField(tenant.phones, []);
    const phone = Array.isArray(phones) && phones.length ? String(phones[0] || '').trim() : '';

    const accessPersons = parseJsonField(tenant.access_persons, []);
    const accessText = Array.isArray(accessPersons) && accessPersons.length ? ` | Access: ${JSON.stringify(accessPersons)}` : '';

    const identityBits = [
        tenant.client_id ? `ClientID: ${tenant.client_id}` : '',
        tenant.tenant_type ? `TenantType: ${tenant.tenant_type}` : '',
        tenant.nationality ? `Nationality: ${tenant.nationality}` : '',
        tenant.emirates_id ? `EmiratesID: ${tenant.emirates_id}` : '',
        tenant.eid_expiry ? `EIDExpiry: ${tenant.eid_expiry}` : '',
        tenant.passport_number ? `Passport: ${tenant.passport_number}` : '',
        tenant.passport_expiry ? `PassportExpiry: ${tenant.passport_expiry}` : '',
    ]
        .filter(Boolean)
        .join(' | ');

    return {
        fullName: String(tenant.full_name || '').trim() || `Tenant ${tenant.id}`,
        email: String(tenant.email || '').trim(),
        phone,
        address: String(tenant.address || '').trim(),
        company: tenant.tenant_type === 'company' ? String(tenant.full_name || '').trim() : '',
        notes: [identityBits, accessText].filter(Boolean).join(''),
    };
}

function buildUnitMaps(backupUnits) {
    const byBackupId = new Map();
    const byUnitNumber = new Map();

    for (const u of backupUnits || []) {
        const backupId = String(u.id || '').trim();
        const unitNumber = String(u.unit_number || '').trim();
        if (backupId) byBackupId.set(backupId, unitNumber);
        if (unitNumber) byUnitNumber.set(unitNumber, u);
    }

    return { byBackupId, byUnitNumber };
}

function normalizeUnitToken(unitNumber) {
    // Normalize variants like: "F2 - 40", "F2-040", "f2-035", "F1-023", "F1 - ( 25 - 36 )"
    const s = String(unitNumber || '').trim().toUpperCase();
    if (!s) return '';
    const compact = s.replace(/\s+/g, '');
    const m = compact.match(/^(F\d+)-?0*(\d+)$/);
    if (m) return `${m[1]}-${Number(m[2])}`;
    return compact.replace(/[^A-Z0-9\-]/g, '');
}

function buildLocalUnitLookup(localUnits) {
    const byNormalized = new Map();
    for (const u of localUnits) {
        const unitNumber = String(u.unitNumber || '').trim();
        const key = normalizeUnitToken(unitNumber);
        if (key && !byNormalized.has(key)) byNormalized.set(key, u);
    }
    return byNormalized;
}

function resolveLocalUnit(unitNumberFromBackup, localUnitByExact, localUnitByNormalized) {
    if (!unitNumberFromBackup) return null;

    const exact = localUnitByExact.get(unitNumberFromBackup);
    if (exact) return exact;

    const normalized = normalizeUnitToken(unitNumberFromBackup);
    if (!normalized) return null;

    if (localUnitByNormalized.has(normalized)) {
        return localUnitByNormalized.get(normalized);
    }

    // Handle composite references like F1-(25-36) by selecting the first matching member unit.
    const composite = normalized.match(/^(F\d+)-?(\d+)-(\d+)$/);
    if (composite) {
        const floor = composite[1];
        const a = Number(composite[2]);
        const b = Number(composite[3]);
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        for (let n = start; n <= end; n += 1) {
            const candidate = `${floor}-${n}`;
            if (localUnitByNormalized.has(candidate)) return localUnitByNormalized.get(candidate);
        }
    }

    return null;
}

async function run() {
    const input = process.argv[2];
    if (!input) {
        console.error('Usage: node src/importContractsFromBackup.js <backup-json-path>');
        process.exit(1);
    }

    const backupPath = path.resolve(input);
    if (!fs.existsSync(backupPath)) {
        console.error(`Backup file not found: ${backupPath}`);
        process.exit(1);
    }

    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    const tenants = Array.isArray(backup.tenants) ? backup.tenants : [];
    const units = Array.isArray(backup.units) ? backup.units : [];
    const contracts = Array.isArray(backup.contracts) ? backup.contracts : [];

    await connectDb();

    const { byBackupId, byUnitNumber } = buildUnitMaps(units);
    const tenantContractsMap = new Map();
    for (const c of contracts) {
        const tenantId = String(c.tenant_id || '').trim();
        if (!tenantContractsMap.has(tenantId)) tenantContractsMap.set(tenantId, []);
        tenantContractsMap.get(tenantId).push(c);
    }
    const localUnits = await Unit.find({}).select('_id unitNumber price');
    const localUnitByExact = new Map(localUnits.map((u) => [String(u.unitNumber || '').trim(), u]));
    const localUnitByNormalized = buildLocalUnitLookup(localUnits);

    const tenantMap = new Map(tenants.map((t) => [String(t.id), t]));
    const customerByTenantId = new Map();

    let customersCreated = 0;
    let customersMatched = 0;
    let contractsCreated = 0;
    let contractsUpdated = 0;
    let skipped = 0;
    let errors = 0;
    let inferredUnitMatches = 0;

    function inferUnitFromTenantHistory(src, tenantId, moveIn, moveOut) {
        const peers = (tenantContractsMap.get(tenantId) || []).filter((x) => String(x.id || '') !== String(src.id || ''));
        for (const peer of peers) {
            const peerUnitIds = parseUnitIds(peer.unit_ids);
            const peerBackupUnitId = peerUnitIds.length ? peerUnitIds[0] : '';
            const peerBackupUnitNumber = byBackupId.get(peerBackupUnitId) || '';
            const peerLocal = resolveLocalUnit(peerBackupUnitNumber, localUnitByExact, localUnitByNormalized);
            if (!peerLocal) continue;

            const peerStart = toDate(peer.move_in_date);
            const peerEndRaw = toDate(peer.move_out_date);
            const peerEnd = peerEndRaw || (peerStart ? addDays(peerStart, 30) : null);

            if (sameDay(moveIn, peerStart) || intervalsOverlap(moveIn, moveOut, peerStart, peerEnd)) {
                return { localUnit: peerLocal, sourceContractId: String(peer.id || '') };
            }
        }
        return null;
    }

    for (const src of contracts) {
        try {
            const tenantId = String(src.tenant_id || '').trim();
            const tenant = tenantMap.get(tenantId);
            if (!tenant) {
                skipped += 1;
                continue;
            }

            let customerId = customerByTenantId.get(tenantId);
            if (!customerId) {
                const mappedCustomer = mapCustomerFromTenant(tenant);
                const existingCustomer = await Customer.findOne({
                    $or: [
                        { email: mappedCustomer.email || null },
                        { fullName: mappedCustomer.fullName, phone: mappedCustomer.phone || '' },
                    ],
                }).select('_id');

                if (existingCustomer) {
                    customerId = existingCustomer._id;
                    customersMatched += 1;
                } else {
                    const created = await Customer.create(mappedCustomer);
                    customerId = created._id;
                    customersCreated += 1;
                }

                customerByTenantId.set(tenantId, customerId);
            }

            const unitIds = parseUnitIds(src.unit_ids);
            const firstBackupUnitId = unitIds.length ? unitIds[0] : '';
            const unitNumberFromBackup = byBackupId.get(firstBackupUnitId) || '';
            if (!unitNumberFromBackup) {
                skipped += 1;
                continue;
            }

            let localUnit = resolveLocalUnit(unitNumberFromBackup, localUnitByExact, localUnitByNormalized);

            const moveIn = toDate(src.move_in_date);
            const parsedMoveOut = toDate(src.move_out_date);
            let moveOut = parsedMoveOut;

            // Some legacy rows have missing/invalid end date. Preserve them by deriving a minimal valid range.
            if (!moveOut && moveIn) {
                moveOut = src.status === 'ended' ? moveIn : addDays(moveIn, 30);
            }
            if (moveOut && moveIn && moveOut <= moveIn) {
                moveOut = src.status === 'ended' ? moveIn : addDays(moveIn, 30);
            }

            if (!moveIn || !moveOut) {
                skipped += 1;
                continue;
            }

            let inferredFromContractId = '';
            if (!localUnit) {
                const inferred = inferUnitFromTenantHistory(src, tenantId, moveIn, moveOut);
                if (inferred) {
                    localUnit = inferred.localUnit;
                    inferredFromContractId = inferred.sourceContractId;
                    inferredUnitMatches += 1;
                }
            }

            if (!localUnit) {
                const fallbackUnit = await inferUnitFromImportedTenantContracts(customerId, moveIn, moveOut);
                if (fallbackUnit) {
                    localUnit = fallbackUnit;
                    inferredFromContractId = inferredFromContractId || 'imported-tenant-history';
                    inferredUnitMatches += 1;
                }
            }

            if (!localUnit) {
                skipped += 1;
                continue;
            }

            const unitMeta = byUnitNumber.get(unitNumberFromBackup);
            const billingPeriod = src.duration_weeks ? 'weekly' : 'monthly';
            const monthlyRate = toNumber(unitMeta?.price, toNumber(localUnit.price, 0));
            const rate = billingPeriod === 'weekly' ? Number((monthlyRate / 4).toFixed(2)) : monthlyRate;

            const importedNotes = [
                src.notes ? `LegacyNotes: ${src.notes}` : '',
                src.payment_method ? `PaymentMethod: ${src.payment_method}` : '',
                src.duration_weeks ? `DurationWeeks: ${src.duration_weeks}` : '',
                src.tenant_id ? `TenantId: ${src.tenant_id}` : '',
                firstBackupUnitId ? `BackupUnitId: ${firstBackupUnitId}` : '',
                inferredFromContractId ? `InferredUnitFromContractId: ${inferredFromContractId}` : '',
            ]
                .filter(Boolean)
                .join(' | ');

            const payload = {
                customer: customerId,
                unit: localUnit._id,
                billingPeriod,
                rate,
                deposit: 0,
                startDate: moveIn,
                endDate: moveOut,
                autoRenew: toBool(src.auto_renew),
                status: normalizeStatus(src.status),
                paymentMethod: String(src.payment_method || '').trim(),
                firstPaymentDate: toDate(src.first_payment_date),
                nextPaymentDate: toDate(src.next_payment_date),
                signedDocUrl: src.signed_pdf_path ? String(src.signed_pdf_path) : '',
                source: 'import_json',
                externalId: String(src.id || '').trim(),
                importedAt: new Date(),
                raw: src,
                notes: importedNotes,
            };

            const existing = await Contract.findOne({ externalId: payload.externalId });
            if (!existing) {
                const contractNo = `IMP-${String(payload.externalId).padStart(6, '0')}`;
                await Contract.create({ ...payload, contractNo });
                contractsCreated += 1;
            } else {
                Object.assign(existing, payload);
                await existing.save();
                contractsUpdated += 1;
            }

            if (payload.status === 'active') {
                await Unit.findByIdAndUpdate(localUnit._id, { status: 'occupied' });
            }
            if (payload.status === 'ended' || payload.status === 'cancelled') {
                await Unit.findByIdAndUpdate(localUnit._id, { status: 'available' });
            }
        } catch {
            errors += 1;
        }
    }

    console.log(
        `Contract import finished: customersCreated=${customersCreated}, customersMatched=${customersMatched}, contractsCreated=${contractsCreated}, contractsUpdated=${contractsUpdated}, inferredUnitMatches=${inferredUnitMatches}, skipped=${skipped}, errors=${errors}, total=${contracts.length}`
    );

    await mongoose.disconnect();
}

run().catch((err) => {
    console.error('Contract import failed:', err.message);
    process.exit(1);
});
