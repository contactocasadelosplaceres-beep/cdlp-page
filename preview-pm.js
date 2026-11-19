function pmOpen(key, dflt){ const o = state.pmOpen||{}; return (key in o) ? o[key] : dflt; }
function pmToggle(key, open){ if(!state.pmOpen) state.pmOpen = {}; state.pmOpen[key] = !!open; }
function pmSection(key, title, o){
  o = o||{};
  const head = `
    <span class="fsec-ico">${icon(o.icon||'tag',16)}</span>
    <span class="fsec-titles"><div class="fsec-title">${title}</div>${o.hint?`<div class="fsec-hint">${o.hint}</div>`:''}</span>
    ${o.badge?`<span class="fsec-badge">${o.badge}</span>`:''}
    ${o.status?`<span class="fsec-badge pm-st" id="pmst-${key}">${pmStatusHtml(key)}</span>`:''}`;
  if(!o.collapsible) return `<section class="fsec" id="pmsec-${key}"><div class="fsec-head">${head}</div><div class="fsec-body">${o.body}</div></section>`;
  const open = pmOpen(key, !!o.open);
  return `<details class="fsec" id="pmsec-${key}" ${open?'open':''} ontoggle="pmToggle('${key}',this.open)"><summary class="fsec-head">${head}<span class="fsec-chev">▾</span></summary><div class="fsec-body">${o.body}</div></details>`;
}
/* ---- Revisar ortografía del producto (nombre y descripción) ----
   Usa el corrector gratuito de LanguageTool (api.languagetool.org, español): solo se le manda el
   texto del nombre y la descripción, que de todos modos es público en la tienda. Además detecta
   acentos rotos (Ã©, Â…) y los "??" de importaciones viejas. Las palabras que marques como
   "Siempre ignorar" (marcas, modelos) se guardan en settings.spellIgnore. */
const SPELL_FIELDS = [{key:'name', label:'Nombre'}, {key:'desc', label:'Descripción'}];
function spellIgnoreSet(){ return new Set((state.settings.spellIgnore||[]).map(w=>String(w).toLowerCase())); }
function spellFixMojibake(s){ try{ const f = decodeURIComponent(escape(s)); return f!==s ? f : null; }catch(e){ return null; } }
function spellLocalIssues(field, text){
  const out = [];
  const re = /[ÃÂ][\u0080-¿]|Ã.|ï¿½|�/g; let m;
  if(re.test(text)){
    // Acentos rotos: se intenta reparar el texto completo de una vez.
    const fixed = spellFixMojibake(text);
    out.push({field, offset:0, length:text.length, bad:text, whole:true, kind:'Acentos rotos', msg:'Hay letras con acento o ñ que se ven como símbolos raros (por ejemplo «Ã©» en lugar de «é»).', reps: fixed ? [fixed] : []});
  }
  const q = /\S*\?\?+\S*/g;
  while((m = q.exec(text))){
    out.push({field, offset:m.index, length:m[0].length, bad:m[0], kind:'Signos ??', msg:'Los «??» suelen ser una letra con acento o una ñ que se perdió. Escríbela a mano.', reps:[]});
  }
  return out;
}
const SPELL_KIND = {TYPOS:'Ortografía', GRAMMAR:'Gramática', PUNCTUATION:'Puntuación', TYPOGRAPHY:'Puntuación', CASING:'Mayúsculas', CONFUSED_WORDS:'Palabra confundida', REDUNDANCY:'Repetición', STYLE:'Estilo', MISC:'Revisar'};
async function spellCheckText(text){
  const body = new URLSearchParams({text, language:'es', level:'default'});
  const r = await fetch('https://api.languagetool.org/v2/check', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body});
  if(r.status===429) throw new Error('limite');
  if(!r.ok) throw new Error('HTTP '+r.status);
  return (await r.json()).matches || [];
}
async function spellCheckProduct(){
  const m = state.productModal; if(!m) return;
  state.spell = {modal:m, busy:true, issues:[], error:'', checked:false}; render();
  const ignore = spellIgnoreSet(); const issues = [];
  try{
    for(const f of SPELL_FIELDS){
      const text = String(m[f.key]||''); if(!text.trim()) continue;
      const local = spellLocalIssues(f.key, text);
      issues.push(...local);
      if(local.some(x=>x.whole)) continue;   // con acentos rotos, primero se repara y luego se vuelve a revisar
      const matches = await spellCheckText(text);
      matches.forEach(x=>{
        const bad = text.substr(x.offset, x.length);
        if(!bad || ignore.has(bad.toLowerCase())) return;
        if(/\?\?/.test(bad)) return;   // ya lo marca la revisión local
        const cat = (x.rule && x.rule.category && x.rule.category.id) || 'MISC';
        issues.push({field:f.key, offset:x.offset, length:x.length, bad, kind:SPELL_KIND[cat]||'Revisar', msg:x.message||x.shortMessage||'', reps:(x.replacements||[]).slice(0,4).map(r=>r.value)});
      });
    }
  }catch(e){
    console.error(e);
    state.spell = {modal:m, busy:false, issues, checked:true, error: e.message==='limite' ? 'El corrector recibió muchas revisiones seguidas. Espera un minuto e intenta de nuevo.' : 'No se pudo conectar con el corrector. Revisa tu internet e intenta de nuevo.'};
    render(); return;
  }
  state.spell = {modal:m, busy:false, issues, checked:true, error:''};
  render();
}
function spellActive(){ return state.spell && state.spell.modal===state.productModal ? state.spell : null; }
function spellReplace(i, value){
  const s = spellActive(); if(!s) return false;
  const it = s.issues[i]; if(!it) return false;
  const m = state.productModal; const text = String(m[it.field]||'');
  if(text.substr(it.offset, it.length)!==it.bad){ showToast('El texto cambió desde la revisión; revísalo de nuevo'); spellCheckProduct(); return false; }
  m[it.field] = text.slice(0,it.offset) + value + text.slice(it.offset+it.length);
  const delta = value.length - it.length;
  s.issues.splice(i,1);
  s.issues.forEach(x=>{ if(x.field===it.field && x.offset>it.offset) x.offset += delta; });
  return !!it.whole;
}
function spellApply(i, r){
  const s = spellActive(); if(!s || !s.issues[i]) return;
  const whole = spellReplace(i, s.issues[i].reps[r]);
  if(whole){ spellCheckProduct(); return; }   // tras reparar acentos, revisar ortografía del texto ya limpio
  render();
}
function spellApplyAll(){
  const s = spellActive(); if(!s) return;
  let whole = false;
  // de atrás hacia adelante para que las posiciones no se muevan
  const order = s.issues.map((x,i)=>i).filter(i=>s.issues[i].reps.length).sort((a,b)=>s.issues[b].offset-s.issues[a].offset);
  for(const i of order){ if(spellReplace(i, s.issues[i].reps[0])) whole = true; }
  showToast('Correcciones aplicadas — revisa que todo quede bien antes de guardar');
  if(whole){ spellCheckProduct(); return; }
  render();
}
async function spellIgnore(i, always){
  const s = spellActive(); if(!s || !s.issues[i]) return;
  const it = s.issues[i]; s.issues.splice(i,1);
  if(always && !it.whole){
    const w = it.bad.trim(); const list = state.settings.spellIgnore||[];
    if(w && !list.some(x=>String(x).toLowerCase()===w.toLowerCase())){
      state.settings.spellIgnore = [...list, w].slice(-500);
      try{ await saveSettings(); showToast('«'+w+'» ya no se marcará como error'); }catch(e){ console.error(e); }
    }
    s.issues = s.issues.filter(x=>x.bad.toLowerCase()!==w.toLowerCase());
  }
  render();
}
function renderSpellPanel(){
  const s = spellActive();
  const btn = `<button type="button" class="btn-outline" style="margin-top:10px;" ${s&&s.busy?'disabled':''} onclick="spellCheckProduct()">${icon('check',14)} ${s&&s.busy?'Revisando…':(s&&s.checked?'Revisar de nuevo':'Revisar ortografía')}</button>`;
  if(!s || s.busy || !s.checked) return `<div class="spell-box">${btn}<div class="row-sub" style="margin-top:4px;">Revisa el nombre y la descripción.</div></div>`;
  const ctx = it => {
    const t = String(state.productModal[it.field]||'');
    if(it.whole) return escDescHtml(t.length>90 ? t.slice(0,90)+'…' : t);
    const a = Math.max(0, it.offset-30), b = Math.min(t.length, it.offset+it.length+30);
    return (a>0?'…':'') + escDescHtml(t.slice(a,it.offset)) + '<mark class="spell-bad">'+escDescHtml(it.bad)+'</mark>' + escDescHtml(t.slice(it.offset+it.length,b)) + (b<t.length?'…':'');
  };
  const fieldLabel = k => (SPELL_FIELDS.find(f=>f.key===k)||{}).label||k;
  const fixable = s.issues.filter(x=>x.reps.length).length;
  return `<div class="spell-box">
    ${s.error ? `<div class="login-error" role="alert">${s.error}</div>` : ''}
    ${!s.error && !s.issues.length ? `<div class="note-box" style="background:#EAF3D8;color:var(--green);font-weight:700;margin:10px 0 0;">${icon('check')} Sin errores en el nombre ni en la descripción.</div>` : ''}
    ${s.issues.length ? `<div class="spell-head"><strong>${s.issues.length} ${s.issues.length===1?'cosa por revisar':'cosas por revisar'}</strong>${fixable>1?`<button type="button" class="btn-primary spell-all" onclick="spellApplyAll()">Corregir todo (${fixable})</button>`:''}</div>` : ''}
    ${s.issues.map((it,i)=>`
      <div class="spell-item">
        <div class="row-sub"><strong>${it.kind}</strong> · ${fieldLabel(it.field)}</div>
        <div class="spell-ctx">${ctx(it)}</div>
        ${it.msg?`<div class="row-sub">${escDescHtml(it.msg)}</div>`:''}
        <div class="spell-actions">
          ${it.reps.map((r,ri)=>`<button type="button" class="spell-rep" onclick="spellApply(${i},${ri})">${it.whole?'Reparar acentos':escDescHtml(r)}</button>`).join('')}
          <button type="button" class="spell-ign" onclick="spellIgnore(${i},false)">Ignorar</button>
          ${!it.whole && it.kind==='Ortografía' ? `<button type="button" class="spell-ign" onclick="spellIgnore(${i},true)">Siempre ignorar esta palabra</button>` : ''}
        </div>
      </div>`).join('')}
    ${btn}
  </div>`;
}
/* ---- Lista de pendientes de la ficha de producto ----
   Lo obligatorio (nombre, precio, categoría) no deja guardar; lo recomendado (foto, costo,
   descripción, ¿para quién es?) solo avisa. Se muestra junto al botón Guardar y en el encabezado
   de cada sección, y se actualiza mientras escribes (pmLive) sin redibujar la ventana. */
function pmCats(p){ return (p.categories && p.categories.length) ? p.categories : (p.cat ? [p.cat] : []); }
function pmChecks(p){
  p = p || state.productModal || {};
  const gift = pmCats(p).some(c=>normName(c)==='tarjetas de regalo');
  return [
    {key:'name',  label:'Nombre',          sec:'foto',       field:'pf-name',  req:true,  ok: !!String(p.name||'').trim()},
    {key:'price', label:'Precio',          sec:'precio',     field:'pf-price', req:true,  ok: Number(p.price)>0 || (p.variants||[]).some(v=>Number(v.priceOverride)>0)},
    {key:'cat',   label:'Categoría',       sec:'categorias', field:'',         req:true,  ok: pmCats(p).length>0},
    {key:'foto',  label:'Foto',            sec:'foto',       field:'',         req:false, ok: (p.images||[]).length>0},
    {key:'cost',  label:'Costo',           sec:'precio',     field:'pf-cost',  req:false, ok: gift || Number(p.cost)>0},
    {key:'desc',  label:'Descripción',     sec:'desc',       field:'pf-desc',  req:false, ok: !!String(p.desc||'').trim()},
    {key:'needs', label:'¿Para quién es?', sec:'categorias', field:'',         req:false, ok: gift || (p.needs||[]).length>0},
  ];
}
function pmStatusHtml(sec){
  const miss = pmChecks().filter(c=>c.sec===sec && !c.ok);
  if(!miss.length) return `<span class="pm-st-in ok">✓ Listo</span>`;
  const req = miss.some(c=>c.req);
  return `<span class="pm-st-in ${req?'req':'warn'}">Falta: ${miss.map(c=>c.label.toLowerCase()).join(', ')}</span>`;
}
function pmChecklistHtml(){
  const miss = pmChecks().filter(c=>!c.ok);
  if(!miss.length) return `<span class="pm-ck-ok">✓ Todo listo para guardar</span>`;
  return `<span class="pm-ck-lbl">Falta:</span>` + miss.map(c=>`<button type="button" class="pm-ck ${c.req?'req':'warn'}" onclick="pmGoTo('${c.sec}','${c.field}')" title="${c.req?'Obligatorio':'Recomendado'}">${c.label}${c.req?' *':''}</button>`).join('');
}
function pmLive(){
  const ck = document.getElementById('pm-checklist'); if(ck) ck.innerHTML = pmChecklistHtml();
  ['foto','precio','categorias','desc'].forEach(k=>{ const el = document.getElementById('pmst-'+k); if(el) el.innerHTML = pmStatusHtml(k); });
  const cw = document.getElementById('pf-cost-warn');
  if(cw){ const c = pmChecks().find(x=>x.key==='cost'); cw.style.display = (c && !c.ok) ? '' : 'none'; }
}
function pmGoTo(sec, fieldId){
  const el = document.getElementById('pmsec-'+sec); if(!el) return;
  if(el.tagName==='DETAILS' && !el.open){ el.open = true; pmToggle(sec, true); }
  el.scrollIntoView({behavior:'smooth', block:'start'});
  if(fieldId) setTimeout(()=>{ const f = document.getElementById(fieldId); if(f) f.focus({preventScroll:true}); }, 350);
}
/* Producto nuevo: se copian categoría, proveedor y ubicación del último producto dado de alta
   (útil cuando das de alta varios del mismo surtido). Se guarda solo en este equipo. */
const PM_LAST_KEY = 'cdlp.pmLastDefaults';
function pmLastGet(){ try{ return JSON.parse(localStorage.getItem(PM_LAST_KEY)||'null'); }catch(e){ return null; } }
function pmLastSet(v){ try{ localStorage.setItem(PM_LAST_KEY, JSON.stringify(v)); }catch(e){} }
function newProductModal(){
  const m = {images:[]};
  const last = pmLastGet();
  if(last){
    const cats = (last.categories||[]).filter(c=>(state.settings.categories||[]).includes(c));
    if(cats.length) m.categories = cats;
    if(last.supplierId && (state.suppliers||[]).some(s=>s.id===last.supplierId)) m.supplierId = last.supplierId;
    if(last.location) m.location = last.location;
    if(m.categories || m.supplierId || m.location) m._copied = true;
  }
  m.sku = generateSKU(m);
  return m;
}
function pmClearCopied(){
  const m = state.productModal; if(!m) return;
  delete m.categories; delete m.supplierId; delete m.location; m._copied = false;
  m.sku = generateSKU(m);
  render();
}
function pmConfirmSave(hide){
  const pr = state.pmMissingPrompt; state.pmMissingPrompt = null;
  if(!pr) return;
  if(hide) state.productModal.hidden = true;
  render();
  handleSaveProduct(pr.id, true);
}
function renderPmMissingPrompt(){
  const pr = state.pmMissingPrompt; if(!pr) return '';
  return `
  <div class="modal-overlay" style="z-index:1200;">
    <div class="modal" style="max-width:380px;">
      <h3>Le ${pr.missing.length===1?'falta 1 cosa':'faltan '+pr.missing.length+' cosas'}</h3>
      <div class="panel-sub" style="margin:0 0 12px;">${pr.missing.map(l=>'<strong>'+l+'</strong>').join(', ')}. Puedes guardarlo oculto mientras lo completas, así tus clientas no lo ven a medias.</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button class="btn-primary" style="padding:12px;" onclick="pmConfirmSave(true)">Guardar oculto (borrador)</button>
        <button class="btn-outline" style="padding:12px;" onclick="pmConfirmSave(false)">${state.productModal&&state.productModal.hidden?'Guardar así':'Guardar así y mostrarlo'}</button>
        <button class="btn-cancel" style="padding:12px;" onclick="state.pmMissingPrompt=null;render()">Seguir llenando</button>
      </div>
    </div>
  </div>`;
}
function renderProductModal(){
  const p = state.productModal; const isNew = !p.id;
  const price = Number(p.price)||0;
  const promo = Number(p.promoPrice)||0;
  const cost = Number(p.cost)||0;
  const effective = promo>0 ? promo : price;
  const margin = effective>0 ? Math.round(((effective-cost)/effective)*1000)/10 : 0;
  const profit = Math.round((effective-cost)*100)/100;
  const hasVariants = !!(p.variants&&p.variants.length);
  const canTypeSwitch = !(!isNew && hasVariants);
  const activeCenters = state.centers.filter(c=>c.active);
  const stockTotal = Object.values(p.stockByCenter||{}).reduce((s,n)=>s+(n||0),0);

  const secPhoto = pmSection('foto','Foto y nombre',{icon:'image', status:true, body:`
      <div class="form-field"><label>Fotos (máx. 5) — la primera es la portada</label>
        <div class="pm-photos">
          ${(p.images||[]).map((src,idx)=>`
            <div class="img-thumb">
              ${idx===0?'<span class="pm-cover">Portada</span>':''}
              <img src="${src}" alt="Foto ${idx+1}">
              <div class="img-thumb-actions" onclick="if(event.target===this)openPhotoViewer(${idx})">
                <button type="button" title="Ver en grande" aria-label="Ver foto ${idx+1} en grande" onclick="openPhotoViewer(${idx})">${icon('search')}</button>
                ${idx>0?`<button onclick="moveImage(${idx},-1)">◀</button>`:''}
                ${idx<((p.images||[]).length-1)?`<button onclick="moveImage(${idx},1)">▶</button>`:''}
                <button onclick="removeImage(${idx})">${icon('x')}</button>
              </div>
            </div>`).join('')}
          ${(p.images||[]).length<5 ? `<div class="img-thumb add-thumb" onclick="document.getElementById('img-file-input').click()" role="button" aria-label="Agregar foto">+</div>` : ''}
        </div>
        <input type="file" id="img-file-input" accept="image/*" style="display:none;" onchange="handleImageFileSelected(this)">
        ${(p.images||[]).length ? `<div class="row-sub" style="margin-top:6px;">Toca una foto para verla en grande, ordenarla o quitarla.</div>` : ''}
      </div>
      <div class="form-field"><label>Nombre del producto</label><input id="pf-name" spellcheck="true" lang="es" value="${p.name||''}" oninput="state.productModal.name=this.value;pmLive()"></div>
      <label class="pm-switch">
        <span class="pm-switch-txt">Ocultar de la tienda<small>Sigue existiendo, solo no se muestra a tus clientes</small></span>
        <input type="checkbox" id="pf-hidden" ${p.hidden?'checked':''} onchange="state.productModal.hidden=this.checked">
      </label>`});

  const analysis = !isNew ? (()=>{
    const perf = hasVariants ? computeVariantPerformance(p.id) : [];
    const best = perf.length && perf[0].unitsTotal>0 ? perf[0].id : null;
    const together = computeFrequentlyBoughtTogether(p.id, 3);
    return `
      <details class="fsub" ${pmOpen('analisis',false)?'open':''} ontoggle="pmToggle('analisis',this.open)">
        <summary>${icon('bar-chart',14)} Historial y rendimiento</summary>
        ${renderCostHistorySection(p)}
        <div class="row-sub" style="margin-top:10px;">Visto en la tienda ${productViewsInLastDays(p.id,30)} vez(es) en los últimos 30 días</div>
        <button class="btn-tertiary" style="margin-top:10px;" onclick="openProductPriceHistory('${p.id}')">${icon('history',13)} Ver historial de cambios</button>
        ${perf.length ? `<div style="margin-top:14px;"><div class="row-sub" style="margin-bottom:6px;">Rendimiento por variante:</div>
          ${perf.map(r=>`<div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px;padding:4px 0;gap:8px;"><span>${r.label}${r.id===best?' <span class="status-badge status-ok" style="margin-left:4px;">Más vendida</span>':''}</span><span style="color:var(--ink-soft);text-align:right;">Stock ${r.stock} · ${r.units90} vendida(s) en 90 días · ${r.unitsTotal} en total</span></div>`).join('')}</div>` : ''}
        ${together.length ? `<div style="margin-top:14px;"><div class="row-sub" style="margin-bottom:6px;">Se compra junto con:</div>
          ${together.map(t=>`<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:4px 0;"><span>${t.product.name}</span><span style="color:var(--ink-soft);">${t.count} vez(es)</span></div>`).join('')}</div>` : ''}
      </details>`;
  })() : `<div class="panel-sub" style="margin:10px 0 0;">El historial de costos y de cambios aparece aquí después de guardar el producto.</div>`;

  const secPrice = pmSection('precio','Precio y ganancia',{icon:'dollar-sign', status:true, body:`
      <div class="two-col-keep">
        <div class="form-field"><label>Precio de venta</label><input id="pf-price" type="number" inputmode="decimal" value="${p.price||''}" placeholder="0.00" oninput="state.productModal.price=this.value;updatePriceCalc();pmLive()"></div>
        <div class="form-field"><label>Precio promocional</label><input id="pf-promo" type="number" inputmode="decimal" value="${p.promoPrice||''}" placeholder="0.00" oninput="state.productModal.promoPrice=this.value;updatePriceCalc()"></div>
      </div>
      <div class="form-field" style="margin-bottom:0;"><label>Costo (solo para ti)</label><input id="pf-cost" type="number" inputmode="decimal" value="${p.cost||''}" placeholder="0.00" oninput="state.productModal.cost=this.value;updatePriceCalc();pmLive()">
        <div id="pf-cost-warn" class="pm-warn" ${pmChecks(p).find(x=>x.key==='cost').ok?'style="display:none;"':''}>Sin costo no se puede calcular tu ganancia real.</div></div>
      <div class="pm-result">
        <div><div class="row-sub">Margen de ganancia</div><strong id="pf-margin" style="color:var(--primary-deep);">${margin}%</strong></div>
        <div><div class="row-sub">Ganancia por unidad</div><strong id="pf-profit" style="color:var(--green);">${money(profit)}</strong></div>
      </div>
      <div class="panel-sub" style="margin:8px 0 0;">Tus clientes no ven el costo ni la ganancia.</div>
      ${analysis}`});

  const secStock = p.isKit
    ? pmSection('inventario','Productos del kit',{icon:'package', body: renderKitEditor(p)})
    : hasVariants ? pmSection('inventario','Existencias',{icon:'package', hint:`${(p.variants||[]).reduce((s,v)=>s+(v.stock||0),0)} piezas en total`, body:`
        ${activeCenters.map(c=>`<div class="pm-stock-row"><div style="flex:1;min-width:0;overflow-wrap:anywhere;font-size:13px;font-weight:600;">${c.name}${c.isDefault?' <span style="color:var(--ink-soft);font-weight:400;">(Principal)</span>':''}</div><strong>${(p.variants||[]).reduce((s,v)=>s+vCenterStock(v,c.id),0)}</strong></div>`).join('')}
        <div class="panel-sub" style="margin:8px 0 0;">Este producto maneja variantes: las existencias se capturan por variante y por centro en la sección <strong>Variantes</strong>.</div>`})
    : pmSection('inventario','Existencias',{icon:'package', hint:`${stockTotal} ${stockTotal===1?'pieza':'piezas'} en total`, body:`
        ${activeCenters.map(c=>`
          <div class="pm-stock-row">
            <div style="flex:1;min-width:0;overflow-wrap:anywhere;font-size:13px;font-weight:600;">${c.name}${c.isDefault?' <span style="color:var(--ink-soft);font-weight:400;">(Principal)</span>':''}</div>
            <input type="number" min="0" inputmode="numeric" style="width:92px;flex-shrink:0;padding:9px;border-radius:8px;border:1px solid var(--border);text-align:center;" value="${(p.stockByCenter&&p.stockByCenter[c.id])||0}" onchange="setProductCenterStock('${c.id}', this.value)" aria-label="Existencias en ${escDescHtml(c.name)}">
          </div>`).join('')}
        <div class="pm-stock-total"><span>Total</span><strong><span id="pf-stock-total">${stockTotal}</span> unidades</strong></div>
        <div class="panel-sub" style="margin:8px 0 0;">El total se suma solo a partir de cada centro.</div>`});

  const secDesc = pmSection('desc','Descripción',{icon:'edit', status:true, hint:'Lo que tus clientes leen en la tienda', body:`
      <div class="form-field" style="margin-bottom:0;"><textarea id="pf-desc" spellcheck="true" lang="es" rows="4" aria-label="Descripción breve" placeholder="Cuenta de qué trata el producto en pocas líneas…" oninput="state.productModal.desc=this.value;pmLive()">${p.desc||''}</textarea>${renderSpellPanel()}</div>`});

  const secCats = pmSection('categorias','Categorías y público',{icon:'tag', status:true, hint:'Para que tus clientes lo encuentren', body:`
      ${isNew && p._copied ? `<div class="pm-copied">${icon('copy',13)} Copié la categoría, el proveedor y la ubicación del último producto que diste de alta. <button type="button" class="btn-tertiary" onclick="pmClearCopied()">Empezar en blanco</button></div>` : ''}
      <div class="form-field"><label>Categorías *</label>
        <div class="pm-chips">
          ${state.settings.categories.map(c=>`
            <label><input type="checkbox" value="${escDescHtml(c)}" ${pmCats(p).includes(c)?'checked':''} onchange="toggleProductCategory('${c.replace(/'/g,"\\'")}',this.checked)"> ${c}</label>`).join('')}
        </div>
      </div>
      <div class="form-field" style="margin-bottom:0;"><label>¿Para quién es?</label>
        <div class="panel-sub" style="margin:0 0 8px;">Aparece en la sección "¿Qué estás buscando?" de la tienda. Al elegir la categoría te lo sugiero solo; revísalo.</div>
        <button type="button" class="btn-tertiary" style="margin-bottom:10px;" onclick="applySuggestedNeeds()">${icon('star',13)} Sugerir según nombre y categoría</button>
        <div class="pm-chips">
          ${(state.settings.needs||DEFAULT_NEEDS).map(n=>`
            <label><input type="checkbox" value="${n.key}" ${(p.needs||[]).includes(n.key)?'checked':''} onchange="toggleProductNeed('${n.key}',this.checked)"> ${n.label}</label>`).join('')}
        </div>
      </div>`});

  const variantCount = (p.variants||[]).length;
  const secVariants = pmSection('variantes','Variantes',{icon:'grid', collapsible:true, open: variantCount>0 || (p.variantGroups||[]).length>0,
    badge: variantCount ? `${variantCount}` : 'Opcional', hint:'¿Tiene tallas, colores u otras opciones? Agrégalas aquí', body: renderVariantsEditor(p)});

  const secInternal = pmSection('interno','Datos internos',{icon:'sliders', collapsible:true, open:false, badge:'Solo tú', hint:'SKU, ubicación, proveedor, caducidad y código de barras', body:`
      <div class="two-col">
        <div class="form-field"><label>SKU</label>
          <div style="display:flex;gap:6px;">
            <input id="pf-sku" value="${p.sku||''}" style="flex:1;min-width:0;" oninput="state.productModal.sku=this.value;render()">
            <button class="btn-outline" style="padding:0 12px;white-space:nowrap;" onclick="regenerateSKU()">Generar</button>
          </div>
        </div>
        <div class="form-field"><label>Ubicación en almacén</label>
          <input id="pf-location" placeholder="Ej. Pasillo 2, Estante C" value="${p.location||''}" oninput="state.productModal.location=this.value">
        </div>
        <div class="form-field"><label>Proveedor</label>
          <select id="pf-supplier" onchange="state.productModal.supplierId=this.value">
            <option value="">Sin proveedor</option>
            ${state.suppliers.map(s=>`<option value="${s.id}" ${p.supplierId===s.id?'selected':''}>${s.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>Fecha de caducidad</label>
          <input id="pf-expiration" type="date" value="${(p.batches&&p.batches.length) ? earliestExpiry(p.batches) : (p.expirationDate||'')}" ${(p.batches&&p.batches.length)?'disabled title="Se toma de tus lotes"':''} oninput="state.productModal.expirationDate=this.value">
          ${(p.batches&&p.batches.length) ? '<div class="row-sub" style="margin-top:4px;">Se toma del lote que caduca primero (ver Lotes y caducidades).</div>' : ''}
        </div>
        <div class="form-field"><label>Avisarme cuando queden</label>
          <input id="pf-low-stock-threshold" type="number" min="1" inputmode="numeric" placeholder="3 (por default)" value="${p.lowStockThreshold||''}" oninput="state.productModal.lowStockThreshold=this.value">
        </div>
      </div>
      <div class="form-field"><label>Código de barras</label>
        ${p.sku ? `
          <div class="pm-barcode">
            <svg id="pf-barcode-svg"></svg>
            <button class="btn-outline" onclick="printProductLabel('${p.id}')">${icon('printer',14)} Imprimir etiqueta</button>
          </div>
        ` : `<div class="panel-sub" style="margin:4px 0 0;">Genera o escribe un SKU arriba para poder crear su código de barras.</div>`}
      </div>
      ${!isNew ? `<button class="btn-outline" style="width:100%;" onclick="openProductHistory('${p.id}')">${icon('history',14)} Ver movimientos de este producto</button>` : ''}`});

  const typeBody = `
      ${canTypeSwitch ? `
      <label class="pm-switch">
        <span class="pm-switch-txt">Es un kit o combo<small>Se arma con otros productos que ya existen</small></span>
        <input type="checkbox" id="pf-iskit" ${p.isKit?'checked':''} onchange="toggleProductIsKit(this.checked)">
      </label>
      <label class="pm-switch" style="margin-top:8px;">
        <span class="pm-switch-txt">Es una caja sorpresa<small>Combo aleatorio armado al momento del pedido</small></span>
        <input type="checkbox" id="pf-mysterybox" ${p.isMysteryBox?'checked':''} onchange="toggleProductIsMysteryBox(this.checked)">
      </label>` : `<div class="panel-sub" style="margin:0;">Un producto con variantes no puede ser kit ni caja sorpresa.</div>`}
      ${p.isMysteryBox ? `
      <div class="panel" style="margin:12px 0 0;background:var(--bg);">
        <div class="panel-sub" style="margin-top:0;">Al comprarla, el sistema elige al azar productos reales con existencia (de la categoría que elijas) hasta completar el número de piezas indicado. La clienta no ve cuáles son hasta que le llegue.</div>
        <div class="two-col">
          <div class="form-field"><label>Categoría de donde se sortean</label>
            <select id="pf-mystery-cat" onchange="state.productModal.mysteryCategory=this.value">
              <option value="Cualquiera" ${(p.mysteryCategory||'Cualquiera')==='Cualquiera'?'selected':''}>Cualquiera (todo el catálogo)</option>
              ${state.settings.categories.map(c=>`<option value="${c}" ${p.mysteryCategory===c?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-field"><label>Productos que incluye</label>
            <input id="pf-mystery-count" type="number" min="1" inputmode="numeric" value="${p.mysteryItemCount||3}" oninput="state.productModal.mysteryItemCount=this.value">
          </div>
        </div>
        <div class="panel-sub" style="margin-bottom:0;">Las existencias se manejan como cualquier producto: represéntalas como cuántas cajas puedes armar por ahora.</div>
      </div>` : ''}`;
  const secType = pmSection('tipo','Tipo de producto',{icon:'package', collapsible:true, open: !!(p.isKit||p.isMysteryBox),
    badge: p.isKit?'Kit':(p.isMysteryBox?'Caja sorpresa':'Normal'), hint:'Kit, combo o caja sorpresa', body:typeBody});

  return `
  <div class="modal-overlay">
    <div class="modal pm-modal">
      <h3>${isNew?'Nuevo producto':'Editar producto'}</h3>
      ${secPhoto}
      ${secPrice}
      ${secCats}
      ${secDesc}
      ${secStock}
      ${secVariants}
      ${p.isKit ? '' : renderBatchesSection(p)}
      ${secType}
      ${secInternal}
      <div class="modal-actions">
        <div class="pm-checklist" id="pm-checklist" aria-live="polite">${pmChecklistHtml()}</div>
        <button class="btn-cancel" onclick="state.productModal=null;render()" ${state.savingProduct?'disabled':''}>Cancelar</button>
        <button class="btn-primary" onclick="handleSaveProduct('${p.id||''}')" ${state.savingProduct?'disabled':''}>${state.savingProduct?'Guardando…':'Guardar'}</button>
      </div>
    </div>
  </div>${renderPmMissingPrompt()}`;
}
// Sugerencia automática de "¿Para quién es?" a partir del nombre y la categoría —
// mismo criterio que se usó para etiquetar los 547 productos del catálogo original,
// adaptado como botón dentro de la ficha de cada producto nuevo. Es un punto de
// partida, no una asignación final: Ale revisa y ajusta antes de guardar.
function has_(name, ...words){ return words.some(w=>name.includes(w)); }
function suggestNeedsForProduct(p){
  const name = normName(p.name||'');
  const cat = normName((p.categories&&p.categories[0]) || p.cat || '');
  let tags = new Set();

  if(cat==='ropa femenina') tags = new Set(['para-mi','para-ella','para-pareja']);
  else if(cat==='ropa masculina') tags = new Set(['para-mi','para-el','para-pareja']);
  else if(cat==='tarjetas de regalo') tags = new Set();
  else if(cat==='juegos'){
    if(has_(name,'despedida de soltera')) tags = new Set();
    else{ tags.add('compartir-pareja'); if(has_(name,'jenga','dado','dados','cartas','naipes','boletos')) tags.add('empezando'); }
  } else if(cat==='satisfyer'){
    if(has_(name,'parejas')) tags = new Set(['compartir-pareja','para-mi']);
    else if(has_(name,' man ') || name.startsWith('man ') || has_(name,'man heat','para el pene')) tags = new Set(['para-el','para-mi']);
    else if(has_(name,'clitoris','panty','cutie')) tags = new Set(['para-ella','para-mi']);
    else tags.add('para-mi');
  } else if(cat==='comestibles'){
    if(has_(name,'pareja')) tags = new Set(['compartir-pareja','para-pareja']);
    else if(has_(name,'hombre','masculin')) tags = new Set(['para-el','para-mi']);
    else if(has_(name,'mujer','femenin')) tags = new Set(['para-ella','para-mi']);
    else tags.add('para-mi');
  } else if(cat==='complementos'){
    if(has_(name,'hombre','masculin')) tags = new Set(['para-el','para-mi']);
    else if(has_(name,'mujer','femenin')) tags = new Set(['para-ella','para-mi']);
    else if(has_(name,'latigo','esposas','pinzas para pezon','mascara','antifaz','cadena','vela','petalos','almohada','splash','spray')) tags = new Set(['compartir-pareja','para-mi']);
    else tags.add('para-mi');
  } else if(cat==='sadomasoquismo') tags = new Set(['compartir-pareja','para-mi']);
  else if(cat==='plugs'){
    tags.add('para-mi');
    if(has_(name,'gema','cola de zorro','cola de conejo','corazon')) tags.add('empezando');
  } else if(cat==='dildos'){
    tags = new Set(['para-mi','para-ella']);
    if(/\b([789])(\.\d+)?\s*cm/.test(name) || has_(name,'mini')) tags.add('empezando');
  } else if(cat==='lubricantes'){
    tags.add('para-mi');
    if(has_(name,'femenin','vaginal','estrechador','clitoris')) tags.add('para-ella');
    if(has_(name,'ereccion','erecto','engrosador','garganta profunda','para hombre')) tags.add('para-el');
    if(has_(name,'unisex','pareja','duo','multiorgasmico','condon')) tags.add('compartir-pareja');
  } else if(cat==='ocultos'){
    tags = new Set(['para-mi','compartir-pareja']);
    if(has_(name,'para ella')) tags.add('para-ella');
  } else if(cat==='juguetes'){
    const esMasturbadorMasculino = has_(name,'masturbador','mastubador','funda para pene','funda de pene','funda realista','penis pump','bomba de succion','entrenador para pene','jaula de castidad') ||
      (has_(name,'vagina','boca','garganta','ano') && !has_(name,'succionador','clitoris'));
    if(esMasturbadorMasculino) tags = new Set(['para-el','para-mi','para-pareja']);
    else if(has_(name,'anillo')) tags = new Set(['para-el','compartir-pareja','para-mi']);
    else if(has_(name,'succionador','clitoris','punto g','kegel','pezon','pezonera')) tags = new Set(['para-ella','para-mi']);
    else if(has_(name,'dildo','vibrador','consolador','bala','miembro')) tags = new Set(['para-mi','para-ella']);
    else if(has_(name,'plug','prostat') || (has_(name,'anal') && !has_(name,'masturbador'))) tags.add('para-mi');
    else if(has_(name,'esposas','arnes','arnés','correa','columpio','collar con pinzas','mordaza')) tags = new Set(['compartir-pareja','para-mi']);
    else tags.add('para-mi');
    if(has_(name,'doble cabeza','doble penetracion','para parejas','control remoto','control por app','butterfly','mariposa')) tags.add('compartir-pareja');
    if(has_(name,'pezon','pezonera')) tags.add('para-ella');
    if(has_(name,'mini','pequen','chico','bolsillo')) tags.add('empezando');
  } else {
    tags.add('para-mi');
  }
  return Array.from(tags).filter(k=>(state.settings.needs||DEFAULT_NEEDS).some(n=>n.key===k));
}
function applySuggestedNeeds(){
  const p = state.productModal;
  const suggested = suggestNeedsForProduct(p);
  if(!suggested.length){ showToast('No se encontró una sugerencia clara para este producto'); return; }
  p.needs = suggested;
  showToast('Sugerencia aplicada — revísala antes de guardar');
  render();
}
function toggleProductNeed(key, checked){
  if(!state.productModal.needs) state.productModal.needs = [];
  if(checked){ if(!state.productModal.needs.includes(key)) state.productModal.needs.push(key); }
  else{ state.productModal.needs = state.productModal.needs.filter(k=>k!==key); }
  pmLive();
}
function toggleProductCategory(cat, checked){
  const p = state.productModal;
  if(!p.categories) p.categories = p.cat ? [p.cat] : [];
  if(checked){ if(!p.categories.includes(cat)) p.categories.push(cat); }
  else{ p.categories = p.categories.filter(c=>c!==cat); }
  // Si aún no hay "¿Para quién es?", se sugiere solo al elegir la categoría (se puede ajustar).
  if(checked && !(p.needs||[]).length){
    const sug = suggestNeedsForProduct(p);
    if(sug.length){ p.needs = sug; showToast('Te sugerí "¿Para quién es?" — revísalo'); render(); return; }
  }
  pmLive();
}
function setProductCenterStock(centerId, value){
  if(!state.productModal.stockByCenter) state.productModal.stockByCenter = {};
  state.productModal.stockByCenter[centerId] = Math.max(0, Number(value)||0);
  const totalEl = document.getElementById('pf-stock-total');
  if(totalEl) totalEl.textContent = Object.values(state.productModal.stockByCenter).reduce((s,n)=>s+(n||0),0);
}
function updatePriceCalc(){
  const price = Number(document.getElementById('pf-price').value)||0;
  const promo = Number(document.getElementById('pf-promo').value)||0;
  const cost = Number(document.getElementById('pf-cost').value)||0;
  const effective = promo>0 ? promo : price;
  const margin = effective>0 ? Math.round(((effective-cost)/effective)*1000)/10 : 0;
  const profit = Math.round((effective-cost)*100)/100;
  const marginEl = document.getElementById('pf-margin'); if(marginEl) marginEl.textContent = margin+'%';
  const profitEl = document.getElementById('pf-profit'); if(profitEl) profitEl.textContent = money(profit);
}
function generateSKU(product){
  const catPart = ((product.categories&&product.categories[0])||product.cat||'GEN').toUpperCase().replace(/[^A-Z]/g,'').slice(0,3) || 'GEN';
  const namePart = (product.name||'PROD').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4) || 'PROD';
  const rand = Math.random().toString(36).slice(2,6).toUpperCase();
  return `${catPart}-${namePart}-${rand}`;
}
function regenerateSKU(){
  const name = document.getElementById('pf-name').value.trim();
  const sku = generateSKU({name, categories: state.productModal.categories, cat: state.productModal.cat});
  state.productModal.sku = sku;
  render();
}
// Dibuja el código de barras (Code128, a partir del SKU) dentro del modal de edición de
// producto. Se llama de nuevo después de cada render mientras el modal esté abierto, porque
// render() reconstruye todo el HTML y el dibujo del código de barras no sobrevive a eso.
function drawProductBarcode(){
  try{ JsBarcode('#pf-barcode-svg', state.productModal.sku, {format:'CODE128', displayValue:true, fontSize:13, height:44, margin:4}); }
  catch(e){ console.error('No se pudo generar el código de barras', e); }
}
// Etiquetas: un producto con variantes imprime una etiqueta POR VARIANTE (con su SKU y su precio).
function labelEntriesFor(p){
  const vs = p.variants||[];
  if(!vs.length) return [{name:p.name||'', sku:p.sku||'', price:p.promoPrice>0?p.promoPrice:p.price}];
  return vs.map(v=>({name:(p.name||'')+' — '+varLabelOf(v), sku:v.sku||p.sku||'', price:varUnitPrice(p,v)}));
}
function printProductLabel(id){
  const p = state.products.find(x=>x.id===id) || state.productModal;
  const entries = p ? labelEntriesFor(p).filter(e=>e.sku) : [];
  if(!p || !entries.length){ showToast('Este producto no tiene SKU todavía'); return; }
  const w = window.open('', '_blank', 'width=420,height=320');
  if(!w){ showToast('Tu navegador bloqueó la ventana de impresión — permite ventanas emergentes para este sitio'); return; }
  w.document.write(`<html><head><title>Etiqueta — ${(p.name||'').replace(/</g,'&lt;')}</title>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.12.3/dist/JsBarcode.all.min.js" integrity="sha384-vmcSy8TM1KhZWBIKMKTR8AxbrJQCuConAolGY+42odu9ZGIzw8L8xAT/u7ul4X2U" crossorigin="anonymous"><\/script>
    <style>body{font-family:sans-serif;text-align:center;padding:16px;} .l{page-break-after:always;margin-bottom:12px;} .name{font-size:13px;font-weight:700;margin-bottom:4px;} .price{font-size:16px;font-weight:800;margin-top:6px;}</style>
    </head><body>
    ${entries.map((e,i)=>`<div class="l"><div class="name">${e.name.replace(/</g,'&lt;')}</div><svg id="lbl${i}"></svg><div class="price">${money(e.price)}</div></div>`).join('')}
    <script>
      ${entries.map((e,i)=>`JsBarcode("#lbl${i}", ${JSON.stringify(e.sku)}, {format:"CODE128", displayValue:true, fontSize:12, height:42, margin:2});`).join('\n')}
      window.onload = function(){ setTimeout(function(){ window.print(); }, 200); };
    <\/script>
    </body></html>`);
  w.document.close();
}
function printProductLabelsBulk(ids){
  const products = ids.map(id=>state.products.find(p=>p.id===id)).filter(Boolean);
  const withSku = products.flatMap(p=>labelEntriesFor(p).filter(e=>e.sku).map(e=>({...e, _pid:p.id})));
  if(!withSku.length){ showToast('Ninguno de los seleccionados tiene SKU todavía — genera SKU primero'); return; }
  const w = window.open('', '_blank');
  if(!w){ showToast('Tu navegador bloqueó la ventana de impresión — permite ventanas emergentes para este sitio'); return; }
  w.document.write(`<html><head><title>Etiquetas (${withSku.length})</title>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.12.3/dist/JsBarcode.all.min.js" integrity="sha384-vmcSy8TM1KhZWBIKMKTR8AxbrJQCuConAolGY+42odu9ZGIzw8L8xAT/u7ul4X2U" crossorigin="anonymous"><\/script>
    <style>
      body{font-family:sans-serif;margin:10px;}
      .sheet{display:flex;flex-wrap:wrap;gap:10px;}
      .label{width:180px;border:1px dashed #999;text-align:center;padding:8px;page-break-inside:avoid;}
      .name{font-size:11px;font-weight:700;line-height:1.3;}
      .price{font-size:13px;font-weight:800;margin-top:2px;}
    </style></head><body>
    <div class="sheet">
      ${withSku.map((p,i)=>`<div class="label"><div class="name">${(p.name||'').replace(/</g,'&lt;')}</div><svg id="lbl${i}"></svg><div class="price">${money(p.price)}</div></div>`).join('')}
    </div>
    <script>
      ${withSku.map((p,i)=>`JsBarcode("#lbl${i}", ${JSON.stringify(p.sku)}, {format:"CODE128", displayValue:true, fontSize:10, height:32, margin:2, width:1.4});`).join('\n')}
      window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };
    <\/script>
    </body></html>`);
  w.document.close();
  const printedPids = new Set(withSku.map(e=>e._pid));
  if(printedPids.size < products.length) showToast(`Se imprimieron ${printedPids.size} de ${products.length} productos — a los demás les falta SKU`);
}

/* ---- Variantes ----
   Flujo: 1) elegir la PROPIEDAD que cambia (Color, Talla, Tamaño… o una propia), 2) agregar sus VALORES
   (Azul, Blanco…), 3) las variantes se generan solas y cada una lleva su precio, precio promocional,
   foto, costo, SKU y existencias por centro. Se guarda como variantGroups [{name, values}] + variants
   [{id, combo:{Propiedad:valor}, sku, stock, stockByCenter, priceOverride, promoPriceOverride, cost, imageIdx}]. */
const VAR_PROP_SUGGESTIONS = ['Color','Talla','Tamaño','Sabor','Material','Presentación','Modelo','Aroma','Potencia','Largo'];
const VAR_VALUE_SUGGESTIONS = {
  color:['Blanco','Negro','Rojo','Rosa','Azul','Verde','Morado','Café','Nude','Dorado','Plateado','Transparente'],
  talla:['Unitalla','CH','M','G','XG','XXG','28','30','32','34','36'],
  tamano:['Mini','Chico','Mediano','Grande','Extra grande'],
  sabor:['Fresa','Chocolate','Menta','Vainilla','Sandía','Cereza','Coco','Natural'],
  material:['Silicón','Látex','Vidrio','Metal','Cuero','Encaje'],
  presentacion:['30 ml','60 ml','120 ml','250 ml','500 ml'],
  aroma:['Rosas','Vainilla','Lavanda','Coco','Sin aroma'],
  potencia:['Suave','Media','Fuerte'],
  largo:['15 cm','18 cm','20 cm','25 cm'],
  modelo:[],
};
/* ---- Reparación de la estructura de variantes ----
   Algunos productos (importados de Tiendanube o editados con el editor viejo) traen variantes cuyas
   propiedades no cuadran: sin "variantGroups", grupos con "options" en vez de "values", o
   combinaciones escritas distinto ("rojo " vs "Rojo", "color" vs "Color"). La tienda y el POS
   entonces no podían elegir variante. Esto lo arregla en memoria (y el panel lo guarda). */
function variantRepair(p){
  const vs = Array.isArray(p && p.variants) ? p.variants : [];
  if(!vs.length) return {changed:false, problems:[]};
  // Se compara sin importar el orden de los campos: Firestore puede devolver {values, name} en vez de
  // {name, values} y eso NO es un problema (antes hacía que productos ya reparados volvieran a la lista).
  const stableJson = x => JSON.stringify(x, (k,v)=> (v && typeof v==='object' && !Array.isArray(v)) ? Object.keys(v).sort().reduce((o,kk)=>(o[kk]=v[kk],o),{}) : v);
  const before = stableJson([p.variantGroups||null, vs.map(v=>[v.id, v.combo])]);
  const problems = [];
  const nk = s=>String(s==null?'':s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  let groups = (Array.isArray(p.variantGroups)?p.variantGroups:[]).filter(g=>g && String(g.name||'').trim()).map(g=>({
    name: String(g.name).trim(),
    values: (Array.isArray(g.values)?g.values:Array.isArray(g.options)?g.options:[]).map(x=>String(x==null?'':x).trim()).filter(Boolean)
  }));
  if(!(Array.isArray(p.variantGroups) && p.variantGroups.length)) problems.push('tenía variantes pero no sus propiedades');
  else if(p.variantGroups.some(g=>g && !Array.isArray(g.values))) problems.push('una propiedad no tenía su lista de opciones');
  vs.forEach((v,i)=>{
    if(!v.id){ v.id = 'v'+i+'_'+String(p.id||'').slice(-4); problems.push('variante sin identificador'); }
    if(!v.combo || typeof v.combo!=='object' || !Object.keys(v.combo).length){ v.combo = {'Opción': String(v.name||v.sku||('Opción '+(i+1)))}; problems.push('variante sin combinación'); }
  });
  if(!groups.length){
    const map = {};
    vs.forEach(v=>Object.entries(v.combo).forEach(([k,val])=>{ k=String(k).trim(); val=String(val==null?'':val).trim(); (map[k]=map[k]||[]); if(val && !map[k].includes(val)) map[k].push(val); }));
    groups = Object.entries(map).map(([name,values])=>({name, values}));
  }
  let mism = false;
  vs.forEach(v=>{
    const nc = {};
    Object.entries(v.combo).forEach(([k,val])=>{
      let g = groups.find(x=>nk(x.name)===nk(k));
      if(!g){ g = {name:String(k).trim(), values:[]}; groups.push(g); mism = true; }
      const sval = String(val==null?'':val).trim() || 'Única';
      let hit = g.values.find(x=>nk(x)===nk(sval));
      if(hit===undefined){ hit = sval; g.values.push(sval); mism = true; }
      if(g.name!==k || hit!==val) mism = true;
      nc[g.name] = hit;
    });
    v.combo = nc;
  });
  groups = groups.filter(g=>vs.some(v=>g.name in v.combo));
  vs.forEach(v=>groups.forEach(g=>{ if(!(g.name in v.combo)){ v.combo[g.name] = 'Sin especificar'; if(!g.values.includes('Sin especificar')) g.values.push('Sin especificar'); mism = true; } }));
  groups.forEach(g=>{ g.values = g.values.filter(val=>vs.some(v=>v.combo[g.name]===val)); });
  if(mism) problems.push('las opciones de las variantes no coincidían con sus propiedades');
  p.variantGroups = groups;
  const changed = before !== stableJson([p.variantGroups, vs.map(v=>[v.id, v.combo])]);
  if(changed && !problems.length) problems.push('la lista de opciones tenía valores repetidos o sin variante');
  return {changed, problems: changed ? [...new Set(problems)] : []};
}
function variantRepairAll(list){ (list||[]).forEach(p=>{ try{ variantRepair(p); }catch(e){ console.warn('variantRepair', p && p.id, e); } }); return list; }
function variantRepairPreview(p){ const c = JSON.parse(JSON.stringify(p)); return variantRepair(c); }
function variantStockOnlyInProduct(p){ const vs = p.variants||[]; return vs.length>0 && vs.every(v=>!(Number(v.stock)>0)) && Number(p.stock)>0; }
async function repairProductVariants(ids, silent){
  ids = (ids||[]).filter(id=>state.products.some(p=>p.id===id)); if(!ids.length) return 0;
  let n = 0;
  for(const id of ids){
    const p = state.products.find(x=>x.id===id);
    const c = JSON.parse(JSON.stringify(p)); const r = variantRepair(c);
    if(!r.changed) continue;
    try{ await db.collection('products').doc(id).update({variantGroups:c.variantGroups, variants:c.variants}); p.variantGroups = c.variantGroups; p.variants = c.variants; n++; }
    catch(e){ console.error(e); showToast('No se pudo reparar '+p.name); }
  }
  if(n){ try{ logAdminAction('reparar_variantes','producto', n+' producto(s)'); }catch(e){} }
  if(!silent) showToast(n ? `Variantes reparadas en ${n} producto(s)` : 'No había nada que reparar');
  render(); return n;
}
function varKey(s){ return searchClean(s).replace(/\s+/g,''); }
function varLabelOf(v){ return Object.values((v&&v.combo)||{}).join(' / ') || (v && v.name) || 'Variante'; }
// Productos viejos (importados o creados con el editor anterior): si hay variantes pero no propiedades, se reconstruyen.
function varEnsureGroups(p){
  if(!(p.variants && p.variants.length)) return;
  if((p.variantGroups||[]).some(g=>g.name && (g.values||[]).length)) return;
  const groups = {};
  p.variants.forEach(v=>{
    if(!v.combo || !Object.keys(v.combo).length) v.combo = {'Opción': v.name || 'Variante'};
    Object.entries(v.combo).forEach(([k,val])=>{ (groups[k] = groups[k] || []); if(!groups[k].includes(val)) groups[k].push(val); });
  });
  p.variantGroups = Object.entries(groups).map(([name,values])=>({name, values}));
}
function renderVariantsEditor(p){
  varEnsureGroups(p);
  const groups = p.variantGroups || [];
  const variants = p.variants || [];
  const pcost = Number(p.cost)||0, pprice = Number(p.price)||0;
  const centersAct = state.centers.filter(c=>c.active);
  const usedProps = new Set(groups.map(g=>varKey(g.name)));
  const propChips = (extra)=>VAR_PROP_SUGGESTIONS.filter(n=>!usedProps.has(varKey(n))).map(n=>`<button type="button" class="vchip" onclick="addVariantProp('${n}')">+ ${n}</button>`).join('') + extra;
  const customProp = `<div class="vadd"><input id="var-newprop" placeholder="Otra propiedad (ej. Voltaje)" maxlength="30" onkeydown="if(event.key==='Enter'){event.preventDefault();addVariantProp(this.value)}"><button type="button" class="btn-outline" onclick="addVariantProp(document.getElementById('var-newprop').value)">Agregar</button></div>`;
  return `
    <div class="panel" style="background:var(--bg);">
      ${groups.length===0 ? `
        <div class="var-intro"><strong>¿Qué cambia entre una opción y otra?</strong>
          <div class="panel-sub" style="margin:2px 0 10px;">Elige la propiedad (por ejemplo Color o Talla) y después agregas sus opciones. Cada una tendrá su precio, foto y existencias.</div>
          <div class="vchips">${propChips('')}</div>${customProp}
        </div>` : groups.map((g,idx)=>{
        const sugg = (VAR_VALUE_SUGGESTIONS[varKey(g.name)]||[]).filter(x=>!(g.values||[]).some(v=>varKey(v)===varKey(x)));
        return `
        <div class="vgroup">
          <div class="vgroup-h"><div><span class="vgroup-k">Propiedad</span><strong>${escDescHtml(g.name)}</strong></div><button type="button" class="btn-danger-text" onclick="removeVariantProp(${idx})">Quitar propiedad</button></div>
          <div class="vchips">${(g.values||[]).map(v=>`<span class="vval">${escDescHtml(v)}<button type="button" aria-label="Quitar ${escDescHtml(v)}" onclick="removeVariantValue(${idx},decodeURIComponent('${attrEnc(v)}'))">×</button></span>`).join('') || `<span class="panel-sub" style="margin:0;">Aún sin opciones. Agrega la primera:</span>`}</div>
          <div class="vadd"><input id="var-val-${idx}" placeholder="Agrega ${/^[aeiou]/i.test(g.name)?'un':'un'} valor (ej. ${escDescHtml((VAR_VALUE_SUGGESTIONS[varKey(g.name)]||['Opción 1'])[0])})" maxlength="40" onkeydown="if(event.key==='Enter'){event.preventDefault();addVariantValues(${idx},this.value)}"><button type="button" class="btn-primary" style="width:auto;padding:0 16px;" onclick="addVariantValues(${idx},document.getElementById('var-val-${idx}').value)">Agregar</button></div>
          ${sugg.length ? `<div class="vchips" style="margin-top:8px;"><span class="var-lbl" style="margin:0 4px 0 0;align-self:center;">Sugeridos:</span>${sugg.map(x=>`<button type="button" class="vchip" onclick="addVariantValues(${idx},decodeURIComponent('${attrEnc(x)}'))">+ ${escDescHtml(x)}</button>`).join('')}</div>` : ''}
        </div>`; }).join('')}
      ${groups.length>0 && groups.length<3 ? (state.varAddingProp
        ? `<div class="vgroup"><div class="vgroup-h"><strong>Agregar otra propiedad</strong><button type="button" class="btn-tertiary" onclick="state.varAddingProp=false;render()">Cancelar</button></div><div class="vchips">${propChips('')}</div>${customProp}</div>`
        : `<button type="button" class="btn-outline" style="margin:4px 0 10px;" onclick="state.varAddingProp=true;render()">+ Agregar otra propiedad (ej. además de Color, Talla)</button>`) : ''}
      ${variants.length>0 ? `
        <div class="panel-title" style="font-size:12.5px;margin:12px 0 8px;">Variantes (${variants.length})</div>
        <div class="var-allbar">
          <label for="var-bulk-val">Aplicar a todas las variantes</label>
          <div class="var-bulk">
            <select id="var-bulk-field" class="var-in" style="text-align:left;"><option value="cost">Costo</option><option value="priceOverride">Precio</option><option value="promoPriceOverride">Precio promocional</option></select>
            <input id="var-bulk-val" class="var-in" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00">
            <button type="button" class="btn-outline" style="white-space:nowrap;" onclick="applyVariantBulk()">Aplicar</button>
          </div>
        </div>
        <div class="var-wrap"><div class="var-table">
          <div class="var-row var-head"><div>Variante</div><div>Stock${centersAct.length>1?' por centro':''}</div><div>SKU</div><div>Precio</div><div>Promocional</div><div>Costo</div></div>
          ${variants.map(v=>{
            const base = Number(v.priceOverride)>0 ? Number(v.priceOverride) : pprice;
            const badPromo = Number(v.promoPriceOverride)>0 && base>0 && Number(v.promoPriceOverride)>=base;
            return `
          <div class="var-row">
            <div class="var-name"><button type="button" class="var-thumb" title="Elegir la foto de esta variante" onclick="toggleVarPhotoPick('${v.id}')">${vImage(p,v)?`<img src="${vImage(p,v)}" alt="">`:icon('image',18)}<span class="var-thumb-edit">${icon('edit',11)}</span></button><span>${escDescHtml(varLabelOf(v))}</span></div>
            ${state.varPhotoPick===v.id ? `<div class="var-pick">
              ${(p.images||[]).length ? `<div class="var-pick-t">Foto de esta variante:</div><div class="var-pick-row">
                ${(p.images||[]).map((src,i)=>`<button type="button" class="var-pick-img ${v.imageIdx===i?'on':''}" onclick="setVariantImage('${v.id}',${i})"><img src="${src}" alt=""></button>`).join('')}
                <button type="button" class="btn-tertiary" onclick="setVariantImage('${v.id}',null)">Sin foto propia</button></div>` : `<div class="var-pick-t">Primero sube fotos del producto (sección Foto) y aquí eliges cuál es de esta variante.</div>`}
            </div>` : ''}
            <div class="var-stockcell"><span class="var-lbl">Stock${centersAct.length>1?' por centro':''}</span>
              ${centersAct.map(c=>`<label class="var-cs">${centersAct.length>1?`<span title="${escDescHtml(c.name)}">${escDescHtml(c.name.replace(/\s*\(.*\)/,''))}</span>`:''}<input class="var-in" type="number" min="0" inputmode="numeric" value="${vCenterStock(v,c.id)}" onchange="setVariantCenterStock('${v.id}','${c.id}',this.value)"></label>`).join('')}
              ${centersAct.length>1?`<div class="var-sum">Total: <strong id="var-sum-${v.id}">${v.stock||0}</strong></div>`:''}
            </div>
            <div><span class="var-lbl">SKU</span><input class="var-in" style="text-align:left;" placeholder="SKU" value="${escDescHtml(v.sku||'')}" onchange="setVariantField('${v.id}','sku',this.value)"></div>
            <div><span class="var-lbl">Precio</span><input class="var-in" type="number" min="0" step="0.01" inputmode="decimal" placeholder="${pprice>0?pprice:'Igual'}" value="${v.priceOverride||''}" onchange="setVariantField('${v.id}','priceOverride',this.value);render()"></div>
            <div><span class="var-lbl">Precio promocional</span><input class="var-in ${badPromo?'var-bad':''}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Sin promo" value="${v.promoPriceOverride||''}" onchange="setVariantField('${v.id}','promoPriceOverride',this.value);render()">${badPromo?`<div class="var-warn">Debe ser menor que ${money(base)}</div>`:''}</div>
            <div><span class="var-lbl">Costo</span><input class="var-in" type="number" min="0" step="0.01" inputmode="decimal" placeholder="${pcost>0?pcost:'0.00'}" value="${v.cost||''}" data-var-cost onchange="setVariantField('${v.id}','cost',this.value)"></div>
          </div>`; }).join('')}
          <div class="var-row var-total"><div class="var-name">Stock total (todos los centros)</div><div><strong id="var-stock-total">${variants.reduce((s,v)=>s+(v.stock||0),0)}</strong> pzas</div></div>
        </div></div>
        <div class="panel-sub" style="margin:8px 0 0;">Precio, promocional o costo vacío = se usa el del producto. El costo solo lo ves tú. La foto de cada variante la eliges tocando el recuadro junto a su nombre.</div>
      ` : (groups.length ? `<div class="panel-sub">Agrega al menos una opción a cada propiedad y aquí aparecen las variantes para llenar sus datos.</div>` : '')}
    </div>`;
}
function _varGroups(){ const p = state.productModal; if(!p.variantGroups) p.variantGroups = []; return p.variantGroups; }
function addVariantProp(name){
  name = String(name||'').trim().replace(/\s+/g,' ').slice(0,30);
  if(!name){ showToast('Escribe el nombre de la propiedad'); return; }
  const groups = _varGroups();
  if(groups.some(g=>varKey(g.name)===varKey(name))){ showToast(`Ya agregaste "${name}"`); return; }
  if(groups.length>=3){ showToast('Máximo 3 propiedades por producto'); return; }
  groups.push({name, values:[]});
  state.varAddingProp = false;
  render();
  requestAnimationFrame(()=>{ const i = document.getElementById('var-val-'+(groups.length-1)); if(i) i.focus(); });
}
function _varWouldLoseStock(mutator){
  const p = state.productModal; const before = JSON.stringify(p.variantGroups);
  const snapshot = JSON.parse(before); mutator(snapshot);
  const test = {variants: p.variants||[], variantGroups: snapshot};
  const next = varBuildCombos(snapshot, p.variants||[]);
  const keep = new Set(next.map(v=>v.id));
  return (p.variants||[]).filter(v=>!keep.has(v.id) && (v.stock||0)>0);
}
function removeVariantProp(idx){
  const g = _varGroups()[idx]; if(!g) return;
  const lost = _varWouldLoseStock(gs=>gs.splice(idx,1));
  if(lost.length && !confirm(`Al quitar "${g.name}" se juntan las variantes y se pierde el stock de ${lost.length} de ellas. ¿Continuar?`)) return;
  _varGroups().splice(idx,1); varRegenerate(); render();
}
function addVariantValues(idx, text){
  const g = _varGroups()[idx]; if(!g) return;
  const parts = String(text||'').split(',').map(x=>x.trim().replace(/\s+/g,' ').slice(0,40)).filter(Boolean);
  if(!parts.length){ showToast('Escribe una opción'); return; }
  g.values = g.values || [];
  let added = 0;
  parts.forEach(v=>{ if(!g.values.some(x=>varKey(x)===varKey(v))){ g.values.push(v); added++; } });
  if(!added){ showToast('Esa opción ya está'); return; }
  varRegenerate(); render();
  requestAnimationFrame(()=>{ const i = document.getElementById('var-val-'+idx); if(i) i.focus(); });
}
function removeVariantValue(idx, val){
  const g = _varGroups()[idx]; if(!g) return;
  const lost = _varWouldLoseStock(gs=>{ gs[idx].values = gs[idx].values.filter(x=>x!==val); });
  if(lost.length && !confirm(`Quitar "${val}" elimina ${lost.length} variante(s) que tienen stock. ¿Continuar?`)) return;
  g.values = (g.values||[]).filter(x=>x!==val); varRegenerate(); render();
}
// Combinaciones de todas las propiedades con valores. Las variantes que ya existían conservan su stock, fotos y precios:
// si cambia la estructura (se agregó o quitó una propiedad) se reutiliza la variante cuya combinación coincide o es parte de la nueva.
function varBuildCombos(groups, existing){
  const gs = (groups||[]).filter(g=>g.name && g.values && g.values.length);
  if(!gs.length) return [];
  let combos = [{}];
  gs.forEach(g=>{ const next = []; combos.forEach(c=>g.values.forEach(v=>next.push({...c,[g.name]:v}))); combos = next; });
  const used = new Set();
  const keyOf = combo=>JSON.stringify(Object.entries(combo).sort());
  const byKey = {}; (existing||[]).forEach(v=>{ byKey[keyOf(v.combo||{})] = v; });
  const subset = (a,b)=>Object.entries(a).every(([k,v])=>b[k]===v);
  return combos.map(combo=>{
    const exact = byKey[keyOf(combo)];
    if(exact && !used.has(exact.id)){ used.add(exact.id); return exact; }
    const part = (existing||[]).find(v=>!used.has(v.id) && v.combo && Object.keys(v.combo).length && (subset(v.combo, combo) || subset(combo, v.combo)));
    if(part){ used.add(part.id); return {...part, combo}; }
    return {id: uid('var_'), combo, sku:'', stock:0};
  });
}
function varRegenerate(){
  const p = state.productModal;
  p.variants = varBuildCombos(p.variantGroups, p.variants);
  p.variants.forEach(vNormalize);
  const tmp = {variants:p.variants, stockByCenter:p.stockByCenter||{}};
  if(p.variants.length){ vProductSync(tmp); p.stockByCenter = tmp.stockByCenter; p.stock = tmp.stock; }
}
function generateVariantCombos(){ varRegenerate(); render(); }
function applyVariantBulk(){
  const field = (document.getElementById('var-bulk-field')||{}).value || 'cost';
  const val = Math.max(0, Number((document.getElementById('var-bulk-val')||{}).value)||0);
  if(!(val>0)){ showToast('Escribe el valor que quieres aplicar'); return; }
  const vs = state.productModal.variants||[];
  if(field==='promoPriceOverride'){
    const bad = vs.filter(v=>val >= (Number(v.priceOverride)>0 ? Number(v.priceOverride) : Number(state.productModal.price)||Infinity));
    if(bad.length && Number(state.productModal.price)>0){ showToast(`La promoción debe ser menor al precio (${money(Number(state.productModal.price))})`); return; }
  }
  vs.forEach(v=>{ v[field] = val; });
  if(field==='cost') document.querySelectorAll('[data-var-cost]').forEach(i=>{ i.value = val; });
  if(field==='cost' && !(Number(state.productModal.cost)>0)){ state.productModal.cost = val; const pc = document.getElementById('pf-cost'); if(pc) pc.value = val; if(typeof updatePriceCalc==='function') updatePriceCalc(); }
  showToast(field==='cost'?'Costo aplicado a todas las variantes':field==='priceOverride'?'Precio aplicado a todas las variantes':'Precio promocional aplicado a todas las variantes');
  render();
}
function applyVariantCostAll(){ const f = document.getElementById('var-bulk-field'); if(f) f.value='cost'; applyVariantBulk(); }
function setVariantField(variantId, field, value){
  const v = (state.productModal.variants||[]).find(x=>x.id===variantId);
  if(!v) return;
  v[field] = (field==='priceOverride'||field==='cost'||field==='promoPriceOverride') ? Math.max(0, Number(value)||0) : value;
}
function setVariantCenterStock(variantId, cid, value){
  const v = (state.productModal.variants||[]).find(x=>x.id===variantId); if(!v) return;
  vSetCenterStock(v, cid, value);
  const sum = document.getElementById('var-sum-'+variantId); if(sum) sum.textContent = v.stock;
  const el = document.getElementById('var-stock-total'); if(el) el.textContent = (state.productModal.variants||[]).reduce((s,x)=>s+(x.stock||0),0);
}
function toggleVarPhotoPick(id){ state.varPhotoPick = state.varPhotoPick===id ? null : id; render(); }
function setVariantImage(id, idx){
  const v = (state.productModal.variants||[]).find(x=>x.id===id); if(!v) return;
  if(idx==null) delete v.imageIdx; else v.imageIdx = idx;
  state.varPhotoPick = null; render();
}
function handleSaveProduct(existingId, skipWarn){
  // Evita el doble-guardado: un doble click o un dedo lento en pantallas táctiles podía disparar
  // esta función dos veces antes de que la primera terminara, creando el producto duplicado (o
  // registrando el cambio dos veces en la bitácora) cuando se trata de uno nuevo.
  if(state.savingProduct) return;
  state.savingProduct = true; render();
  const name = document.getElementById('pf-name').value.trim();
  const sku = document.getElementById('pf-sku').value.trim();
  const location = document.getElementById('pf-location').value.trim();
  const supplierId = document.getElementById('pf-supplier').value || '';
  const batches = ((state.productModal.batches)||[]).filter(b=>(Number(b.qty)||0)>0).map(b=>({id:b.id, qty:Math.floor(Number(b.qty)||0), expirationDate:b.expirationDate||'', note:(b.note||'').trim()}));
  const expirationDate = batches.length ? earliestExpiry(batches) : (document.getElementById('pf-expiration').value || '');
  const lowStockThreshold = Number(document.getElementById('pf-low-stock-threshold').value) || 0;
  const price = Number(document.getElementById('pf-price').value)||0;
  const promoPrice = Number(document.getElementById('pf-promo').value)||0;
  const cost = Number(document.getElementById('pf-cost').value)||0;
  const desc = document.getElementById('pf-desc').value.trim();
  const hidden = document.getElementById('pf-hidden').checked;
  if(!name){ state.savingProduct = false; showToast('Ponle un nombre al producto'); render(); pmGoTo('foto','pf-name'); return; }
  if(!(price>0) && !(state.productModal.variants||[]).some(v=>Number(v.priceOverride)>0)){ state.savingProduct = false; showToast('Ponle precio de venta al producto'); render(); pmGoTo('precio','pf-price'); return; }
  const categories = pmCats(state.productModal);
  if(!categories.length){ state.savingProduct = false; showToast('Elige al menos una categoría'); render(); pmGoTo('categorias',''); return; }
  if(!existingId && !skipWarn){
    const missing = pmChecks().filter(c=>!c.req && !c.ok).map(c=>c.label);
    if(missing.length){ state.savingProduct = false; state.pmMissingPrompt = {id: existingId||'', missing}; render(); return; }
  }
  if(!existingId) pmLastSet({categories, supplierId, location});
  const cat = categories[0];
  let stockByCenter = state.productModal.stockByCenter || {};
  let stock = Object.values(stockByCenter).reduce((s,n)=>s+(n||0),0);
  if((state.productModal.variants||[]).length){
    // Validación de variantes para que nunca queden datos que rompan la tienda o el POS.
    const vsv = state.productModal.variants, imgs = state.productModal.images||[];
    const combos = new Set(), skus = new Set();
    for(const v of vsv){
      const key = JSON.stringify(Object.keys(v.combo||{}).sort().map(k=>[k, String(v.combo[k]).trim().toLowerCase()]));
      if(combos.has(key)){ state.savingProduct=false; showToast(`Hay dos variantes iguales (${varLabelOf(v)}) — quita o cambia una`); render(); return; }
      combos.add(key);
      const vs = (v.sku||'').trim().toLowerCase();
      if(vs){ if(skus.has(vs)){ state.savingProduct=false; showToast(`El SKU "${v.sku}" está repetido en las variantes`); render(); return; } skus.add(vs); }
      v.stock = Math.max(0, Math.floor(Number(v.stock)||0));
      if(typeof v.imageIdx==='number' && !imgs[v.imageIdx]) delete v.imageIdx;
    }
    state.productModal.variants.forEach(vNormalize);
    const tmp = {variants: state.productModal.variants, stockByCenter}; vProductSync(tmp);
    stockByCenter = tmp.stockByCenter; stock = tmp.stock;
  }
  saveProduct({
    id: existingId||null, name, sku, location, supplierId, expirationDate, batches, lowStockThreshold, cat, categories, price, promoPrice, cost, stock, stockByCenter, desc,
    hidden, images: state.productModal.images||[], needs: state.productModal.needs||[],
    variantGroups: state.productModal.variantGroups||[], variants: state.productModal.variants||[],
    costHistory: state.productModal.costHistory||[],
  });
}


;(function(){var st=document.createElement('style');st.textContent="  .pm-modal .modal-actions{flex-wrap:wrap;}\n  .pm-checklist{flex:1 1 100%;display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12.5px;}\n  .pm-checklist .pm-ck-lbl{font-weight:700;color:var(--ink-soft);}\n  .pm-checklist .pm-ck-ok{font-weight:700;color:var(--green);}\n  .modal-actions .pm-checklist button.pm-ck{flex:0 0 auto;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;border:0;cursor:pointer;}\n  .pm-ck.req,.pm-st-in.req{background:#FDE2E2;color:#B3261E;}\n  .pm-ck.warn,.pm-st-in.warn{background:#FFF1DC;color:#9A5B00;}\n  .pm-st-in.ok{background:#EAF3D8;color:var(--green);}\n  .fsec-badge.pm-st{padding:0;background:none;white-space:normal;max-width:45%;text-align:right;}\n  .pm-st-in{display:inline-block;padding:3px 8px;border-radius:999px;}\n  .pm-warn{font-size:12px;color:#9A5B00;margin-top:5px;}\n  .pm-copied{font-size:12.5px;background:var(--surface-soft);border-radius:var(--radius-sm);padding:8px 10px;margin:0 0 12px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;}";document.head.appendChild(st);window.__pmPreview=true;})();
