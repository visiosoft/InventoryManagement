// Server-side reference pricing. Ops can override amounts in the admin quote endpoint.
function computeQuote(move) {
  const base = { Studio: 600, '1 BHK': 900, '2 BHK': 1400, Villa: 2600 }[move.homeSize] || 900;
  const materials = 150;
  const lines = [
    { label: `Base move · ${move.homeSize || '1 BHK'}`, amount: base },
    { label: 'Packing materials & labour', amount: materials },
  ];
  const addonMeta = [
    ['disassembly', 'Furniture disassembly', 250],
    ['insurance', 'Transit insurance', 180],
    ['handyman', 'Handyman & cleaning', 300],
  ];
  addonMeta.forEach(([k, label, price]) => {
    if (move.addons && move.addons[k]) lines.push({ label, amount: price });
  });
  const subtotal = lines.reduce((a, l) => a + l.amount, 0);
  const vat = Math.round(subtotal * 0.05);
  return { lines, subtotal, vat, total: subtotal + vat };
}

function defaultTracking(move) {
  return [
    { title: 'Quote accepted', sub: 'Just now', state: 'done' },
    { title: 'Team assigned', sub: 'Coordinator being assigned', state: 'active' },
    { title: 'Packing & wrapping', sub: `${move.date || 'Scheduled date'} · morning`, state: 'todo' },
    { title: 'In transit', sub: `${move.from || 'Pickup'} → ${move.to || 'Drop-off'}`, state: 'todo' },
    { title: 'Delivered & set up', sub: 'On completion', state: 'todo' },
  ];
}

module.exports = { computeQuote, defaultTracking };
