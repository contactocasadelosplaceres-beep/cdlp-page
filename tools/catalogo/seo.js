/* Páginas para Google (SEO): una página fija por producto (/p/<nombre>/) y por categoría (/c/<nombre>/).
   La tienda (index.html) se arma con JavaScript y todos los productos compartían el mismo título, así
   que Google los dejaba "descubiertos, sin indexar". Estas páginas traen título, descripción, precio y
   datos estructurados ya escritos en el HTML, y un botón que abre el producto en la tienda normal.

   Se generan con catalogo.json, en la misma corrida y el mismo commit: no cuestan lecturas de Firestore
   ni publicaciones extra. Solo se reescriben los archivos que cambiaron y se borran los de productos
   que ya no se publican. También reescribe sitemap.xml con estas direcciones. */
const fs = require('fs');
const path = require('path');

const BRAND = 'La Casa de los Placeres';
const CITY = 'Ciudad Guzmán';
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/ñ/g, 'n').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '') || 'producto';
const money = n => '$' + (Math.round(Number(n) * 100) / 100).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const catsOf = p => (Array.isArray(p.categories) && p.categories.length) ? p.categories : (p.cat ? [p.cat] : []);
const imgUrl = (site, s) => (!s || String(s).startsWith('data:')) ? '' : /^https?:/.test(s) ? s : site + '/' + String(s).replace(/^\/+/, '');

// Precio como lo ve la tienda sin cupones: promoción del producto o, con variantes, el rango de sus precios.
function priceInfo(p) {
  const base = (p.promoPrice > 0 && p.promoPrice < p.price) ? Number(p.promoPrice) : Number(p.price) || 0;
  const vs = (Array.isArray(p.variants) ? p.variants : []).filter(v => v && typeof v === 'object');
  if (!vs.length) return { low: base, high: base, list: Number(p.price) || 0 };
  const ps = vs.map(v => {
    const list = v.priceOverride > 0 ? Number(v.priceOverride) : Number(p.price) || 0;
    if (v.promoPriceOverride > 0 && v.promoPriceOverride < list) return Number(v.promoPriceOverride);
    return v.priceOverride > 0 ? list : base;
  }).filter(n => n > 0);
  if (!ps.length) return { low: base, high: base, list: Number(p.price) || 0 };
  return { low: Math.min(...ps), high: Math.max(...ps), list: Number(p.price) || 0 };
}
function inStock(p) {
  const vs = Array.isArray(p.variants) ? p.variants.filter(v => v && typeof v === 'object') : [];
  if (vs.length) return vs.some(v => Number(v.stock) > 0);
  return Number(p.stock) > 0;
}
function shortDesc(p, max) {
  const d = String(p.desc || '').replace(/\s+/g, ' ').trim();
  return d.length > max ? d.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : d;
}

const CSS = `:root{--p:#993477;--d:#5C1F49;--bg:#F9F6F8;--ink:#1A1A1A;--soft:#666;--line:#EBD9D3}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
a{color:var(--p)}header{background:var(--d);color:#fff;padding:12px 16px;display:flex;align-items:center;gap:10px}
header a{color:#fff;text-decoration:none;font-weight:700;display:flex;align-items:center;gap:10px}header img{width:36px;height:36px;border-radius:9px}
main{max-width:960px;margin:0 auto;padding:16px}nav.bc{font-size:13px;color:var(--soft);margin-bottom:12px}nav.bc a{color:var(--soft)}
.prod{display:grid;gap:20px;grid-template-columns:1fr}@media(min-width:760px){.prod{grid-template-columns:1fr 1fr}}
.gal img{width:100%;aspect-ratio:1;object-fit:contain;background:#fff;border-radius:16px;border:1px solid var(--line)}
.gal .th{display:flex;gap:8px;margin-top:8px;overflow:auto}.gal .th img{width:72px;height:72px;flex:none}
h1{font-size:24px;line-height:1.25;margin:0 0 8px}.price{font-size:26px;font-weight:800;color:var(--d)}.was{color:var(--soft);text-decoration:line-through;font-size:16px;margin-left:8px;font-weight:400}
.av{display:inline-block;margin:6px 0 14px;font-size:13px;font-weight:700;padding:4px 10px;border-radius:999px;background:#E7F6EC;color:#1E7A3C}.av.no{background:#F3E8EC;color:#8A3B5B}
.btn{display:block;text-align:center;background:var(--p);color:#fff;text-decoration:none;font-weight:700;padding:14px 18px;border-radius:999px;font-size:17px;margin:8px 0}
.btn.alt{background:#fff;color:var(--p);border:2px solid var(--p)}.desc{white-space:pre-line;color:#333}
ul.ok{list-style:none;padding:0;margin:14px 0;color:var(--soft);font-size:14px}ul.ok li{padding:3px 0}ul.ok li:before{content:'✓ ';color:var(--p);font-weight:700}
h2{font-size:19px;margin:28px 0 10px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:8px;text-decoration:none;color:var(--ink);display:block}
.card img{width:100%;aspect-ratio:1;object-fit:contain;border-radius:10px;background:#fff}.card b{display:block;font-size:14px;line-height:1.3;margin:6px 0 2px;font-weight:600}.card span{color:var(--d);font-weight:800}
.card.no{opacity:.6}.chips{display:flex;flex-wrap:wrap;gap:8px}.chips a{background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 12px;text-decoration:none;font-size:14px}
footer{max-width:960px;margin:24px auto;padding:16px;color:var(--soft);font-size:13px;border-top:1px solid var(--line)}
#ag{position:fixed;inset:0;background:rgba(40,10,32,.92);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9}
#ag div{background:#fff;border-radius:18px;padding:24px;max-width:360px;text-align:center}#ag button{border:0;cursor:pointer;width:100%}`;

// Mismo aviso de mayoría de edad que la tienda (misma llave, si ya lo aceptó no vuelve a salir).
const AGE_GATE = `<div id="ag" hidden><div><p style="font-weight:800;font-size:20px;margin:0 0 8px">Contenido para mayores de 18 años</p><p style="color:#666;margin:0 0 16px">Al continuar confirmas que eres mayor de edad.</p><button class="btn" onclick="try{localStorage.setItem('cdlp_age_confirmed','1')}catch(e){}document.getElementById('ag').hidden=true">Soy mayor de 18</button><a href="https://www.google.com" style="font-size:14px;color:#666">Salir</a></div></div>
<script>try{if(!localStorage.getItem('cdlp_age_confirmed'))document.getElementById('ag').hidden=false}catch(e){}</script>`;

function layout({ site, title, desc, canonical, ogImage, jsonld, body }) {
  return `<!DOCTYPE html>
<html lang="es-MX">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" type="image/png" href="/favicon.png">
<meta name="theme-color" content="#5C1F49">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage || site + '/logo.png')}">
<meta name="twitter:card" content="summary">
${(jsonld || []).map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
<style>${CSS}</style>
</head>
<body>
<header><a href="/"><img src="/logo.png" alt="" width="36" height="36">${BRAND}</a></header>
${body}
<footer>${BRAND} · Sex shop en ${CITY}, Jalisco · Empaque discreto sin marcas · Pago al recibir · Envío $35 en Cd. Guzmán, otras ciudades a cotizar<br><a href="/">Ver todo el catálogo</a></footer>
${AGE_GATE}
</body>
</html>
`;
}

function card(site, p, url) {
  const pi = priceInfo(p), img = imgUrl(site, (p.images || [])[0]);
  const ok = inStock(p);
  return `<a class="card${ok ? '' : ' no'}" href="${esc(url)}">${img ? `<img src="${esc(img.replace(site, ''))}" alt="${esc(p.name)}" loading="lazy" width="150" height="150">` : ''}<b>${esc(p.name)}</b><span>${pi.low !== pi.high ? 'Desde ' : ''}${money(pi.low)}</span>${ok ? '' : ' <small>Agotado</small>'}</a>`;
}

// Escribe solo si cambió; devuelve true si escribió.
function writeIfChanged(file, content) {
  try { if (fs.readFileSync(file, 'utf8') === content) return false; } catch (e) {}
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}
// Borra carpetas /p/x/ o /c/x/ que ya no corresponden a nada publicado.
function prune(dir, keep) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  fs.readdirSync(dir).forEach(name => {
    if (keep.has(name)) return;
    fs.rmSync(path.join(dir, name), { recursive: true, force: true }); n++;
  });
  return n;
}

function writeSeoPages(ROOT, SITE, products, settings, when) {
  settings = settings || {};
  const day = String(when || new Date().toISOString()).slice(0, 10);
  const hiddenCats = new Set(settings.hiddenCategories || []);
  const list = (products || []).filter(p => p && p.id && p.name && !p.hidden && !p.deletedAt)
    .slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // Nombre de página estable: del nombre del producto; si dos se llaman igual, el segundo lleva un pedazo de su id.
  const used = new Set(), slugOf = new Map();
  list.forEach(p => {
    let s = slugify(p.name);
    if (used.has(s)) s = s + '-' + String(p.id).slice(0, 6).toLowerCase();
    used.add(s); slugOf.set(p.id, s);
  });
  const purl = p => `${SITE}/p/${slugOf.get(p.id)}/`;

  // Categorías públicas con productos.
  const catOrder = (settings.categories || []).filter(c => !hiddenCats.has(c));
  const byCat = new Map();
  list.forEach(p => catsOf(p).forEach(c => { if (hiddenCats.has(c)) return; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(p); }));
  const cats = [...byCat.keys()].sort((a, b) => {
    const ia = catOrder.indexOf(a), ib = catOrder.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, 'es');
  });
  const catSlug = new Map(cats.map(c => [c, slugify(c)]));
  const curl = c => `${SITE}/c/${catSlug.get(c)}/`;
  const sortForList = arr => arr.slice().sort((a, b) => (inStock(b) - inStock(a)) || String(a.name).localeCompare(String(b.name), 'es'));

  const orgRef = { '@type': 'Organization', name: BRAND, url: SITE + '/' };
  let written = 0;

  // Páginas de producto
  list.forEach(p => {
    const pi = priceInfo(p), ok = inStock(p), cs = catsOf(p).filter(c => byCat.has(c));
    const imgs = (p.images || []).map(s => imgUrl(SITE, s)).filter(Boolean).slice(0, 6);
    const priceTxt = (pi.low !== pi.high ? 'Desde ' : '') + money(pi.low);
    const title = `${p.name} — ${priceTxt} | ${BRAND}, Cd. Guzmán`;
    const d0 = shortDesc(p, 110);
    const desc = `${p.name} por ${priceTxt}${d0 ? '. ' + d0 : ''}. Empaque discreto y pago al recibir en ${CITY}.`.slice(0, 300);
    const related = cs.length ? sortForList(byCat.get(cs[0]).filter(x => x.id !== p.id && inStock(x))).slice(0, 8) : [];
    const offers = Object.assign({
      '@type': pi.low !== pi.high ? 'AggregateOffer' : 'Offer',
      priceCurrency: 'MXN',
      availability: ok ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      url: purl(p), seller: orgRef,
    }, pi.low !== pi.high ? { lowPrice: pi.low, highPrice: pi.high, offerCount: (p.variants || []).length } : { price: pi.low });
    const jsonld = [
      Object.assign({ '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: shortDesc(p, 500) || p.name,
        brand: { '@type': 'Brand', name: BRAND }, offers }, p.sku ? { sku: p.sku } : {}, imgs.length ? { image: imgs } : {}, cs[0] ? { category: cs[0] } : {}),
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE + '/' },
      ].concat(cs[0] ? [{ '@type': 'ListItem', position: 2, name: cs[0], item: curl(cs[0]) }] : [])
        .concat([{ '@type': 'ListItem', position: cs[0] ? 3 : 2, name: p.name, item: purl(p) }]) },
    ];
    const shop = `/?producto=${encodeURIComponent(p.id)}`;
    const body = `<main>
<nav class="bc"><a href="/">Inicio</a>${cs[0] ? ` › <a href="/c/${catSlug.get(cs[0])}/">${esc(cs[0])}</a>` : ''} › ${esc(p.name)}</nav>
<div class="prod">
<div class="gal">${imgs[0] ? `<img src="${esc(imgs[0].replace(SITE, ''))}" alt="${esc(p.name)}" width="480" height="480">` : ''}${imgs.length > 1 ? `<div class="th">${imgs.slice(1).map(s => `<img src="${esc(s.replace(SITE, ''))}" alt="${esc(p.name)}" loading="lazy" width="72" height="72">`).join('')}</div>` : ''}</div>
<div>
<h1>${esc(p.name)}</h1>
<div class="price">${priceTxt}${pi.low === pi.high && pi.list > pi.low ? `<span class="was">${money(pi.list)}</span>` : ''}</div>
<span class="av${ok ? '' : ' no'}">${ok ? 'Disponible' : 'Agotado'}</span>
<a class="btn" href="${shop}">${ok ? 'Pedir en la tienda' : 'Ver en la tienda'}</a>
<a class="btn alt" href="/">Ver más productos</a>
<ul class="ok"><li>Empaque discreto, sin marcas</li><li>Pagas al recibir</li><li>Envío $35 en Cd. Guzmán · otras ciudades a cotizar</li></ul>
${p.desc ? `<h2>Descripción</h2><div class="desc">${esc(String(p.desc).trim())}</div>` : ''}
${cs.length ? `<h2>Categorías</h2><div class="chips">${cs.map(c => `<a href="/c/${catSlug.get(c)}/">${esc(c)}</a>`).join('')}</div>` : ''}
</div>
</div>
${related.length ? `<h2>También te puede gustar</h2><div class="grid">${related.map(x => card(SITE, x, `/p/${slugOf.get(x.id)}/`)).join('')}</div>` : ''}
</main>`;
    if (writeIfChanged(path.join(ROOT, 'p', slugOf.get(p.id), 'index.html'),
      layout({ site: SITE, title, desc, canonical: purl(p), ogImage: SITE + '/logo.png', jsonld, body }))) written++;
  });

  // Páginas de categoría
  cats.forEach(c => {
    const arr = sortForList(byCat.get(c));
    const nOk = arr.filter(inStock).length;
    const lows = arr.map(x => priceInfo(x).low).filter(n => n > 0);
    const from = lows.length ? Math.min(...lows) : 0;
    const title = `${c} en Ciudad Guzmán | ${BRAND}`;
    const desc = `${c} en ${CITY}: ${nOk} producto${nOk === 1 ? '' : 's'} disponible${nOk === 1 ? '' : 's'}${from ? ' desde ' + money(from) : ''}. Empaque discreto, pago al recibir y envío $35 en Cd. Guzmán.`;
    const jsonld = [
      { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${c} — ${BRAND}`, url: curl(c), isPartOf: { '@type': 'WebSite', name: BRAND, url: SITE + '/' } },
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: c, item: curl(c) }] },
      { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: arr.slice(0, 50).map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: purl(x), name: x.name })) },
    ];
    const body = `<main>
<nav class="bc"><a href="/">Inicio</a> › ${esc(c)}</nav>
<h1>${esc(c)} en Ciudad Guzmán</h1>
<p style="color:#666;margin:0 0 12px">${nOk} disponible${nOk === 1 ? '' : 's'}${from ? ' · desde ' + money(from) : ''} · Empaque discreto · Pagas al recibir</p>
<a class="btn" href="/?categoria=${encodeURIComponent(c)}" style="max-width:360px">Ver ${esc(c)} en la tienda</a>
<div class="grid" style="margin-top:16px">${arr.map(x => card(SITE, x, `/p/${slugOf.get(x.id)}/`)).join('')}</div>
<h2>Otras categorías</h2><div class="chips">${cats.filter(x => x !== c).map(x => `<a href="/c/${catSlug.get(x)}/">${esc(x)}</a>`).join('')}</div>
</main>`;
    if (writeIfChanged(path.join(ROOT, 'c', catSlug.get(c), 'index.html'),
      layout({ site: SITE, title, desc, canonical: curl(c), ogImage: SITE + '/logo.png', jsonld, body }))) written++;
  });

  const removed = prune(path.join(ROOT, 'p'), new Set(slugOf.values())) + prune(path.join(ROOT, 'c'), new Set(catSlug.values()));

  // sitemap.xml: inicio, categorías y productos (las direcciones ?producto= ya no se listan).
  const u = (loc, extra) => `  <url><loc>${esc(loc)}</loc>${extra || ''}</url>`;
  const urls = [u(SITE + '/', `<lastmod>${day}</lastmod><changefreq>daily</changefreq><priority>1.0</priority>`)]
    .concat(cats.map(c => u(curl(c), '<changefreq>daily</changefreq><priority>0.8</priority>')))
    .concat(list.map(p => u(purl(p), '<changefreq>weekly</changefreq><priority>0.6</priority>')));
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);

  // Lista para la tienda: enlaces de categorías que index.html incluye para Google.
  return { products: list.length, categories: cats.length, written, removed, cats: cats.map(c => ({ name: c, url: `/c/${catSlug.get(c)}/` })) };
}

module.exports = { writeSeoPages, slugify };
