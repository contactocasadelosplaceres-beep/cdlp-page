/* Diagnóstico de salud (SOLO LECTURA): busca errores reales en los datos.
   - Registro de errores del sistema (systemErrors) de los últimos DIAS días, agrupados.
   - Productos: existencias que no cuadran (stock vs. suma por centro, variantes vs. producto),
     negativos, variantes sin id o repetidas, precio en 0, espejo de existencias (productStock)
     desfasado o faltante, costos privados huérfanos, costos todavía en "products".
   - Pedidos y ventas recientes con productos que ya no existen o estados raros.
   No cambia nada. */
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const DIAS = Number(process.env.DIAS) || 30;
const desde = new Date(Date.now() - DIAS * 864e5).toISOString();
const sum = o => Object.values(o || {}).reduce((s, n) => s + (Number(n) || 0), 0);
const out = (t, list, fmt, max = 25) => {
  console.log(`\n## ${t}: ${list.length}`);
  list.slice(0, max).forEach(x => console.log('  - ' + fmt(x)));
  if (list.length > max) console.log(`  … y ${list.length - max} más`);
  if (list.length) console.log(`::warning::${t}: ${list.length}`);
};
(async () => {
  // ---- errores del sistema ----
  const errs = await db.collection('systemErrors').where('date', '>=', desde).get();
  const byMsg = new Map();
  errs.forEach(d => { const x = d.data(); const k = `${x.source || '?'} · ${String(x.message || '').slice(0, 160)}`; const g = byMsg.get(k) || { n: 0, last: '', stack: '', page: '' }; g.n++; if ((x.date || '') > g.last) { g.last = x.date; g.stack = String(x.stack || '').split('\n').slice(0, 3).join(' | ').slice(0, 300); g.page = x.page || ''; } byMsg.set(k, g); });
  console.log(`Errores del sistema en ${DIAS} días: ${errs.size}`);
  out('Errores distintos', [...byMsg.entries()].sort((a, b) => b[1].n - a[1].n), ([k, g]) => `${g.n}× ${k}  (último ${g.last} en ${g.page})\n      ${g.stack}`, 40);

  // ---- productos ----
  const [ps, pst, pcs, cs] = await Promise.all([db.collection('products').get(), db.collection('productStock').get(), db.collection('productCosts').get(), db.collection('distributionCenters').get()]);
  const centers = new Set(cs.docs.map(d => d.id));
  const stockMirror = new Map(pst.docs.map(d => [d.id, d.data()]));
  const prodIds = new Set(ps.docs.map(d => d.id));
  const live = ps.docs.filter(d => !d.data().deletedAt);
  console.log(`\nProductos: ${ps.size} (${live.length} activos) · centros: ${[...centers].join(', ')}`);
  const P = { sbc: [], neg: [], varSum: [], varNoId: [], varDup: [], price0: [], mirror: [], noMirror: [], unkCenter: [], privLeft: [], varSbc: [], kitBad: [] };
  live.forEach(d => {
    const p = d.data(), n = `${p.name} [${d.id}]`, vs = Array.isArray(p.variants) ? p.variants : [];
    if (p.stockByCenter && Object.keys(p.stockByCenter).length && !p.isKit && sum(p.stockByCenter) !== (Number(p.stock) || 0)) P.sbc.push(`${n}: stock ${p.stock} vs. suma por centro ${sum(p.stockByCenter)}`);
    const negs = [['stock', p.stock], ...Object.entries(p.stockByCenter || {})].filter(([, v]) => Number(v) < 0); vs.forEach(v => { if (Number(v.stock) < 0) negs.push([`variante ${v.id}`, v.stock]); });
    if (negs.length) P.neg.push(`${n}: ${negs.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    Object.keys(p.stockByCenter || {}).forEach(c => { if (!centers.has(c) && Number(p.stockByCenter[c])) P.unkCenter.push(`${n}: ${p.stockByCenter[c]} pz en centro inexistente "${c}"`); });
    if (vs.length) {
      const vt = vs.reduce((s, v) => s + (Number(v.stock) || 0), 0);
      if (vt !== (Number(p.stock) || 0)) P.varSum.push(`${n}: producto ${p.stock} vs. suma de variantes ${vt}`);
      const ids = vs.map(v => v && v.id); if (ids.some(x => x == null || x === '')) P.varNoId.push(n);
      if (new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length) P.varDup.push(n);
      vs.forEach(v => { if (v.stockByCenter && Object.keys(v.stockByCenter).length && sum(v.stockByCenter) !== (Number(v.stock) || 0)) P.varSbc.push(`${n} · variante ${v.id}: ${v.stock} vs. por centro ${sum(v.stockByCenter)}`); });
    }
    if (!(Number(p.price) > 0) && !p.isMysteryBox) P.price0.push(`${n}: precio ${p.price}`);
    if (p.isKit && (!Array.isArray(p.kitItems) || !p.kitItems.length || p.kitItems.some(k => !prodIds.has(k.productId)))) P.kitBad.push(`${n}: kit con componentes vacíos o borrados`);
    if (['cost', 'costHistory', 'supplierId'].some(k => k in p) || vs.some(v => v && 'cost' in v)) P.privLeft.push(n);
    const m = stockMirror.get(d.id);
    if (!p.hidden) {
      if (!m) P.noMirror.push(n);
      else {
        const exp = Math.max(0, Number(p.stock) || 0);
        const vm = new Map((m.variants || []).map(v => [String(v.id), v.stock]));
        const vbad = vs.filter(v => v.id != null && (vm.get(String(v.id)) ?? null) !== Math.max(0, Number(v.stock) || 0));
        if (m.stock !== exp || vbad.length) P.mirror.push(`${n}: real ${exp} vs. espejo ${m.stock}${vbad.length ? ` · ${vbad.length} variante(s) distintas` : ''}`);
      }
    }
  });
  out('Stock del producto ≠ suma por centro', P.sbc, x => x);
  out('Stock de variante ≠ su suma por centro', P.varSbc, x => x);
  out('Stock del producto ≠ suma de sus variantes', P.varSum, x => x);
  out('Existencias negativas', P.neg, x => x);
  out('Existencias en centros que ya no existen', P.unkCenter, x => x);
  out('Variantes sin id', P.varNoId, x => x);
  out('Variantes con id repetido', P.varDup, x => x);
  out('Precio en 0 o vacío', P.price0, x => x);
  out('Kits con componentes faltantes', P.kitBad, x => x);
  out('Costos todavía en "products"', P.privLeft, x => x);
  out('Visibles sin espejo de existencias (la tienda no puede validar stock)', P.noMirror, x => x);
  out('Espejo de existencias desfasado (la tienda ve otra cantidad)', P.mirror, x => x);
  out('Costos privados de productos que ya no existen', pcs.docs.filter(d => !prodIds.has(d.id)), d => d.id, 10);
  out('Espejos de existencias de productos que ya no existen', pst.docs.filter(d => !prodIds.has(d.id)), d => d.id, 10);

  // ---- pedidos y ventas recientes ----
  const [os, ss] = await Promise.all([db.collection('orders').where('date', '>=', desde).get(), db.collection('sales').where('date', '>=', desde).get()]);
  const gone = [], badStatus = [], noFolio = [], badTotal = [];
  const flow = new Set(['Nuevo', 'Preparando', 'En camino', 'Entregado', 'Cancelado']);
  const chk = (tipo, d) => {
    const x = d.data(), f = `${tipo} ${x.orderNumber || x.folio || d.id} (${String(x.date).slice(0, 10)})`;
    (x.items || []).forEach(i => { const id = i.id || i.productId; if (id && id !== 'promo_buyxpayy' && !prodIds.has(id)) gone.push(`${f}: "${i.name}" ya no existe`); });
    if (tipo === 'pedido' && x.status && !flow.has(x.status)) badStatus.push(`${f}: estado "${x.status}"`);
    if (tipo === 'pedido' && x.orderNumber == null && x.folio == null) noFolio.push(f);
    const items = (x.items || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
    if (!(Number(x.total) >= 0) || (items > 0 && Number(x.total) > items * 1.5 + 500)) badTotal.push(`${f}: total ${x.total} vs. artículos ${items}`);
  };
  os.forEach(d => chk('pedido', d)); ss.forEach(d => chk('venta', d));
  console.log(`\nPedidos ${DIAS} días: ${os.size} · ventas POS: ${ss.size}`);
  out('Pedidos/ventas con productos borrados (no afecta, solo informativo)', gone, x => x, 10);
  out('Pedidos con estado fuera del flujo', badStatus, x => x);
  out('Pedidos sin folio', noFolio, x => x);
  out('Totales raros', badTotal, x => x);
})().catch(e => { console.error(e); process.exit(1); });
