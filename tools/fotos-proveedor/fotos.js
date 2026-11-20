/* Fotos oficiales del proveedor → archivos .webp de este repositorio → fotos del producto.
   Para cada producto de fotos.json: lee <página>.json (tiendas Shopify, como orgie.com.mx),
   baja hasta maxFotos fotos (brinca las de íconos), las pasa a .webp sobre fondo blanco
   (grande máx. 1000 px en img/p/ y miniatura 500 px en img/p/t/, igual que tools/fotos),
   hace commit y push, y solo entonces cambia `images` del producto — únicamente si sus fotos
   siguen siendo exactamente "fotosActuales" (no pisa fotos que alguien ya cambió en el panel).
   Variables: FIREBASE_SERVICE_ACCOUNT, DRY_RUN (1 = solo reporte, por defecto). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const env = process.env;
const DRY_RUN = env.DRY_RUN !== '0';
const ROOT = path.resolve(__dirname, '..', '..');
const { productos, maxFotos = 4 } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fotos.json'), 'utf8'));
const kb = n => Math.round(n / 1024);

async function bajar(url){
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (CDLP fotos)' } });
  if(!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return r;
}

async function main(){
  const sharp = require('sharp');
  const plan = [];
  for(const p of productos){
    try{
      const info = await (await bajar(p.pagina.replace(/\/?$/, '') + '.json')).json();
      const imgs = ((info.product || {}).images || []).map(i => i.src).filter(u => !/icon/i.test(u)).slice(0, maxFotos);
      if(!imgs.length){ console.log(`  ✗ ${p.nombre}: la página no tiene fotos`); continue; }
      const files = [], rutas = [];
      for(let i = 0; i < imgs.length; i++){
        const buf = Buffer.from(await (await bajar(imgs[i])).arrayBuffer());
        const base = sharp(buf, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' });
        const big = await base.clone().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        const thumb = await base.clone().resize({ width: 500, height: 700, fit: 'inside', withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
        const meta = await sharp(big).metadata();
        const name = `${p.id}-${i}-${crypto.createHash('sha1').update(big).digest('hex').slice(0, 10)}.webp`;
        files.push({ rel: `img/p/${name}`, data: big }, { rel: `img/p/t/${name}`, data: thumb });
        rutas.push(`img/p/${name}`);
        console.log(`    foto ${i + 1}: ${meta.width}×${meta.height} px, ${kb(big.length)} KB  ← ${imgs[i].split('?')[0].split('/').pop()}`);
      }
      plan.push({ p, files, rutas });
      console.log(`  • ${p.nombre}: ${rutas.length} foto(s) oficiales`);
    }catch(e){ console.log(`  ✗ ${p.nombre}: ${e.message}`); }
  }
  console.log(`::notice::${DRY_RUN ? 'Prueba' : 'Aplicando'}: ${plan.length} de ${productos.length} producto(s) con fotos nuevas`);
  if(DRY_RUN || !plan.length){ console.log('DRY_RUN: no se tocó nada.'); return; }

  plan.forEach(x => x.files.forEach(f => { const abs = path.join(ROOT, f.rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, f.data); }));
  const sh = c => execSync(c, { cwd: ROOT, stdio: 'inherit' });
  sh('git config user.name "github-actions[bot]" && git config user.email "41898283+github-actions[bot]@users.noreply.github.com"');
  sh('git add img/p');
  sh(`git commit -q -m "Fotos oficiales del proveedor para ${plan.length} producto(s) [CF-Pages-Skip]"`);
  sh('git pull -q --rebase origin main && git push -q origin HEAD:main');

  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = admin.firestore(); const FieldValue = admin.firestore.FieldValue;
  let hechos = 0;
  for(const { p, rutas } of plan){
    const ok = await db.runTransaction(async tx => {
      const ref = db.collection('products').doc(p.id); const cur = await tx.get(ref);
      if(!cur.exists) return 'no existe';
      const ahora = cur.data().images || [];
      if(JSON.stringify(ahora) !== JSON.stringify(p.fotosActuales)) return 'sus fotos ya se cambiaron en el panel';
      tx.update(ref, { images: rutas, _sync: FieldValue.serverTimestamp() });
      tx.set(db.collection('adminAuditLog').doc(), { action: 'edicion_producto', targetType: 'producto', targetName: cur.data().name || '', targetId: p.id,
        details: `Fotos: ${ahora.length} → ${rutas.length} (oficiales del proveedor)`, userEmail: 'Fotos del proveedor (Acción de GitHub)', date: new Date().toISOString() });
      return true;
    });
    if(ok === true) hechos++; else console.log(`  = ${p.nombre}: no se tocó (${ok})`);
  }
  console.log(`::notice::Fotos cambiadas en ${hechos} producto(s)`);
}
main().catch(e => { console.error(e); process.exit(1); });
