import { fetchGoogleContacts, googleContactsConfigured } from './googleContacts.js';
import { Lead, User } from '../models/index.js';
import { normalizeLeadPhone } from '../routes/leads.js';

// In-memory state — reset on server restart, that's fine
export const syncState = { at: null, created: 0, updated: 0, skipped: 0, errors: 0 };

export async function runGoogleContactsSync() {
  if (!googleContactsConfigured()) return syncState;

  let contacts = [];
  try {
    const result = await fetchGoogleContacts();
    contacts = result.contacts;
  } catch (err) {
    console.error('Google Contacts fetch failed:', err.message);
    return syncState;
  }

  const admin = await User.findOne({}).select('_id').sort({ createdAt: 1 });
  const ownerId = admin?._id;

  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (const c of contacts) {
    try {
      const phoneNormalized = normalizeLeadPhone(c.phone);
      if (!phoneNormalized) { skipped++; continue; }

      const existing = await Lead.findOne({ phoneNormalized });
      if (!existing) {
        await Lead.create({
          fullName: c.name || 'Unknown Contact',
          email: c.email || '',
          phone: c.phone,
          phoneNormalized,
          status: 'new',
          source: 'google_contacts',
          leadDateTime: new Date(),
          storageSizeValue: 25,
          storageSizeUnit: 'sqft',
          durationValue: 1,
          durationUnit: 'month',
          owner: ownerId,
          unitsNeeded: 1,
          notes: c.notes || '',
          timeline: [{ type: 'google_contacts_import', text: 'Lead created from Google Contacts sync' }],
        });
        created++;
      } else {
        existing.fullName = c.name || existing.fullName;
        existing.email = c.email || existing.email;
        if (!existing.source || existing.source === 'manual') existing.source = 'google_contacts';
        if (c.notes) existing.notes = existing.notes ? `${existing.notes}\n${c.notes}` : c.notes;
        existing.timeline.push({ type: 'google_contacts_update', text: 'Lead updated from Google Contacts sync' });
        await existing.save();
        updated++;
      }
    } catch {
      errors++;
    }
  }

  Object.assign(syncState, { at: new Date().toISOString(), created, updated, skipped, errors });
  if (created > 0) console.log(`✅ Google Contacts sync: ${created} new lead(s) created`);

  return { created, updated, skipped, errors };
}
