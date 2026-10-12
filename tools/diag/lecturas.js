/* AUDITORÍA DE SEGURIDAD (solo lectura, rama audit/*). No toca datos: evalúa las reglas PUBLICADAS
   con la API de pruebas de reglas (simulación), lee la configuración de inicio de sesión y cuenta
   documentos con count(). Las anotaciones son públicas: solo se imprimen resultados, no datos. */
const admin = require('firebase-admin');
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const PID = sa.project_id;
const note = s => console.log('::notice::' + s);
(async () => {
  const { access_token } = await admin.app().options.credential.getAccessToken();
  const H = { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' };
  const j = async (u, o) => { const r = await fetch(u, Object.assign({ headers: H }, o || {})); const t = await r.text(); try { return JSON.parse(t); } catch (e) { return { raw: t.slice(0, 300), status: r.status }; } };
  // 1) Configuración de inicio de sesión
  const cfg = await j(`https://identitytoolkit.googleapis.com/admin/v2/projects/${PID}/config`);
  const si = cfg.signIn || {};
  note(`AUTH · email/contraseña=${!!(si.email && si.email.enabled)} · anónimo=${!!(si.anonymous && si.anonymous.enabled)} · teléfono=${!!(si.phoneNumber && si.phoneNumber.enabled)} · registro_público_deshabilitado=${!!(cfg.client && cfg.client.permissions && cfg.client.permissions.disabledUserSignup)} · borrar_cuenta_deshabilitado=${!!(cfg.client && cfg.client.permissions && cfg.client.permissions.disabledUserDeletion)} · mfa=${cfg.mfa ? cfg.mfa.state : '?'} · bloqueo_por_funciones=${!!(cfg.blockingFunctions && Object.keys(cfg.blockingFunctions.triggers || {}).length)}${cfg.error ? ' · ERROR ' + JSON.stringify(cfg.error).slice(0, 150) : ''}`);
  // 2) Reglas publicadas
  const rel = await j(`https://firebaserules.googleapis.com/v1/projects/${PID}/releases/cloud.firestore`);
  const rs = await j(`https://firebaserules.googleapis.com/v1/${rel.rulesetName}`);
  const content = (rs.source.files || []).map(f => f.content).join('\n');
  const D = '/databases/(default)/documents/';
  const stranger = { uid: 'u_audit', token: { email: 'desconocido@example.com', email_verified: false, firebase: { sign_in_provider: 'password' } } };
  const strangerVerified = { uid: 'u_audit2', token: { email: 'desconocido2@example.com', email_verified: true, firebase: { sign_in_provider: 'password' } } };
  const noStaffDoc = [{ function: 'exists', args: [{ anyValue: {} }], result: { value: false } }, { function: 'get', args: [{ anyValue: {} }], result: { undefined: {} } }];
  const order = { date: '2026-10-12T00:00:00Z', orderNumber: 1, source: 'tienda', customer: 'Prueba', phone: '3300000000', address: 'x', notes: '', items: [{ id: 'p1', qty: 1, price: 1 }], total: 1, status: 'Nuevo' };
  const C = [
    ['anónimo lee pedidos (get)', null, 'orders/x', 'get'],
    ['anónimo lista pedidos', null, 'orders/x', 'list'],
    ['anónimo lee clientes', null, 'customers/x', 'get'],
    ['anónimo lee ventas POS', null, 'sales/x', 'get'],
    ['anónimo lee productos (costos incluidos si siguen ahí)', null, 'products/x', 'get'],
    ['anónimo lee settings/store', null, 'settings/store', 'get'],
    ['anónimo lee couponUsage (teléfonos)', null, 'couponUsage/x', 'list'],
    ['anónimo lee folio counters/orders', null, 'counters/orders', 'get'],
    ['anónimo crea pedido con total manipulado ($1)', null, 'orders/x', 'create', order],
    ['anónimo crea pedido con status Entregado', null, 'orders/x', 'create', Object.assign({}, order, { status: 'Entregado' })],
    ['anónimo escribe productos', null, 'products/x', 'update', { price: 1 }, { price: 500 }],
    ['anónimo escribe settings/store', null, 'settings/store', 'update', { storeName: 'x' }, { storeName: 'y' }],
    ['anónimo borra carritos abandonados ajenos', null, 'abandonedCarts/x', 'delete', null, { name: 'a' }],
    ['anónimo crea couponUsage arbitrario', null, 'couponUsage/x', 'create', { code: 'X', phone: '1', date: 'x' }],
    ['cuenta nueva sin permisos lee pedidos', stranger, 'orders/x', 'get'],
    ['cuenta nueva sin permisos lee clientes', stranger, 'customers/x', 'list'],
    ['cuenta nueva sin permisos modifica productos', stranger, 'products/x', 'update', { price: 1 }, { price: 500 }],
    ['cuenta nueva sin permisos crea su propio permiso de personal', stranger, 'staffPermissions/desconocido@example.com', 'create', { permissions: { productos: true } }],
    ['cuenta nueva sin permisos lee gastos', stranger, 'expenses/x', 'list'],
    ['cuenta nueva sin permisos modifica settings', stranger, 'settings/store', 'update', { storeName: 'x' }, { storeName: 'y' }],
    ['cuenta nueva (correo verificado) lee pedidos', strangerVerified, 'orders/x', 'get'],
    ['cuenta nueva sin permisos lee cajeros (PIN)', stranger, 'cashiers/x', 'list'],
    ['cuenta nueva escribe stockMovements', stranger, 'stockMovements/x', 'create', { productId: 'p', qty: -99 }],
    ['cuenta nueva escribe adminAuditLog falso', stranger, 'adminAuditLog/x', 'create', { action: 'x' }],
  ];
  const testCases = C.map(([n, auth, path, method, newData, oldData]) => {
    const request = { path: D + path, method };
    if (auth) request.auth = auth;
    if (newData) request.resource = { data: newData };
    const tc = { expectation: 'ALLOW', request, functionMocks: noStaffDoc };
    if (oldData) tc.resource = { data: oldData };
    return tc;
  });
  const res = await j(`https://firebaserules.googleapis.com/v1/projects/${PID}:test`, { method: 'POST', body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content }] }, testSuite: { testCases } }) });
  if (!res.testResults) { note('Prueba de reglas falló: ' + JSON.stringify(res).slice(0, 400)); }
  else {
    const lines = res.testResults.map((r, i) => `${r.state === 'SUCCESS' ? 'PERMITIDO' : 'BLOQUEADO'} — ${C[i][0]}`);
    for (let a = 0; a < lines.length; a += 6) note('REGLAS · ' + lines.slice(a, a + 6).join(' ‖ '));
  }
  // 3) Datos sensibles en lugares públicos (solo conteos)
  const cnt = async q => { try { return (await q.count().get()).data().count; } catch (e) { return 'err:' + (e.code || e.message).toString().slice(0, 40); } };
  const out = [];
  out.push('productos con costo>0 visibles en products=' + await cnt(db.collection('products').where('cost', '>', 0)));
  out.push('productos con proveedor=' + await cnt(db.collection('products').where('supplierId', '>', '')));
  out.push('productCosts=' + await cnt(db.collection('productCosts')));
  out.push('staffPermissions=' + await cnt(db.collection('staffPermissions')));
  out.push('couponUsage=' + await cnt(db.collection('couponUsage')));
  out.push('pedidos tienda con total<=0=' + await cnt(db.collection('orders').where('total', '<=', 0)));
  const st = (await db.collection('settings').doc('store').get()).data() || {};
  out.push('settings/store: cupones=' + (st.coupons || []).length + ' · códigos mayoreo=' + (st.wholesaleTiers || []).length + ' · notas internas=' + (st.dashboardNotes || []).length + ' · checklists=' + (st.checklists || []).length + ' · claves totales=' + Object.keys(st).length);
  note('DATOS · ' + out.join(' · '));
  // 4) Usuarios de Auth (solo totales)
  try {
    let n = 0, noVer = 0, mfa = 0, providers = {}; let tok;
    do { const r = await admin.auth().listUsers(1000, tok); r.users.forEach(u => { n++; if (!u.emailVerified) noVer++; if (u.multiFactor && u.multiFactor.enrolledFactors && u.multiFactor.enrolledFactors.length) mfa++; (u.providerData || []).forEach(p => providers[p.providerId] = (providers[p.providerId] || 0) + 1); }); tok = r.pageToken; } while (tok);
    note(`USUARIOS · total=${n} · sin correo verificado=${noVer} · con 2FA=${mfa} · proveedores=${JSON.stringify(providers)}`);
  } catch (e) { note('USUARIOS · no se pudo listar: ' + e.message); }
  // 5) Encabezados del sitio publicado
  for (const u of ['https://contactocasadelosplaceres-beep.github.io/cdlp-page/', 'https://contactocasadelosplaceres-beep.github.io/cdlp-page/admin.html', 'https://contactocasadelosplaceres-beep.github.io/cdlp-page/.git/config', 'https://contactocasadelosplaceres-beep.github.io/cdlp-page/tools/catalogo/build.js']) {
    try { const r = await fetch(u, { redirect: 'manual' }); const h = k => r.headers.get(k) || '—';
      note(`SITIO ${u.replace(/^https:\/\/[^/]+/, '')} · ${r.status} · HSTS=${h('strict-transport-security')} · CSP=${h('content-security-policy').slice(0, 40)} · XCTO=${h('x-content-type-options')} · XFO=${h('x-frame-options')} · Referrer=${h('referrer-policy')} · cache=${h('cache-control')}`);
    } catch (e) { note('SITIO error ' + e.message); }
  }
  const http = await fetch('http://contactocasadelosplaceres-beep.github.io/cdlp-page/', { redirect: 'manual' }).catch(e => ({ status: 'err' }));
  note('SITIO http→https: ' + http.status + ' ' + ((http.headers && http.headers.get('location')) || ''));
})().catch(e => { console.log('::error::' + (e.stack || e.message || e).toString().slice(0, 500)); process.exit(1); });
