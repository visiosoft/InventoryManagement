import PDFDocument from 'pdfkit';
import { drawCompanyLogo } from './pdfLogo.js';

// Renders a simple rental contract PDF and resolves with a Buffer.
export function renderContractPdf({ contract, customer, unit }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });

    drawCompanyLogo(doc, 56, 44, 48);

    doc.fontSize(20).font('Helvetica-Bold').text('BOX UNIT RENTAL CONTRACT', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica').fillColor('#555')
      .text(`Contract No: ${contract.contractNo}`, { align: 'center' });
    doc.moveDown(1.5).fillColor('#000');

    const row = (label, value) => {
      doc.font('Helvetica-Bold').fontSize(10).text(label, { continued: true });
      doc.font('Helvetica').text(`  ${value}`);
      doc.moveDown(0.4);
    };

    doc.fontSize(13).font('Helvetica-Bold').text('1. Tenant');
    doc.moveDown(0.5);
    row('Name:', customer.fullName);
    if (customer.email) row('Email:', customer.email);
    if (customer.phone) row('Phone:', customer.phone);
    if (customer.address) row('Address:', customer.address);
    doc.moveDown(0.6);

    doc.fontSize(13).font('Helvetica-Bold').text('2. Rented Unit');
    doc.moveDown(0.5);
    row('Unit Number:', unit.unitNumber);
    row('Size:', `${unit.sizeSqf ?? '—'} sq ft`);
    doc.moveDown(0.6);

    doc.fontSize(13).font('Helvetica-Bold').text('3. Terms');
    doc.moveDown(0.5);
    row('Billing Period:', contract.billingPeriod === 'weekly' ? 'Weekly' : 'Monthly');
    row('Rate:', `${contract.rate.toFixed(2)} per ${contract.billingPeriod === 'weekly' ? 'week' : 'month'}`);
    row('Security Deposit:', contract.deposit.toFixed(2));
    row('Start Date:', fmt(contract.startDate));
    row('End Date:', fmt(contract.endDate));
    row('Auto-Renew:', contract.autoRenew ? 'Yes' : 'No');
    doc.moveDown(0.6);

    doc.fontSize(13).font('Helvetica-Bold').text('4. Conditions');
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').list(
      [
        'The tenant shall use the unit solely for storage of personal or business goods.',
        'Storage of hazardous, flammable, illegal, or perishable goods is prohibited.',
        'Rent is payable in advance for each billing period.',
        'The facility may deny access if payment is more than 14 days overdue.',
        'The tenant must remove all goods and leave the unit clean at the end of the term.',
        'The security deposit is refundable within 14 days of move-out, less any damages.',
      ],
      { bulletRadius: 1.5, textIndent: 14 }
    );

    doc.moveDown(2);
    doc.fontSize(10).font('Helvetica');
    const y = doc.y;
    doc.text('_________________________', 56, y);
    doc.text('Tenant Signature', 56, y + 16);
    doc.text('_________________________', 330, y);
    doc.text('Facility Manager', 330, y + 16);

    doc.end();
  });
}
