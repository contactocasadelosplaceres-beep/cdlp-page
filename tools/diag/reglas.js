/* Revisa las reglas de Firestore PUBLICADAS (no las del repo) y dice, por colección, si limitan
   qué campos se pueden escribir. Solo lectura; no imprime las reglas completas. */
const admin = require('firebase-admin');
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
(async () => {
  const { access_token } = await admin.app().options.credential.getAccessToken();
  const H = { Authorization: 'Bearer ' + access_token };
  const rel = await (await fetch(`https://firebaserules.googleapis.com/v1/projects/${sa.project_id}/releases/cloud.firestore`, { headers: H })).json();
  if (!rel.rulesetName) { console.log('::error::No se pudo leer la publicación: ' + JSON.stringify(rel).slice(0, 300)); process.exit(1); }
  const rs = await (await fetch(`https://firebaserules.googleapis.com/v1/${rel.rulesetName}`, { headers: H })).json();
  const src = (rs.source && rs.source.files || []).map(f => f.content).join('\n');
  console.log('::notice::Reglas publicadas el ' + (rel.updateTime || '?') + ' · ' + src.split('\n').length + ' líneas');
  const cols = ['products','productCosts','sales','orders','layaways','cashRegisters','transfers','audits','expenses','shrinkage','suppliers','restockItems','commissionAgents','priceChangeBatches','productExchanges','storeMessages','restockRequests','distributionCenters','cashiers','activePosSessions','customers','settings'];
  const out = [];
  for (const c of cols) {
    const i = src.indexOf('match /' + c + '/');
    if (i < 0) { out.push(c + '=SIN REGLA'); continue; }
    let depth = 0, j = src.indexOf('{', src.indexOf('}', i) + 1), k = j;
    for (; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}') { depth--; if (depth === 0) break; } }
    const block = src.slice(i, k + 1);
    const allowLines = block.split('\n').filter(l => /allow/.test(l)).map(l => l.trim().replace(/\s+/g, ' ')).join(' | ');
    out.push(`${c}: ${allowLines.slice(0, 260)}`);
  }
  for (let a = 0; a < out.length; a += 6) console.log('::notice::' + out.slice(a, a + 6).join(' ‖ '));
  const fns = (src.match(/function\s+\w+/g) || []).join(', ');
  console.log('::notice::funciones: ' + fns);
})().catch(e => { console.log('::error::' + (e.message || e)); process.exit(1); });
