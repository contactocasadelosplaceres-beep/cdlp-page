/* Diagnóstico de variantes: revisa TODOS los productos y reporta los que la tienda no puede
   vender por variante (grupos sin opciones, combinaciones que no coinciden, comillas, etc.).
   Solo LEE Firestore. Escribe diag/variantes.json (estructura pública de variantes, sin costos)
   para revisarlo, y lo sube a la rama "diag-variantes" (no toca main). */
const admin = require('firebase-admin');
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const norm = s => String(s == null ? '' : s).trim().toLowerCase();
(async () => {
  const snap = await db.collection('products').get();
  const out = [], issues = [];
  snap.forEach(doc => {
    const p = doc.data(); if (p.deletedAt) return;
    const groups = p.variantGroups || [], vs = p.variants || [];
    if (!groups.length && !vs.length) return;
    const probs = [];
    if (vs.length && !groups.length) probs.push('tiene variantes pero no grupos (variantGroups vacío)');
    if (groups.length && !vs.length) probs.push('tiene grupos pero ninguna variante');
    groups.forEach((g, i) => {
      if (!g || !g.name) probs.push(`grupo #${i + 1} sin nombre`);
      if (!Array.isArray(g.values)) probs.push(`grupo "${g && g.name}" sin lista "values"${g && g.options ? ' (usa "options")' : ''}`);
      else if (!g.values.length) probs.push(`grupo "${g.name}" sin opciones`);
      [g && g.name, ...((g && g.values) || [])].forEach(t => { if (/["\\<>`]/.test(String(t || ''))) probs.push(`texto con caracteres problemáticos: ${JSON.stringify(t)}`); });
    });
    vs.forEach((v, i) => {
      if (!v.id) probs.push(`variante #${i + 1} sin id`);
      if (!v.combo || typeof v.combo !== 'object') { probs.push(`variante #${i + 1} sin combinación (combo)`); return; }
      groups.forEach(g => {
        if (!g || !g.name) return;
        const val = v.combo[g.name];
        if (val === undefined) {
          const k = Object.keys(v.combo).find(x => norm(x) === norm(g.name));
          probs.push(`variante ${JSON.stringify(v.combo)}: no tiene "${g.name}"${k ? ` (tiene "${k}")` : ''}`);
        } else if (Array.isArray(g.values) && !g.values.includes(val)) {
          const near = g.values.find(x => norm(x) === norm(val));
          probs.push(`variante ${JSON.stringify(v.combo)}: "${val}" no está en las opciones de "${g.name}"${near !== undefined ? ` (parecido: "${near}")` : ''}`);
        }
      });
      Object.keys(v.combo).forEach(k => { if (!groups.some(g => g && g.name === k)) probs.push(`variante ${JSON.stringify(v.combo)}: clave "${k}" no es un grupo`); });
    });
    const ids = vs.map(v => v.id).filter(Boolean); if (new Set(ids).size !== ids.length) probs.push('ids de variante repetidos');
    if (vs.length && vs.every(v => !(Number(v.stock) > 0)) && Number(p.stock) > 0) probs.push(`todas las variantes en 0 pero el producto dice stock ${p.stock}`);
    out.push({ id: doc.id, name: p.name, hidden: !!p.hidden, stock: p.stock, variantGroups: groups, variants: vs.map(v => ({ id: v.id, combo: v.combo, stock: v.stock, stockByCenter: v.stockByCenter, priceOverride: v.priceOverride, promoPriceOverride: v.promoPriceOverride, imageIdx: v.imageIdx, sku: v.sku })), problems: probs });
    if (probs.length) issues.push({ id: doc.id, name: p.name, problems: probs });
  });
  console.log(`Productos con variantes: ${out.length} · con problemas: ${issues.length}`);
  issues.forEach(x => console.log(`- ${x.name} (${x.id}): ${x.problems.join(' | ')}`));
  const dir = path.join(process.cwd(), 'diag'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'variantes.json'), JSON.stringify({ generatedAt: new Date().toISOString(), total: out.length, withIssues: issues.length, issues, products: out }, null, 1));
  const sh = c => execSync(c, { stdio: 'inherit' });
  sh('git config user.name "cdlp-diag[bot]"'); sh('git config user.email "actions@users.noreply.github.com"');
  sh('git checkout --orphan diag-variantes'); sh('git rm -rf --cached . >/dev/null'); sh('git add diag/variantes.json');
  sh('git commit -m "Diagnóstico de variantes"'); sh('git push -f origin diag-variantes');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
