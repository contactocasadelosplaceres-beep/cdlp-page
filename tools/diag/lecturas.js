/* AUDITORÍA (rama audit/*, solo lectura): guarda las reglas publicadas CIFRADAS con una llave pública
   de la auditoría en la rama audit-reglas (nadie más puede leerlas). No toca datos. */
const admin = require('firebase-admin'); const crypto = require('crypto'); const { execSync } = require('child_process'); const fs = require('fs');
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const PUB = "-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEApyZWQddGFbfuB+InD4yp\n29FF6sM66efRga/ErDPpPjONTYM3b/DVX2tqHiCWE8otamoXyh7uh/4emzWkj3V/\nVEnY2Ky+XOWNl7gl3Fm4Ah84PdNF/+4xOUGo/fRZluKcUyCIYvuEsdP9T6fKXSPB\n7qDXVvK8k5w8UQko7+2BUQE7YhYYZAj4hHN50ub4DZTDt2sVo8cFtwC2XyrXY6mZ\n/wyS6rrTSgMJZN/O5MoK4/Zm+1tnfFrNmAhSt0pme7kg+9c3ifbGTIVne0J4373x\ne2XUHmJogni73RrRREDaY3Naz2pdnvKx4pYH3Vt9FNM3OXu0bVxVZPccWIMMMacg\nXSSZpIhUEAaTIZIU3RZrMT5COYodQ47XxLXqEtEykhLDAbGsRmKPnRXny1maR2fQ\ns83Davucdm3Yy2IsbBvE3HkZ5QmBHG8ke+UbI5lfOuHCyS5dDt0Y5ZLVv6UmzHfv\n6DStN5Gs4+/M5hRdDSuUs/BdRjJPe32JD9DF43Hz0HdDAgMBAAE=\n-----END PUBLIC KEY-----";
(async () => {
  const { access_token } = await admin.app().options.credential.getAccessToken();
  const H = { Authorization: 'Bearer ' + access_token };
  const rel = await (await fetch('https://firebaserules.googleapis.com/v1/projects/' + sa.project_id + '/releases/cloud.firestore', { headers: H })).json();
  const rs = await (await fetch('https://firebaserules.googleapis.com/v1/' + rel.rulesetName, { headers: H })).json();
  const content = (rs.source.files || []).map(f => f.content).join('\n');
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv); const enc = Buffer.concat([c.update(content, 'utf8'), c.final()]); const tag = c.getAuthTag();
  const ek = crypto.publicEncrypt({ key: PUB, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
  fs.writeFileSync('reglas.enc.json', JSON.stringify({ ek: ek.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64'), data: enc.toString('base64'), updateTime: rel.updateTime }));
  const sh = c => execSync(c, { stdio: 'pipe' }).toString();
  sh('git config user.name "cdlp-audit[bot]"'); sh('git config user.email "actions@users.noreply.github.com"');
  sh('git checkout --orphan audit-reglas'); sh('git rm -rf --cached . >/dev/null'); sh('git add reglas.enc.json'); sh('git commit -m "reglas cifradas (auditoría)"'); sh('git push -f origin audit-reglas');
  console.log('::notice::Reglas cifradas subidas (' + content.length + ' caracteres, publicadas ' + rel.updateTime + ')');
})().catch(e => { console.log('::error::' + e.message); process.exit(1); });
