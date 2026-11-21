/* Solo lectura: historial de un producto (movimientos, ventas, pedidos, auditorías) para entender un descuadre. IDS=coma */
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
(async () => {
  for (const id of String(process.env.IDS || '').split(',').filter(Boolean)) {
    const p = (await db.collection('products').doc(id).get()).data() || {};
    console.log(`\n=== ${p.name} [${id}] stock ${p.stock} · porCentro ${JSON.stringify(p.stockByCenter)} · _sync ${p._sync && p._sync.toDate().toISOString()}`);
    const mv = await db.collection('stockMovements').where('productId', '==', id).get();
    mv.docs.map(d => d.data()).sort((a, b) => a.date.localeCompare(b.date)).forEach(m => console.log(`  mov ${m.date} ${m.type} ${m.qtyChange} centro=${m.centerId} ${m.note} ${m.userEmail || ''}`));
    for (const col of ['sales', 'orders']) {
      const s = await db.collection(col).orderBy('date', 'desc').limit(400).get();
      s.forEach(d => { const x = d.data(); (x.items || []).forEach(i => { if ((i.id || i.productId) === id) console.log(`  ${col} ${x.date} folio ${x.orderNumber || x.folio || d.id} qty ${i.qty} estado ${x.status || ''} descontado=${x.stockDeducted} centro=${x.stockCenterId || x.centerId || ''} anulada=${x.voided || x.cancelled || ''}`); }); });
    }
    const au = await db.collection('audits').orderBy('date', 'desc').limit(60).get();
    au.forEach(d => { const x = d.data(); (x.items || []).forEach(i => { if (i.productId === id) console.log(`  auditoría ${x.date} sistema ${i.systemQty} contado ${i.countedQty} aplicada=${x.applied}`); }); });
    const tr = await db.collection('transfers').orderBy('date', 'desc').limit(100).get();
    tr.forEach(d => { const x = d.data(); (x.items || []).forEach(i => { if ((i.productId || i.id) === id) console.log(`  traspaso ${x.date} ${JSON.stringify(i)}`); }); });
  }
})().catch(e => { console.error(e); process.exit(1); });
