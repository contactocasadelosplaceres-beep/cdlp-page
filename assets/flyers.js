/* Flyers para repartir (media carta 5.5 × 8.5 in = 528 × 816 px a 96 ppp).
   Lo usa el panel (Configuración → Herramientas → Flyers) para la vista previa, la edición de textos y
   la impresión / PDF. También lo usa tools/flyers para generar los PDF de flyers/.
   window.CDLPFlyers = { DESIGNS, DEFAULTS, defaults(design), html(design, side, data, opts) } */
(function(){
  const W = 528, H = 816;
  const C = { plum:'#993477', deep:'#5C1F49', rose:'#BC355C', coral:'#ED7578', amber:'#F6A030', green:'#7AB71A',
    teal:'#20B7CA', navy:'#0A4A5B', ink:'#1A1A1A', soft:'#F6E9E6', bg:'#F9F6F8', border:'#EBD9D3', pinkInk:'#F7E4EF' };
  const HEAD = "'League Spartan', 'Poppins', sans-serif", BODY = "Inter, system-ui, sans-serif";

  const DESIGNS = [
    { key:'A', label:'A · Morado', headline:'Placer con total discreción.' },
    { key:'B', label:'B · Claro', headline:'Bienestar íntimo, a tu puerta.' },
    { key:'C', label:'C · Elegante', headline:'Discreto. Confiable. Cerca de ti.' },
  ];
  const DEFAULTS = {
    design: 'A',
    headline: 'Placer con total discreción.',
    sub: 'Tu tienda para adultos en Ciudad Guzmán. Más de 400 productos y atención personal, sin prejuicios.',
    b1: 'Empaque discreto, sin marcas', b2: 'Pagas hasta que lo recibes', b3: 'Entrega a domicilio en Cd. Guzmán',
    qrLabel: 'ESCANEA Y COMPRA', web: 'casaplaceres.com', qrUrl: 'https://casaplaceres.com/?utm_source=flyer',
    whatsapp: '33 1749 4004', instagram: '@lacasadelosplaceres',
    horario: 'Lun–Vie 10–21 h · Sáb 10–14 h', nota18: 'Solo mayores de 18 años', ciudad: 'Ciudad Guzmán, Jalisco',
    stepsTitle: 'Comprar es así de fácil',
    s1t: 'Elige', s1d: 'Entra a casaplaceres.com desde tu celular, en privado.',
    s2t: 'Pide', s2d: 'Arma tu carrito y envía tu pedido en un minuto.',
    s3t: 'Recibe', s3d: 'Llega en empaque sin marcas y pagas al recibir. Envío $35 en Cd. Guzmán.',
    catsTitle: 'LO QUE ENCUENTRAS',
    cats: 'Lencería, Ropa interior masculina, Lubricantes, Cosmética íntima, Juegos en pareja, Bienestar para adultos, Regalos',
    giftOn: true, giftTitle: 'Regalo en tu compra', giftText: 'Lubricante de viaje en compras mayores a $100.',
  };
  const defaults = design => Object.assign({}, DEFAULTS, { design: design || 'A', headline: (DESIGNS.find(d => d.key === design) || DESIGNS[0]).headline });

  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const ICON = {
    box:'<path d="M21 8l-9-5-9 5 9 5 9-5z"></path><path d="M3 8v8l9 5 9-5V8"></path><path d="M12 13v8"></path>',
    cash:'<rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2.5"></circle>',
    home:'<path d="M3 11l9-7 9 7"></path><path d="M5 10v10h14V10"></path>',
    gift:'<rect x="3" y="8" width="18" height="13" rx="2"></rect><path d="M12 8v13"></path><path d="M3 12h18"></path><path d="M12 8c-2-4-6-4-6-1.5S9 8 12 8c3 0 6-.5 6-1.5S14 4 12 8z"></path>',
  };
  const svg = (name, size, color) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;
  const stripe = () => `<div style="position:absolute;top:0;left:0;right:0;height:8px;display:flex">${[C.rose,C.coral,C.amber,C.green,C.teal,C.navy].map(c=>`<div style="flex:1;background:${c}"></div>`).join('')}</div>`;
  const qrBox = (o, size) => o.qr ? `<div style="width:${size}px;height:${size}px;flex-shrink:0">${o.qr}</div>` : `<div style="width:${size}px;height:${size}px;flex-shrink:0;border:2px dashed #bbb;border-radius:8px;display:flex;align-items:center;justify-content:center;font:600 11px ${BODY};color:#999">QR</div>`;
  const brand = (o, logoSize, color, small) => `<div style="display:flex;align-items:center;gap:14px">
      <img src="${esc(o.logo)}" alt="" style="width:${logoSize}px;height:${logoSize}px;border-radius:${Math.round(logoSize*0.24)}px">
      <div style="display:flex;flex-direction:column;gap:2px;color:${color}">
        <div style="font:400 ${small}px ${HEAD};letter-spacing:4px">LA CASA DE LOS</div>
        <div style="font:800 ${small*2.3}px ${HEAD};letter-spacing:1px;line-height:1">PLACERES</div>
      </div></div>`;
  const frame = (bg, color, inner, extra) => `<div style="width:${W}px;height:${H}px;box-sizing:border-box;position:relative;overflow:hidden;background:${bg};font-family:${BODY};color:${color};display:flex;flex-direction:column;${extra||''}">${inner}</div>`;

  function frontA(d, o){
    const ben = [['box',d.b1],['cash',d.b2],['home',d.b3]].filter(x=>x[1]).map(([i,t])=>`<div style="display:flex;align-items:center;gap:12px">
      <div style="width:34px;height:34px;border-radius:50%;background:${C.deep};display:flex;align-items:center;justify-content:center">${svg(i,18,C.coral)}</div>
      <span style="font-size:15px;font-weight:500">${esc(t)}</span></div>`).join('');
    return frame(C.plum, '#fff', `${stripe()}
      <div style="position:absolute;right:-150px;top:120px;width:380px;height:380px;border-radius:50%;background:#A8428A"></div>
      <div style="position:relative">${brand(o,76,'#fff',13)}</div>
      <div style="position:relative;margin-top:60px;display:flex;flex-direction:column;gap:18px">
        <div style="font:700 66px/0.98 ${HEAD};letter-spacing:-1px;text-wrap:balance">${esc(d.headline)}</div>
        <div style="width:56px;height:4px;border-radius:2px;background:${C.coral}"></div>
        <div style="font-size:17px;line-height:1.5;color:${C.pinkInk};max-width:390px">${esc(d.sub)}</div>
      </div>
      <div style="position:relative;margin-top:28px;display:flex;flex-direction:column;gap:12px">${ben}</div>
      <div style="position:relative;margin-top:auto;background:#fff;border-radius:20px;padding:16px;display:flex;align-items:center;gap:18px;color:${C.ink}">
        ${qrBox(o,112)}
        <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
          <div style="font-size:12px;font-weight:600;letter-spacing:1.5px;color:#666">${esc(d.qrLabel)}</div>
          <div style="font:700 27px/1.05 ${HEAD};color:${C.plum}">${esc(d.web)}</div>
          <div style="font-size:13px;line-height:1.45;color:#444;margin-top:2px">WhatsApp ${esc(d.whatsapp)}<br>Instagram ${esc(d.instagram)}</div>
        </div></div>
      <div style="position:relative;margin-top:12px;display:flex;justify-content:space-between;font-size:11.5px;color:${C.pinkInk}"><span>${esc(d.horario)}</span><span>${esc(d.nota18)}</span></div>`,
      'padding:44px 44px 36px');
  }
  function frontB(d, o){
    const chips = [[d.b1,C.plum],[d.b2,C.rose],[d.b3,C.navy]].filter(x=>x[0]).map(([t,c])=>`<span style="padding:7px 13px;border-radius:999px;background:#fff;border:1.5px solid ${C.border};font-size:13px;font-weight:600;color:${c}">${esc(t)}</span>`).join('');
    return frame(C.bg, C.ink, `
      <div style="height:330px;background:${C.plum};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;border-radius:0 0 48px 48px">
        <img src="${esc(o.logo)}" alt="" style="width:168px;height:168px">
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;color:#fff">
          <div style="font:400 14px ${HEAD};letter-spacing:6px">LA CASA DE LOS</div>
          <div style="font:800 40px/1 ${HEAD};letter-spacing:2px">PLACERES</div></div></div>
      <div style="padding:34px 44px 0;display:flex;flex-direction:column;gap:14px">
        <div style="font:700 54px/1 ${HEAD};letter-spacing:-.5px;color:${C.deep};text-wrap:balance">${esc(d.headline)}</div>
        <div style="font-size:16px;line-height:1.5;color:#444">${esc(d.sub)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:2px">${chips}</div></div>
      <div style="margin:auto 44px 0;display:flex;align-items:center;gap:18px;padding:16px 0;border-top:1.5px solid ${C.border}">
        ${qrBox(o,104)}
        <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
          <div style="font-size:12px;font-weight:600;letter-spacing:1.5px;color:#666">${esc(d.qrLabel)}</div>
          <div style="font:700 27px/1.05 ${HEAD};color:${C.plum}">${esc(d.web)}</div>
          <div style="font-size:13px;line-height:1.45;color:#444">WhatsApp ${esc(d.whatsapp)} · ${esc(d.instagram)}</div></div></div>
      <div style="height:40px;background:${C.deep};display:flex;align-items:center;justify-content:space-between;padding:0 44px;font-size:11.5px;color:${C.pinkInk}"><span>${esc(d.horario)}</span><span>${esc(d.nota18)}</span></div>`);
  }
  // C · Elegante: azul petróleo, todo centrado, marco fino y beneficios en tres columnas.
  function frontC(d, o){
    const ben = [['box',d.b1],['cash',d.b2],['home',d.b3]].filter(x=>x[1]).map(([i,t])=>`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center">
      <div style="width:44px;height:44px;border-radius:50%;border:1.5px solid ${C.coral};display:flex;align-items:center;justify-content:center">${svg(i,20,C.coral)}</div>
      <span style="font-size:12.5px;line-height:1.35;font-weight:500;color:#E3F1F4">${esc(t)}</span></div>`).join('');
    return frame(C.navy, '#fff', `
      <div style="position:absolute;inset:18px;border:1.5px solid rgba(255,255,255,.28);border-radius:22px"></div>
      <div style="position:absolute;left:0;right:0;bottom:0;height:6px;display:flex">${[C.plum,C.rose,C.coral,C.amber,C.green,C.teal].map(c=>`<div style="flex:1;background:${c}"></div>`).join('')}</div>
      <div style="position:relative;display:flex;flex-direction:column;align-items:center;text-align:center">
        <img src="${esc(o.logo)}" alt="" style="width:96px;height:96px;border-radius:50%;box-shadow:0 0 0 6px rgba(255,255,255,.12)">
        <div style="margin-top:16px;font:400 12px ${HEAD};letter-spacing:5px">LA CASA DE LOS</div>
        <div style="font:800 30px/1 ${HEAD};letter-spacing:2px">PLACERES</div>
        <div style="margin-top:26px;font:700 46px/1.02 ${HEAD};letter-spacing:-.5px;text-wrap:balance;max-width:420px">${esc(d.headline)}</div>
        <div style="margin-top:18px;width:48px;height:3px;border-radius:2px;background:${C.coral}"></div>
        <div style="margin-top:14px;font-size:15px;line-height:1.5;color:#CFE5EA;max-width:400px">${esc(d.sub)}</div>
      </div>
      <div style="position:relative;margin-top:24px;display:flex;gap:14px">${ben}</div>
      <div style="position:relative;margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center">
        <div style="background:#fff;border-radius:16px;padding:9px">${qrBox(o,92)}</div>
        <div style="font-size:11.5px;font-weight:600;letter-spacing:1.5px;color:#CFE5EA">${esc(d.qrLabel)}</div>
        <div style="font:700 26px/1 ${HEAD}">${esc(d.web)}</div>
        <div style="font-size:12px;color:#CFE5EA">WhatsApp ${esc(d.whatsapp)} · ${esc(d.instagram)} · ${esc(d.nota18)}</div>
      </div>`, 'padding:46px 48px 40px');
  }

  function back(d, o){
    const design = d.design || 'A';
    const accent = design === 'C' ? C.navy : C.plum, accentDeep = design === 'C' ? '#06313D' : C.deep;
    const steps = [[d.s1t,d.s1d,accent],[d.s2t,d.s2d,C.rose],[d.s3t,d.s3d,design === 'C' ? C.plum : C.navy]].filter(x=>x[0]||x[1]);
    const cats = String(d.cats||'').split(',').map(s=>s.trim()).filter(Boolean);
    return frame('#fff', C.ink, `${stripe()}
      <div style="font:700 40px/1 ${HEAD};color:${accentDeep}">${esc(d.stepsTitle)}</div>
      <div style="margin-top:24px;display:flex;flex-direction:column;gap:16px">${steps.map(([t,ds,c],i)=>`<div style="display:flex;gap:14px;align-items:flex-start">
        <div style="width:38px;height:38px;border-radius:50%;background:${c};color:#fff;font:700 19px ${HEAD};display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
        <div style="display:flex;flex-direction:column;gap:2px"><div style="font-weight:600;font-size:16px">${esc(t)}</div><div style="font-size:14px;line-height:1.45;color:#555">${esc(ds)}</div></div></div>`).join('')}</div>
      ${cats.length ? `<div style="margin-top:24px;display:flex;flex-direction:column;gap:10px">
        <div style="font-size:12px;font-weight:600;letter-spacing:1.5px;color:#666">${esc(d.catsTitle)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">${cats.map(c=>`<span style="padding:7px 12px;border-radius:999px;background:${C.soft};font-size:13px;font-weight:500">${esc(c)}</span>`).join('')}</div></div>` : ''}
      ${d.giftOn ? `<div style="margin-top:22px;border-radius:18px;background:#FEF3E2;border:1.5px dashed ${C.amber};padding:14px 18px;display:flex;align-items:center;gap:14px">
        ${svg('gift',30,'#B86E0C')}
        <div style="display:flex;flex-direction:column;gap:2px"><div style="font-weight:600;font-size:15px">${esc(d.giftTitle)}</div><div style="font-size:13.5px;line-height:1.4;color:#555">${esc(d.giftText)}</div></div></div>` : ''}
      <div style="margin:auto -44px 0;background:${accent};color:#fff;padding:22px 44px 18px;display:flex;align-items:center;gap:18px">
        <div style="background:#fff;border-radius:14px;padding:8px;flex-shrink:0">${qrBox(o,92)}</div>
        <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
          <div style="font:700 26px/1.05 ${HEAD}">${esc(d.web)}</div>
          <div style="font-size:13px;line-height:1.5;color:${design === 'C' ? '#CFE5EA' : C.pinkInk}">WhatsApp ${esc(d.whatsapp)}<br>Instagram ${esc(d.instagram)}<br>${esc(d.horario)}</div></div></div>
      <div style="margin:0 -44px;height:30px;background:${accentDeep};display:flex;align-items:center;justify-content:center;font-size:11px;color:${C.pinkInk}">${esc(d.ciudad)} · ${esc(d.nota18)}</div>`,
      'padding:44px 44px 0');
  }

  function html(design, side, data, opts){
    const d = Object.assign({}, DEFAULTS, data || {}, { design });
    const o = Object.assign({ logo: 'logo.png', qr: '' }, opts || {});
    if (side === 'back') return back(d, o);
    return design === 'B' ? frontB(d, o) : design === 'C' ? frontC(d, o) : frontA(d, o);
  }
  const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=League+Spartan:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap';
  window.CDLPFlyers = { W, H, DESIGNS, DEFAULTS, defaults, html, FONTS_CSS };
})();
