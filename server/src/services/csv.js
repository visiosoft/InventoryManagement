export function parseCsv(content) {
    const rows = [];
    let row = [];
    let value = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i += 1) {
        const c = content[i];
        const n = content[i + 1];

        if (inQuotes) {
            if (c === '"' && n === '"') {
                value += '"';
                i += 1;
            } else if (c === '"') {
                inQuotes = false;
            } else {
                value += c;
            }
            continue;
        }

        if (c === '"') {
            inQuotes = true;
            continue;
        }

        if (c === ',') {
            row.push(value);
            value = '';
            continue;
        }

        if (c === '\n') {
            row.push(value.replace(/\r$/, ''));
            rows.push(row);
            row = [];
            value = '';
            continue;
        }

        value += c;
    }

    if (value.length || row.length) {
        row.push(value.replace(/\r$/, ''));
        rows.push(row);
    }

    if (!rows.length) return [];
    const headers = rows[0];
    return rows.slice(1).filter((r) => r.some((x) => String(x || '').trim())).map((r) => {
        const obj = {};
        headers.forEach((h, idx) => {
            obj[h] = r[idx] ?? '';
        });
        return obj;
    });
}
