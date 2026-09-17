/**
 * Where a customer sends a bank transfer.
 *
 * In one place because it is now printed on invoices and shown on the public
 * renewal page. An account number that exists twice is one that gets changed
 * once, and the copy nobody remembered keeps telling customers to pay into an
 * account that is closed.
 */
export const DEFAULT_BANK_INFORMATION =
    'Account Number: 019101745789\n' +
    'IBAN Number: AE500330000019101745789\n' +
    'Address: Unit 12, ABA Avenue Al Quoz 2, Dubai';

/** The same details as fields, for a page that lays them out itself. */
export function bankTransferDetails() {
    return {
        accountName: 'PurpleBox Storage',
        accountNumber: '019101745789',
        iban: 'AE500330000019101745789',
        address: 'Unit 12, ABA Avenue Al Quoz 2, Dubai',
    };
}
