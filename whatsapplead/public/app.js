const state = {
    contacts: [],
    selectedLeadId: '',
    search: '',
};

const contactListEl = document.getElementById('contactList');
const detailPanelEl = document.getElementById('detailPanel');
const statsEl = document.getElementById('stats');
const searchInputEl = document.getElementById('searchInput');
const syncButtonEl = document.getElementById('syncButton');

function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
}

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function getFilteredContacts() {
    const q = state.search.trim().toLowerCase();
    if (!q) return state.contacts;

    return state.contacts.filter((row) => {
        const lead = row.lead || {};
        const labels = (row.labels || []).join(' ').toLowerCase();
        const blob = [lead.fullName, lead.phone, lead.status, lead.notes, labels]
            .map((x) => String(x || '').toLowerCase())
            .join(' ');
        return blob.includes(q);
    });
}

function renderStats() {
    const total = state.contacts.length;
    const withLabels = state.contacts.filter((x) => (x.labels || []).length > 0).length;
    const totalMessages = state.contacts.reduce((sum, row) => sum + Number(row.totalMessages || 0), 0);

    statsEl.innerHTML = [
        { label: 'WhatsApp Leads', value: total },
        { label: 'Labelled Contacts', value: withLabels },
        { label: 'Stored Messages', value: totalMessages },
    ]
        .map(
            (item) =>
                `<article class="stat-card"><div class="stat-label">${escapeHtml(item.label)}</div><div class="stat-value">${escapeHtml(item.value)}</div></article>`
        )
        .join('');
}

function renderContactList() {
    const filtered = getFilteredContacts();

    if (filtered.length === 0) {
        contactListEl.innerHTML = '<div class="empty-state"><p>No contacts match your search.</p></div>';
        return;
    }

    contactListEl.innerHTML = filtered
        .map((row) => {
            const lead = row.lead || {};
            const isActive = lead._id === state.selectedLeadId;
            return `
      <article class="contact-item ${isActive ? 'active' : ''}" data-lead-id="${escapeHtml(lead._id || '')}">
        <p class="contact-name">${escapeHtml(lead.fullName || 'Unknown')}</p>
        <p class="contact-sub">${escapeHtml(lead.phone || '-')} • ${escapeHtml((row.labels || []).slice(0, 2).join(', ') || 'No labels')}</p>
      </article>
    `;
        })
        .join('');

    contactListEl.querySelectorAll('.contact-item').forEach((el) => {
        el.addEventListener('click', () => {
            state.selectedLeadId = el.getAttribute('data-lead-id') || '';
            renderContactList();
            renderDetail();
        });
    });
}

function renderDetail() {
    const row = state.contacts.find((x) => (x.lead || {})._id === state.selectedLeadId);
    if (!row) {
        detailPanelEl.innerHTML = `
      <div class="empty-state">
        <h3>Select a contact</h3>
        <p>Choose a contact from the list to see labels and last 5 chat messages.</p>
      </div>
    `;
        return;
    }

    const lead = row.lead || {};

    detailPanelEl.innerHTML = `
    <section>
      <div class="detail-head">
        <div>
          <h3>${escapeHtml(lead.fullName || 'Unknown')}</h3>
          <p class="contact-sub">${escapeHtml(lead.phone || '-')} • Status: ${escapeHtml(row.mappedStatus || lead.status || 'new')}</p>
        </div>
        <a class="link-btn" href="${escapeHtml(row.whatsappWebLink || '#')}" target="_blank" rel="noreferrer">Open in WhatsApp Web</a>
      </div>

      <div class="meta-grid">
        <article class="meta-card">
          <div class="meta-k">Lead Source</div>
          <div class="meta-v">${escapeHtml(lead.source || 'whatsapp')}</div>
        </article>
        <article class="meta-card">
          <div class="meta-k">Messages Saved</div>
          <div class="meta-v">${escapeHtml(row.totalMessages || 0)}</div>
        </article>
        <article class="meta-card">
          <div class="meta-k">Last Updated</div>
          <div class="meta-v">${escapeHtml(formatDate(lead.updatedAt))}</div>
        </article>
      </div>

      <div class="labels">
        ${(row.labels || []).length > 0 ? row.labels.map((l) => `<span class="chip">${escapeHtml(l)}</span>`).join('') : '<span class="chip">No labels detected</span>'}
      </div>

      <div class="messages">
        ${(row.lastFiveMessages || [])
            .map(
                (msg) => `
          <article class="msg ${escapeHtml(msg.direction || 'inbound')}">
            <div class="msg-top">
              <span>${escapeHtml(msg.direction || 'inbound')}</span>
              <span>${escapeHtml(formatDate(msg.occurredAt))}</span>
            </div>
            <div class="msg-text">${escapeHtml(msg.text || '(non-text message)')}</div>
          </article>
        `
            )
            .join('')}
      </div>

      <div class="alert">
        Showing last 5 chats here. For older history, open this contact in WhatsApp Web/Desktop.
      </div>
    </section>
  `;
}

async function loadContacts() {
    const response = await fetch('/api/contacts');
    if (!response.ok) {
        throw new Error(`Failed to load contacts (${response.status})`);
    }

    const payload = await response.json();
    state.contacts = payload.contacts || [];

    if (!state.selectedLeadId && state.contacts.length > 0) {
        state.selectedLeadId = state.contacts[0].lead?._id || '';
    }

    renderStats();
    renderContactList();
    renderDetail();
}

async function runSync() {
    syncButtonEl.disabled = true;
    syncButtonEl.textContent = 'Syncing...';

    try {
        const response = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || 'Sync failed');
        }

        await loadContacts();
    } catch (error) {
        window.alert(error.message || 'Sync failed');
    } finally {
        syncButtonEl.disabled = false;
        syncButtonEl.textContent = 'Sync WhatsApp';
    }
}

searchInputEl.addEventListener('input', (event) => {
    state.search = event.target.value || '';
    renderContactList();
});

syncButtonEl.addEventListener('click', () => {
    runSync();
});

loadContacts().catch((error) => {
    detailPanelEl.innerHTML = `<div class="empty-state"><p>${escapeHtml(error.message)}</p></div>`;
});
