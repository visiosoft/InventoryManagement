import PDFDocument from 'pdfkit';

function money(n) {
    return `AED${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateFmt(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function renderInvoicePdf({ invoice }) {
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

        doc.font('Helvetica-Bold').fontSize(18).text('INVOICE', { align: 'center' });
        doc.moveDown(0.5);

        row('Customer Name:', invoice.customer?.fullName || '-');
        row('Invoice #:', invoice.invoiceNo);
        row('Order Number:', invoice.orderNumber || '-');
        row('Invoice Date:', dateFmt(invoice.invoiceDate));
        row('Terms:', invoice.terms || '-');
        row('Due Date:', dateFmt(invoice.dueDate));
        row('Salesperson:', invoice.salesperson || '-');
        row('Bank Information:', invoice.bankInformation || '-');
        row('Subject:', invoice.subject || '-');

        doc.moveDown(0.7);
        doc.font('Helvetica-Bold').fontSize(11).text('Items');
        doc.moveDown(0.3);

        const headers = ['Item Details', 'Quantity', 'Rate', 'Discount', 'Amount'];
        const widths = [280, 70, 80, 70, 70];
        let x = doc.x;
        headers.forEach((h, idx) => {
            doc.font('Helvetica-Bold').fontSize(9).text(h, x, doc.y, { width: widths[idx] });
            x += widths[idx];
        });
        doc.moveDown(0.6);

        (invoice.items || []).forEach((it) => {
            const y = doc.y;
            const values = [
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
        row('Sub Total:', Number(invoice.subTotal || 0).toFixed(2));
        row('Total (AED):', Number(invoice.total || 0).toFixed(2));

        if (invoice.customerNotes) {
            doc.moveDown(0.5);
            doc.font('Helvetica-Bold').fontSize(11).text('Customer Notes');
            doc.moveDown(0.2);
            doc.font('Helvetica').fontSize(10).text(invoice.customerNotes);
        }

        if (invoice.termsAndConditions) {
            doc.moveDown(0.5);
            doc.font('Helvetica-Bold').fontSize(11).text('Terms & Conditions');
            doc.moveDown(0.2);
            doc.font('Helvetica').fontSize(10).text(invoice.termsAndConditions);
        }

        doc.end();
    });
}
