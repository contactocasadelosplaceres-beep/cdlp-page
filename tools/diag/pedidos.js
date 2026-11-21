/* Diagnóstico (solo lectura): pedidos de la tienda y ventas del POS desde DESDE (ISO).
   Muestra folio, estado, total y productos, y revisa que cada producto exista y tenga existencias coherentes. */
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const DESDE = process.env.DESDE || new Date(Date.now() - 6 * 3600e3).toISOString();
(async () => {
  const [o, s] = await Promise.all([
    db.collection('orders').where('date', '>=', DESDE).orderBy('date').get(),
    db.collection('sales').where('date', '>=', DESDE).orderBy('date').get(),
  ]);
  console.log(`Desde ${DESDE}: ${o.size} pedido(s) de la tienda · ${s.size} venta(s) del POS`);
  const ids = new Set();
  const show = (tipo, d) => {
    const x = d.data();
    const items = (x.items || []).map(i => { if (i.id || i.productId) ids.add(i.id || i.productId); return `${i.qty || 1}× ${i.name || i.id}${i.variantLabel ? ' (' + i.variantLabel + ')' : ''}`; });
    console.log(`  [${tipo}] ${x.date} · folio ${x.folio || d.id} · ${x.status || x.estado || ''} · total $${x.total ?? ''} · ${items.join(' | ')}`);
  };
  o.docs.forEach(d => show('tienda', d)); s.docs.forEach(d => show('POS', d));
  for (const id of ids) {
    const p = await db.collection('products').doc(id).get();
    if (!p.exists) { console.log(`  ! producto ${id} ya no existe`); continue; }
    const x = p.data(); const vs = (x.variants || []).reduce((a, v) => a + (v.stock || 0), 0);
    console.log(`  · ${x.name}: stock ${x.stock}${(x.variants || []).length ? ` (suma variantes ${vs})` : ''} · ${(x.categories || [x.cat]).join(', ')}${x.deletedAt ? ' · EN PAPELERA' : ''}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
