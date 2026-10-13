/* Diagnóstico (solo lectura): ubicaciones guardadas desde la auditoría y conteos recientes vs. lo que hay
   hoy en cada producto. No escribe en Firestore; deja el resultado en la rama diag-salud. */
const admin = require('firebase-admin');
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const ts = v => v && typeof v.toDate === 'function' ? v.toDate().toISOString() : (v || null);
(async () => {
  const [ps, logs, auds, moves] = await Promise.all([
    db.collection('products').get(),
    db.collection('adminAuditLog').orderBy('date', 'desc').limit(4000).get(),
    db.collection('audits').orderBy('date', 'desc').limit(6).get(),
    db.collection('stockMovements').orderBy('date', 'desc').limit(3000).get().catch(e => ({ docs: [], err: e.message })),
  ]);
  const P = {}; ps.forEach(d => P[d.id] = { id: d.id, ...d.data() });
  const L = logs.docs.map(d => d.data());
  // 1) Ubicaciones: último valor registrado por producto (auditoría o edición) vs. el actual
  const locLast = {}, locAll = [];
  L.slice().reverse().forEach(x => {
    const m = /Ubicaci[oó]n: "([^"]*)" → "([^"]*)"/.exec(x.details || '') || /Ubicaci[oó]n: (.*?) → (.*?)( · |$)/.exec(x.details || '');
    if (!m || !x.targetId) return;
    const val = m[2] === '(vacío)' ? '' : m[2];
    locLast[x.targetId] = { date: x.date, value: val, via: /auditor/.test(x.details) ? 'auditoría' : 'edición' };
    locAll.push({ id: x.targetId, date: x.date, from: m[1], to: val });
  });
  const locMismatch = Object.entries(locLast).map(([id, l]) => { const p = P[id]; const cur = p ? (p.location || '') : null;
    return cur === l.value.trim() ? null : { id, name: p ? p.name : '(borrado)', saved: l.value, savedAt: l.date, via: l.via, now: cur, sync: p ? ts(p._sync) : null, lastWrites: L.filter(x => x.targetId === id && x.date > l.date).map(x => [x.date, x.action, (x.details || '').slice(0, 120)]) }; }).filter(Boolean);
  // 2) Conteos de las últimas auditorías vs. existencias actuales
  const audits = auds.docs.map(d => ({ id: d.id, ...d.data() }));
  const mv = moves.docs.map(d => d.data());
  const oldest = audits.length ? audits[audits.length - 1].date : new Date().toISOString();
  const SALES = (await db.collection('sales').where('date', '>', oldest).get()).docs.map(d => d.data()).filter(x => !x.voided && x.status !== 'anulada');
  const auditCheck = audits.map(a => ({ id: a.id, date: a.date, center: a.centerName, applied: !!a.applied, items: (a.items || []).length,
    rows: (a.items || []).map(it => { const p = P[it.productId]; if (!p) return { name: it.name, missing: true };
      let now; if (it.variantId) { const v = (p.variants || []).find(v => v.id === it.variantId); now = v ? ((v.stockByCenter || {})[a.centerId] ?? v.stock) : undefined; }
      else now = (p.stockByCenter || {})[a.centerId];
      const after = mv.filter(m => m.productId === it.productId && m.date > a.date && m.type !== 'auditoria' && (!m.centerId || m.centerId === a.centerId)).reduce((s, m) => s + (Number(m.qtyChange) || 0), 0);
      const sold = SALES.filter(x => x.date > a.date && (!x.centerId || x.centerId === a.centerId)).reduce((s, x) => s + (x.items || []).filter(i => (i.id === it.productId || i.productId === it.productId) && (!it.variantId || i.variantId === it.variantId)).reduce((t, i) => t + (Number(i.qty) || 0), 0), 0);
      return { name: it.name, sold, counted: it.countedQty, system: it.systemQty, now, movesAfter: after, ok: now === it.countedQty || now === it.countedQty + after || now === it.countedQty - sold || now === it.countedQty + after - sold };
    }) }));
  const out = { generatedAt: new Date().toISOString(), products: ps.size, withLocation: Object.values(P).filter(p => (p.location || '').trim()).length,
    locationLogs: locAll.length, locAll: locAll.map(x => ({ ...x, name: (P[x.id] || {}).name })), auditIds: audits.map(a => ({ date: a.date, ids: (a.items || []).map(i => i.productId) })), locationProducts: Object.keys(locLast).length, locMismatch, moveSample: mv.slice(0, 2).map(m => Object.keys(m).sort()), movesErr: moves.err || null, auditCheck };
  console.log('::notice::' + `Productos ${out.products} · con ubicación ${out.withLocation} · ubicaciones registradas ${out.locationProducts} · NO coinciden hoy ${locMismatch.length}`);
  console.log('::notice::' + auditCheck.map(a => `${a.date.slice(0, 16)} ${a.applied ? 'aplicada' : 'sin aplicar'} ${a.items} prod, no cuadran ${a.rows.filter(r => !r.ok).length}`).join(' | '));
  const dir = path.join(process.cwd(), 'diag'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'salud.json'), JSON.stringify(out, null, 1));
  const sh = c => execSync(c, { stdio: 'inherit' });
  sh('git config user.name "cdlp-diag[bot]"'); sh('git config user.email "actions@users.noreply.github.com"');
  sh('git checkout --orphan diag-salud'); sh('git rm -rf --cached . >/dev/null'); sh('git add diag/salud.json');
  sh('git commit -m "Diagnóstico ubicaciones y conteos"'); sh('git push -f origin diag-salud');
})().catch(e => { console.log('::error::' + String(e && (e.stack || e.message) || e).slice(0, 1500).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')); process.exit(1); });
