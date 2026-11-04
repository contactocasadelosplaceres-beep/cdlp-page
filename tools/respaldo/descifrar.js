/* Abre un respaldo cifrado (.cdlp) en tu computadora:
     node tools/respaldo/descifrar.js respaldo-2026-11-08.cdlp
   Te pide la contraseña (la del secreto RESPALDO_CLAVE) y deja junto al archivo un .json legible.
   No necesita instalar nada: solo Node.js. */
const crypto = require('crypto'), zlib = require('zlib'), fs = require('fs'), readline = require('readline');
const file = process.argv[2];
if (!file) { console.log('Uso: node descifrar.js respaldo-AAAA-MM-DD.cdlp'); process.exit(1); }
const ask = q => new Promise(r => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); r(a); }); });
(async () => {
  const pass = process.env.RESPALDO_CLAVE || await ask('Contraseña del respaldo: ');
  const b = fs.readFileSync(file);
  if (b.subarray(0, 5).toString() !== 'CDLP1') throw new Error('No es un respaldo de la tienda');
  const salt = b.subarray(5, 21), iv = b.subarray(21, 33), tag = b.subarray(33, 49), enc = b.subarray(49);
  const key = crypto.scryptSync(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  let gz; try { gz = Buffer.concat([d.update(enc), d.final()]); } catch (e) { throw new Error('Contraseña incorrecta o archivo dañado'); }
  const out = file.replace(/\.cdlp$/, '') + '.json';
  fs.writeFileSync(out, zlib.gunzipSync(gz));
  console.log('Listo:', out);
})().catch(e => { console.error(e.message || e); process.exit(1); });
