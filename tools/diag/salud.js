/* Diagnóstico (solo lectura) de "Corregir en productos": corre sobre TODOS los productos la MISMA
   lógica que usa el panel (se copia de admin.html al vuelo) y deja el resultado en la rama
   diag-salud. No escribe nada en Firestore. */
const admin = require('firebase-admin');
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const html = fs.readFileSync(process.env.ADMIN_HTML || 'admin.html', 'utf8');
function grab(name){
  const i = html.indexOf('\nfunction ' + name + '('); if(i < 0) throw new Error('no ' + name);
  let j = html.indexOf('{', i), d = 0;
  for(let k = j; k < html.length; k++){ const c = html[k]; if(c === '{') d++; else if(c === '}'){ d--; if(!d) return html.slice(i, k + 1); } }
}
function grabConst(name){ const m = html.match(new RegExp('\\nconst ' + name + ' = [^\\n]*')); if(!m) throw new Error('no ' + name); return m[0]; }
const defStart = html.indexOf('const HEALTH_CHECKS_DEF = ['); const defEnd = html.indexOf('];', defStart) + 2;
const src = [html.slice(defStart, defEnd), grabConst('TEXT_GLITCH_RE'), grabConst('GENERIC_DESC_RE'),
  ...['variantRepair','variantRepairPreview','variantStockOnlyInProduct','normalizeNameTokens','computePriceMismatches','productSellPrice','productMarginPct','healthDismissKey','computeCatalogHealthRaw'].map(grab),
  'return {HEALTH_CHECKS_DEF, variantRepair, variantRepairPreview, computeCatalogHealthRaw};'].join('\n');
const ts = v => v && typeof v.toDate === 'function' ? v.toDate().toISOString() : (v || null);
(async () => {
  const [ps, cs, st, logs] = await Promise.all([
    db.collection('products').get(), db.collection('productCosts').get(), db.collection('settings').doc('store').get(),
    db.collection('adminAuditLog').orderBy('date', 'desc').limit(300).get().catch(() => null),
  ]);
  const costs = {}; cs.forEach(d => costs[d.id] = d.data());
  const products = [];
  ps.forEach(d => {
    const p = { id: d.id, ...d.data() }; if(p.deletedAt) return;
    const c = costs[d.id]; if(c){ ['cost','supplierId','costHistory'].forEach(k => { if(c[k] !== undefined) p[k] = c[k]; });
      if(c.variantCosts && Array.isArray(p.variants)) p.variants = p.variants.map(v => (v && v.id != null && c.variantCosts[v.id] !== undefined) ? { ...v, cost: c.variantCosts[v.id] } : v); }
    products.push(p);
  });
  const settings = st.exists ? st.data() : {};
  const state = { products, settings };
  const L = new Function('state', src)(state);
  const health = L.computeCatalogHealthRaw();
  const out = { generatedAt: new Date().toISOString(), products: products.length, dismissed: (settings.dismissedHealthItems || []).length, checks: {}, variantDetail: [] };
  health.forEach(c => { out.checks[c.key] = { label: c.label, pending: c.list.length, dismissed: c.dismissedCount, items: c.list.map(p => ({ id: p.id, name: p.name })) }; });
  // Detalle de variantes: qué cambiaría la reparación y si es estable (reparar dos veces = sin cambios).
  products.filter(p => (p.variants || []).length).forEach(p => {
    const a = JSON.parse(JSON.stringify(p)); const r1 = L.variantRepair(a);
    if(!r1.changed) return;
    const b = JSON.parse(JSON.stringify(a)); const r2 = L.variantRepair(b);
    out.variantDetail.push({ id: p.id, name: p.name, sync: ts(p._sync), updatedAt: ts(p.updatedAt), problems: r1.problems, stableAfterRepair: !r2.changed,
      before: { groups: p.variantGroups || null, combos: p.variants.map(v => ({ id: v.id, combo: v.combo, keys: Object.keys(v).sort() })) },
      after: { groups: a.variantGroups, combos: a.variants.map(v => ({ id: v.id, combo: v.combo })) } });
  });
  if(logs) out.repairLog = logs.docs.map(d => d.data()).filter(x => /variant|reparar/i.test(JSON.stringify(x))).map(x => ({ date: ts(x.date), action: x.action, target: x.targetName || null, details: x.details || null }));
  console.log('::notice::' + Object.entries(out.checks).map(([k, v]) => `${k}:${v.pending}(+${v.dismissed})`).join(' · '));
  console.log('::notice::variantes a reparar: ' + out.variantDetail.length + ' · inestables: ' + out.variantDetail.filter(x => !x.stableAfterRepair).length);
  const dir = path.join(process.cwd(), 'diag'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'salud.json'), JSON.stringify(out, null, 1));
  const sh = c => execSync(c, { stdio: 'inherit' });
  sh('git config user.name "cdlp-diag[bot]"'); sh('git config user.email "actions@users.noreply.github.com"');
  sh('git checkout --orphan diag-salud'); sh('git rm -rf --cached . >/dev/null'); sh('git add diag/salud.json');
  sh('git commit -m "Diagnóstico de salud del catálogo"'); sh('git push -f origin diag-salud');
})().catch(e => { console.log('::error::' + String(e && (e.stack || e.message) || e).slice(0, 1500).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')); process.exit(1); });
