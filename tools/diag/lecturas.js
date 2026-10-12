/* AUDITORÍA (rama audit/*, solo lectura). Solo imprime nombres de claves y conteos, nunca valores. */
const admin = require('firebase-admin');
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const note = s => console.log('::notice::' + s);
(async () => {
  const st = (await db.collection('settings').doc('store').get()).data() || {};
  const SENS = ['slackWebhookUrl','ai','recurringExpenses','salesGoalMonthly','deliveryWhatsapp','storeAddress','repurchaseProductIds','churnRiskDays','dashboardNotes','checklists','monthCloses','repurchaseNotified','churnRiskNotified','coupons','wholesaleTiers','historicalOrderCountOffset','dismissedHealthItems','duplicatesIgnored','deliverySurveyQuestions'];
  const present = SENS.filter(k => k in st).map(k => { const v = st[k]; const n = Array.isArray(v) ? v.length : (v && typeof v === 'object') ? Object.keys(v).length : (v === '' || v == null ? 0 : 1); return `${k}(${n})`; });
  note('settings/store PÚBLICO contiene: ' + present.join(', '));
  const secretish = Object.keys(st).filter(k => /(secret|token|password|webhook|apikey|api_key|key)$/i.test(k));
  note('claves con nombre de secreto en settings/store: ' + (secretish.join(', ') || 'ninguna'));
  const others = (await db.collection('settings').listDocuments()).map(d => d.id);
  note('documentos en settings: ' + others.join(', '));
  // Llave web de Firebase: ¿tiene restricciones?
  try {
    const { access_token } = await admin.app().options.credential.getAccessToken();
    const r = await fetch(`https://apikeys.googleapis.com/v2/projects/${sa.project_id}/locations/global/keys`, { headers: { Authorization: 'Bearer ' + access_token } });
    const j = await r.json();
    if (j.keys) j.keys.forEach(k => note(`LLAVE ${k.displayName || '(sin nombre)'} · restricción navegador=${!!(k.restrictions && k.restrictions.browserKeyRestrictions)} · APIs limitadas=${k.restrictions && k.restrictions.apiTargets ? k.restrictions.apiTargets.length : 0}`));
    else note('LLAVES: no se pudo consultar (' + (j.error ? j.error.status : r.status) + ')');
  } catch (e) { note('LLAVES error ' + e.message); }
  const cnt = async q => { try { return (await q.count().get()).data().count; } catch (e) { return 'err'; } };
  note(`VOLUMEN público-escribible · storeMessages=${await cnt(db.collection('storeMessages'))} · visits=${await cnt(db.collection('visits'))} · analyticsEvents=${await cnt(db.collection('analyticsEvents'))} · abandonedCarts=${await cnt(db.collection('abandonedCarts'))} · systemErrors=${await cnt(db.collection('systemErrors'))} · searchMisses=${await cnt(db.collection('searchMisses'))} · orders=${await cnt(db.collection('orders'))}`);
  note(`PEDIDOS raros · status≠Nuevo creados por tienda: ${await cnt(db.collection('orders').where('source','==','tienda').where('status','in',['Entregado','Pagado','Enviado']))} · sin source: ${await cnt(db.collection('orders').where('source','==',null))}`);
})().catch(e => { console.log('::error::' + e.message); process.exit(1); });
