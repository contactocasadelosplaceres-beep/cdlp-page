/* Revisa los pedidos de la tienda sin descontar y les descuenta el inventario.
   Corre cada ~5 min en GitHub Actions (.github/workflows/stock.yml) con la cuenta de servicio de Firebase
   guardada como secreto FIREBASE_SERVICE_ACCOUNT. No requiere el plan Blaze. */
const admin = require('firebase-admin');
const { descontarPedido } = require('./descontar');

const key = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!key) { console.log('Aún no está configurado el secreto FIREBASE_SERVICE_ACCOUNT: no se hace nada.'); process.exit(0); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key)) });
const db = admin.firestore();

(async () => {
  const st = await db.collection('settings').doc('store').get();
  const settings = st.exists ? st.data() : {};
  if (settings.autoDeductOnlineStock === false) { console.log('Descuento automático apagado en Configuración: nada que hacer.'); return; }
  if (!settings.autoDeductOnlineSince) { console.log('Aún no hay fecha de activación (se fija al abrir el panel de administración una vez).'); return; }
  const snap = await db.collection('orders').where('date', '>=', settings.autoDeductOnlineSince).get();
  const pend = snap.docs.filter(d => { const o = d.data(); return o.source !== 'pos' && !o.stockDeducted && o.status !== 'Cancelado'; });
  console.log(`Pedidos revisados: ${snap.size}. Por descontar: ${pend.length}.`);
  for (const d of pend) {
    try { await descontarPedido(db, d.ref); console.log('Descontado', d.id); }
    catch (e) { console.error('Error en', d.id, e.message); process.exitCode = 1; }
  }
})().catch(e => { console.error(e); process.exit(1); });
