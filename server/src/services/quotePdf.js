import PDFDocument from 'pdfkit';

function money(n) {
    return `AED${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateFmt(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function renderQuotePdf({ quote }) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const row = (k, v) => {
            doc.font('Helvetica-Bold').fontSize(10).text(k, { continued: true });
            doc.font('Helvetica').text(` ${v || '-'}`);
            doc.moveDown(0.2);
        };

        doc.font('Helvetica-Bold').fontSize(18).text('QUOTE', { align: 'center' });
        doc.moveDown(0.4);
        row('Quote Number:', quote.quoteNo);
        row('Quote Date:', dateFmt(quote.quoteDate));
        row('Creation Date:', dateFmt(quote.creationDate));
        row('Salesperson:', quote.salesperson || '-');
        row('Expiry Date:', dateFmt(quote.expiryDate));
        row('PDF Template:', quote.pdfTemplate || 'Standard Template');

        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').fontSize(12).text('Customer Details');
        doc.moveDown(0.3);
        row('Name:', quote.customer?.fullName || '-');
        row('Billing Address:', quote.billingAddress || '-');
        row('Shipping Address:', quote.shippingAddress || '-');

        if (quote.subject) {
            doc.moveDown(0.3);
            row('Subject:', quote.subject);
        }

        doc.moveDown(0.7);
        doc.font('Helvetica-Bold').fontSize(11).text('Items');
        doc.moveDown(0.3);

        const headers = ['S.No', 'Item', 'Qty', 'Rate', 'Discount', 'Amount'];
        const widths = [38, 250, 45, 70, 60, 70];
        let x = doc.x;
        headers.forEach((h, idx) => {
            doc.font('Helvetica-Bold').fontSize(9).text(h, x, doc.y, { width: widths[idx] });
            x += widths[idx];
        });
        doc.moveDown(0.6);

        (quote.items || []).forEach((it, idx) => {
            const y = doc.y;
            const values = [
                String(idx + 1),
                it.itemDetails || '-',
                String(it.quantity ?? 0),
                money(it.rate),
                `${Number(it.discountPct || 0).toFixed(2)}%`,
                money(it.amount),
            ];
            let cx = doc.x;
            values.forEach((v, i) => {
                doc.font('Helvetica').fontSize(9).text(v, cx, y, { width: widths[i] });
                cx += widths[i];
            });
            doc.moveDown(0.5);
        });

        doc.moveDown(0.8);
        row('Sub Total:', money(quote.subTotal));
        row('Adjustment:', Number(quote.adjustment || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        row('Total:', money(quote.total));

        if (quote.notes) {
            doc.moveDown(0.6);
            doc.font('Helvetica-Bold').fontSize(11).text('Notes');
            doc.moveDown(0.2);
            doc.font('Helvetica').fontSize(10).text(quote.notes);
        }

        doc.end();
    });
}
