/* AUDITORÍA (rama audit/*): lo que puede ver CUALQUIER visitante sin iniciar sesión, usando solo la
   llave pública de la página (la misma que trae admin.html). Solo imprime sí/no y tamaños, nunca valores. */
const KEY = 'AIzaSyAhPrEfQSfWOjP2X7GtcXKp86RMWHZa-NQ', PID = 'casa-de-los-placeres';
const B = `https://firestore.googleapis.com/v1/projects/${PID}/databases/(default)/documents`;
const note = s => console.log('::notice::' + s);
(async () => {
  const g = async p => { const r = await fetch(`${B}/${p}${p.includes('?') ? '&' : '?'}key=${KEY}`); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  const st = await g('settings/store?mask.fieldPaths=slackWebhookUrl&mask.fieldPaths=dashboardNotes&mask.fieldPaths=deliveryWhatsapp&mask.fieldPaths=salesGoalMonthly');
  const f = (st.j && st.j.fields) || {};
  const wh = f.slackWebhookUrl && f.slackWebhookUrl.stringValue || '';
  note(`ANÓNIMO settings/store → HTTP ${st.s} · webhook de Slack legible=${/^https:\/\/hooks\.slack\.com\//.test(wh)} (largo ${wh.length}) · notas internas legibles=${!!f.dashboardNotes} · WhatsApp repartidor legible=${!!f.deliveryWhatsapp} · meta de ventas legible=${!!f.salesGoalMonthly}`);
  const q = await fetch(`${B}:runQuery?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'products' }], select: { fields: [{ fieldPath: 'cost' }] }, where: { fieldFilter: { field: { fieldPath: 'cost' }, op: 'GREATER_THAN', value: { integerValue: '0' } } }, limit: 5 } }) });
  const qj = await q.json().catch(() => []);
  const withCost = Array.isArray(qj) ? qj.filter(x => x.document && x.document.fields && x.document.fields.cost).length : 0;
  note(`ANÓNIMO products (campo costo) → HTTP ${q.status} · documentos con costo devueltos en muestra de 5: ${withCost}`);
  for (const c of ['orders', 'customers', 'sales', 'expenses', 'cashiers', 'staffPermissions', 'couponUsage', 'abandonedCarts', 'storeMessages', 'counters/orders']) {
    const r = await g(c + (c.includes('/') ? '' : '?pageSize=1'));
    const n = r.j && r.j.documents ? r.j.documents.length : (r.j && r.j.fields ? 1 : 0);
    note(`ANÓNIMO ${c} → HTTP ${r.s} · docs devueltos ${n}`);
  }
  // ¿Se puede crear una cuenta nueva? (solo se consulta la configuración pública; NO se crea ninguna cuenta)
  const cfg = await fetch(`https://identitytoolkit.googleapis.com/v1/projects?key=${KEY}`).then(r => r.status).catch(() => 'err');
  note('Consulta pública de configuración de Auth: HTTP ' + cfg);
})().catch(e => { console.log('::error::' + e.message); process.exit(1); });
