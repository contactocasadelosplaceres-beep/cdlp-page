/* Diagnóstico de lecturas del panel: cuenta cuántos documentos tiene cada colección que lee
   admin.html, para saber cuánto cuesta abrirlo. Solo usa count() (1 lectura por cada 1000
   documentos contados), no lee el contenido de nada. Resultado en las anotaciones de la corrida. */
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const COLS = ['products','customers','orders','sales','visits','analyticsEvents','cashiers','distributionCenters','transfers','audits',
  'couponUsage','cashRegisters','abandonedCarts','storeMessages','suppliers','restockItems','commissionAgents','activePosSessions',
  'expenses','shrinkage','restockRequests','searchMisses','priceChangeBatches','cartAbandonSurveys','productExchanges','quizResponses',
  'layaways','adminAuditLog','stockMovements','productCosts','systemErrors','admin_sessions','customerMessages'];
(async () => {
  const since45 = new Date(Date.now() - 45 * 864e5).toISOString();
  const since1 = new Date(Date.now() - 864e5).toISOString();
  const rows = [];
  for (const c of COLS) {
    try { const n = (await db.collection(c).count().get()).data().count; rows.push([c, n]); }
    catch (e) { rows.push([c, 'error: ' + (e.code || e.message)]); }
  }
  const extra = [];
  for (const [c, f] of [['orders','date'],['sales','date']]) {
    try { extra.push([c + ' últimos 45 días', (await db.collection(c).where(f, '>=', since45).count().get()).data().count]); } catch (e) { extra.push([c + ' 45d', 'error']); }
    try { extra.push([c + ' último día', (await db.collection(c).where(f, '>=', since1).count().get()).data().count]); } catch (e) { extra.push([c + ' 1d', 'error']); }
  }
  try { extra.push(['products en papelera', (await db.collection('products').where('deletedAt', '>', '').count().get()).data().count]); } catch (e) {}
  const all = rows.concat(extra);
  all.forEach(([c, n]) => console.log(`${c}: ${n}`));
  // Las anotaciones de GitHub se cortan, así que se mandan en grupos de 8.
  for (let i = 0; i < all.length; i += 8) console.log('::notice::' + all.slice(i, i + 8).map(([c, n]) => `${c}=${n}`).join(' · '));
})().catch(e => { console.log('::error::' + (e.message || e)); process.exit(1); });
