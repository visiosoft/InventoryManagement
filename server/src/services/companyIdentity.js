/**
 * Whose letterhead goes on a document.
 *
 * The company details used to be a `CO` literal copied into five PDF
 * renderers, so a quotation for a unit in any facility printed the Al Quoz
 * address. With more than one facility that is simply wrong on the page the
 * customer reads.
 *
 * The facility is worked out the same way `utils/siteScope.js` works it out —
 * through the unit — because that is the only place the system records it.
 *
 * Every field falls back: the facility's own value, then the default
 * facility's, then the built-in company details, which are the exact literal
 * the PDFs carried before. A facility nobody has filled in therefore prints
 * precisely the document it printed yesterday.
 */

import { Site, Unit, Contract } from '../models/index.js';

/** The details every PDF hardcoded. Unchanged, so output is identical. */
/**
 * The company's tax registration number.
 *
 * One legal entity, so one number, whichever facility or which side of the
 * business a document comes from. Defined here and imported by the moving
 * documents too, which keep their own letterhead (different trading name and
 * email) but not their own TRN — four copies of a tax number is three chances
 * to print the wrong one.
 */
export const TRN = '104974005100003';

export const FALLBACK_CO = {
    name: 'PurpleBox',
    legalName: 'PurpleBox',
    tagline: 'powered by short term storage',
    addr1: 'Al Quoz 2, Warehouse 12, ABA Avenue',
    addr2: ' Dubai 333759',
    country: 'U.A.E',
    phone: '0097143293924',
    email: 'contact@purplebox.ae',
    trn: TRN,
    bankInformation: '',
};

/* Sites change rarely and are read on every document. Cleared whenever one is
   edited, so a corrected address is never printed from a stale copy. */
let cache = new Map();
export function clearCompanyCache(siteId) {
    if (siteId) cache.delete(String(siteId));
    else cache = new Map();
}

/** An empty string is "not filled in", not "deliberately blank". */
const pick = (...vals) => {
    for (const v of vals) {
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
};

export async function resolveDefaultSite() {
    return (await Site.findOne({ isDefault: true }).select('+logo.data').lean())
        ?? (await Site.findOne().sort({ createdAt: 1 }).select('+logo.data').lean())
        ?? null;
}

/**
 * The identity for one facility, merged over the default and the fallback.
 * `siteId` may be null — that is a document with no unit, which gets the
 * default facility's letterhead.
 */
export async function companyForSite(siteId) {
    const key = String(siteId || 'default');
    if (cache.has(key)) return cache.get(key);

    const fallbackSite = await resolveDefaultSite();
    const site = siteId
        ? (await Site.findById(siteId).select('+logo.data').lean().catch(() => null)) ?? fallbackSite
        : fallbackSite;

    /* Only the fields added for this purpose feed the letterhead.
     *
     * `site.name` and `site.address` are deliberately NOT used: name is an
     * internal label ("Al Quoz Facility", not the trading name), and address
     * is the short one-liner the Sites list shows. Falling back to them would
     * silently reword every quotation the moment this shipped. A facility
     * prints its own letterhead only once somebody fills these in. */
    const co = {
        name: pick(site?.legalName, FALLBACK_CO.name),
        legalName: pick(site?.legalName, FALLBACK_CO.legalName),
        tagline: pick(site?.tagline, fallbackSite?.tagline, FALLBACK_CO.tagline),
        addr1: pick(site?.addr1, fallbackSite?.addr1, FALLBACK_CO.addr1),
        addr2: pick(site?.addr2, fallbackSite?.addr2, FALLBACK_CO.addr2),
        country: pick(site?.country, fallbackSite?.country, FALLBACK_CO.country),
        phone: pick(site?.phone, fallbackSite?.phone, FALLBACK_CO.phone),
        email: pick(site?.email, fallbackSite?.email, FALLBACK_CO.email),
        trn: pick(site?.trn, fallbackSite?.trn, FALLBACK_CO.trn),
        bankInformation: pick(site?.bankInformation, fallbackSite?.bankInformation, FALLBACK_CO.bankInformation),
        // The bytes, ready for the renderer. undefined means "use the disk
        // logo", which is what every document used before this existed.
        logo: site?.logo?.data ?? fallbackSite?.logo?.data ?? undefined,
        siteId: site?._id ? String(site._id) : null,
        siteName: site?.name || '',
    };

    cache.set(key, co);
    return co;
}

/**
 * Which facility a set of units belongs to.
 *
 * `mixed` is true when they span more than one. The first unit's facility is
 * used — one document has one letterhead — and the flag is returned so the
 * page can say so rather than the PDF quietly picking a side.
 */
export async function companyForUnits(unitIds) {
    const ids = (unitIds || []).filter(Boolean);
    if (ids.length === 0) return { co: await companyForSite(null), siteId: null, mixed: false };

    const units = await Unit.find({ _id: { $in: ids } }).select('site').lean();
    const sites = [...new Set(units.map((u) => (u.site ? String(u.site) : null)))];
    const first = units[0]?.site ? String(units[0].site) : null;

    return { co: await companyForSite(first), siteId: first, mixed: sites.length > 1 };
}

/** A contract carries its units on `unit` and/or `units`. */
export async function companyForContract(contract) {
    if (!contract) return companyForSite(null);
    const ids = [
        ...(contract.units || []).map((u) => u?._id ?? u),
        contract.unit?._id ?? contract.unit,
    ].filter(Boolean);
    const { co } = await companyForUnits(ids);
    return co;
}

/** A quote's units are `quote.units[].unit`. */
export async function companyForQuote(quote) {
    if (!quote) return companyForSite(null);
    const ids = (quote.units || []).map((u) => u?.unit?._id ?? u?.unit).filter(Boolean);
    const { co } = await companyForUnits(ids);
    return co;
}

/**
 * An invoice reaches its facility through the contract it bills.
 *
 * `orderNumber` is the contract number — the same hop `archiveInvoicePdf`
 * already makes. An imported or manual invoice has none, and gets the default
 * facility rather than nothing.
 */
export async function companyForInvoice(invoice) {
    if (!invoice?.orderNumber) return companyForSite(null);
    const contract = await Contract.findOne({ contractNo: invoice.orderNumber })
        .select('unit units').lean().catch(() => null);
    return companyForContract(contract);
}
