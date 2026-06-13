import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { connectDb } from './db.js';
import { Contract, Unit } from './models/index.js';

function parseJsonArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function normalizeUnitToken(unitNumber) {
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
        const key = normalizeUnitToken(u.unitNumber);
        if (key && !byNormalized.has(key)) byNormalized.set(key, u.unitNumber);
    }
    return byNormalized;
}

function resolveLocalUnit(unitNumberFromBackup, localUnitSet, localUnitByNormalized) {
    if (!unitNumberFromBackup) return null;
    if (localUnitSet.has(unitNumberFromBackup)) return unitNumberFromBackup;

    const normalized = normalizeUnitToken(unitNumberFromBackup);
    if (!normalized) return null;
    if (localUnitByNormalized.has(normalized)) return localUnitByNormalized.get(normalized);

    const composite = normalized.match(/^(F\d+)-?(\d+)-(\d+)$/);
    if (composite) {
        const floor = composite[1];
        const a = Number(composite[2]);
        const b = Number(composite[3]);
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        for (let n = start; n <= end; n += 1) {
            const candidateKey = `${floor}-${n}`;
            if (localUnitByNormalized.has(candidateKey)) return localUnitByNormalized.get(candidateKey);
        }
    }

    return null;
}

async function run() {
    const input = process.argv[2];
    if (!input) {
        console.error('Usage: node src/generateSkippedContractReport.js <backup-json-path>');
        process.exit(1);
    }

    const backupPath = path.resolve(input);
    if (!fs.existsSync(backupPath)) {
        console.error(`Backup file not found: ${backupPath}`);
        process.exit(1);
    }

    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    const contracts = Array.isArray(backup.contracts) ? backup.contracts : [];
    const units = Array.isArray(backup.units) ? backup.units : [];

    const byBackupId = new Map(units.map((u) => [String(u.id), String(u.unit_number || '')]));

    await connectDb();

    const imported = await Contract.find({ source: 'import_json' }).select('externalId');
    const importedSet = new Set(imported.map((x) => String(x.externalId)));

    const localUnits = await Unit.find({}).select('unitNumber');
    const localUnitSet = new Set(localUnits.map((u) => String(u.unitNumber)));
    const localUnitByNormalized = buildLocalUnitLookup(localUnits);

    const skipped = [];

    for (const c of contracts) {
        const contractId = String(c.id || '');
        if (importedSet.has(contractId)) continue;

        const unitIds = parseJsonArray(c.unit_ids).map((x) => String(x));
        const mappedUnitNumbers = unitIds.map((id) => byBackupId.get(id)).filter(Boolean);
        const matchedLocalUnits = mappedUnitNumbers.map((n) => resolveLocalUnit(n, localUnitSet, localUnitByNormalized)).filter(Boolean);

        let reason = 'Unknown';
        if (!unitIds.length) reason = 'No unit_ids in backup contract';
        else if (!mappedUnitNumbers.length) reason = 'unit_ids do not resolve to backup unit_number';
        else if (!matchedLocalUnits.length) reason = 'Mapped backup unit_number not found in local units';
        else reason = 'Not imported for unknown reason';

        skipped.push({
            contract_id: contractId,
            tenant_id: String(c.tenant_id || ''),
            status: String(c.status || ''),
            move_in_date: String(c.move_in_date || ''),
            move_out_date: String(c.move_out_date || ''),
            unit_ids: unitIds,
            mapped_unit_numbers: mappedUnitNumbers,
            matched_local_units: matchedLocalUnits,
            reason,
        });
    }

    skipped.sort((a, b) => Number(a.contract_id) - Number(b.contract_id));

    const outDir = path.resolve('data');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const jsonPath = path.resolve(outDir, 'contract-import-skipped-report.json');
    const csvPath = path.resolve(outDir, 'contract-import-skipped-report.csv');

    fs.writeFileSync(
        jsonPath,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                totalSkipped: skipped.length,
                items: skipped,
            },
            null,
            2
        )
    );

    const esc = (v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    const rows = ['contract_id,tenant_id,status,move_in_date,move_out_date,unit_ids,mapped_unit_numbers,reason'];
    for (const s of skipped) {
        rows.push(
            [
                s.contract_id,
                s.tenant_id,
                s.status,
                s.move_in_date,
                s.move_out_date,
                JSON.stringify(s.unit_ids),
                JSON.stringify(s.mapped_unit_numbers),
                s.reason,
            ]
                .map(esc)
                .join(',')
        );
    }

    fs.writeFileSync(csvPath, rows.join('\n'));

    console.log(
        JSON.stringify(
            {
                totalSkipped: skipped.length,
                jsonPath,
                csvPath,
                sample: skipped.slice(0, 5),
            },
            null,
            2
        )
    );

    await mongoose.disconnect();
}

run().catch((err) => {
    console.error('Skipped contract report generation failed:', err.message);
    process.exit(1);
});
