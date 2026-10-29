/* Pruebas de las reglas de Firestore en el emulador (datos ficticios). Uso: Acción "Reglas de Firestore".
   Cada caso dice si DEBE permitirse o bloquearse; si alguno no cuadra, la Acción falla y no publica. */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import fs from 'fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc, runTransaction } from 'firebase/firestore';
const RULES = process.env.RULES_FILE || 'firestore.rules'; // se corre desde tools/reglas
const env = await initializeTestEnvironment({ projectId: 'demo-cdlp', firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8085 } });
await env.withSecurityRulesDisabled(async c => { const d = c.firestore();
  await setDoc(doc(d,'counters/orders'),{next:100}); await setDoc(doc(d,'orders/o1'),{status:'Nuevo',total:10,items:[],date:'x'});
  await setDoc(doc(d,'abandonedCarts/3312345678'),{name:'Legado',phone:'3312345678',items:[],total:5});
  await setDoc(doc(d,'staffPermissions/cajero@example.com'),{permissions:{pedidos:true, caja:true}});
  await setDoc(doc(d,'staffPermissions/colab@example.com'),{permissions:{productos:true}});
  await setDoc(doc(d,'staffPermissions/vendedor@example.com'),{permissions:{pedidos:true, productos:true, caja:true}});
  await setDoc(doc(d,'products/p1'),{name:'X',price:100,stock:5}); await setDoc(doc(d,'productStock/p1'),{stock:5,variants:[]}); await setDoc(doc(d,'productCosts/p1'),{cost:40});
  await setDoc(doc(d,'settings/store'),{storeName:'x', dashboardNotes:['interna']}); await setDoc(doc(d,'settings/publish'),{publishedAt:'x'});
  await setDoc(doc(d,'settings/syncTombstones'),{t:{}}); await setDoc(doc(d,'couponCounters/VERANO'),{n:3});
  await setDoc(doc(d,'couponClaims/VERANO__'+'a'.repeat(32)),{date:'x'}); });
const anon = env.unauthenticatedContext().firestore();
// Sesión con código de 6 dígitos (MFA) iniciada hace 1 día (S-04).
const NOW_S = Math.floor(Date.now()/1000);
const MFA = { firebase:{ sign_in_provider:'password', sign_in_second_factor:'totp' }, auth_time: NOW_S - 86400 };
const stranger = env.authenticatedContext('u1',{email:'nuevo@example.com', ...MFA}).firestore();
const admin = env.authenticatedContext('u0',{email:'contacto.casadelosplaceres@gmail.com', admin:true, ...MFA}).firestore();
const cajero = env.authenticatedContext('u2',{email:'cajero@example.com', staff:true, ...MFA}).firestore();
const colab = env.authenticatedContext('u3',{email:'colab@example.com', staff:true, ...MFA}).firestore();
const vendedor = env.authenticatedContext('u5',{email:'vendedor@example.com', staff:true, ...MFA}).firestore();
const staffSinDoc = env.authenticatedContext('u4',{email:'otro@example.com', staff:true, ...MFA}).firestore();
const adminSinCodigo = env.authenticatedContext('u6',{email:'contacto.casadelosplaceres@gmail.com', admin:true, firebase:{sign_in_provider:'password'}, auth_time: NOW_S - 60}).firestore();
const adminVencido = env.authenticatedContext('u7',{email:'contacto.casadelosplaceres@gmail.com', admin:true, firebase:{sign_in_provider:'password', sign_in_second_factor:'totp'}, auth_time: NOW_S - 31*86400}).firestore();
const order = {date:'2026-10-12T00:00:00.000Z',orderNumber:101,source:'tienda',customer:'Cliente Ficticio',phone:'3312345678',address:'Calle 1',notes:'',items:[{id:'p1',name:'X',qty:1,price:100}],total:100,status:'Nuevo',couponCode:null};
const R = []; let bad = 0;
async function t(name, p, want){ let ok; try{ await p; ok=true; }catch(e){ ok=false; } const pass = ok===want; if(!pass) bad++; R.push(`${pass?'OK  ':'MAL '} ${want?'debe permitir':'debe bloquear'} · ${name}`); }
// --- La tienda (sin sesión) debe seguir funcionando
await t('tienda crea pedido normal', setDoc(doc(anon,'orders/a1'), order), true);
await t('tienda crea pedido sin folio, con campaña y señal', setDoc(doc(anon,'orders/a2'), {...order, orderNumber:null, campaign:'fb', fraudSignals:['rapido']}), true);
await t('tienda lee existencia mínima (productStock)', getDoc(doc(anon,'productStock/p1')), true);
await t('tienda crea pedido de 30 renglones', setDoc(doc(anon,'orders/a4'), {...order, items:Array.from({length:30},(_,i)=>({id:'p'+i,name:'X',qty:2,price:10.5})), total:630}), true);
await t('tienda crea pedido con promoción (renglón negativo permitido)', setDoc(doc(anon,'orders/a3'), {...order, items:[...order.items,{id:'promo_buyxpayy',name:'Promo',price:-20,qty:1}], total:80}), true);
await t('tienda lee y sube el folio +1', runTransaction(anon, async tx=>{ const r=doc(anon,'counters/orders'); const s=await tx.get(r); tx.set(r,{next:s.data().next+1},{merge:true}); }), true);
await t('tienda registra visita', addDoc(collection(anon,'visits'),{date:'2026-10-12T00:00:00Z',source:'directo'}), true);
await t('tienda registra visita con campaña', addDoc(collection(anon,'visits'),{date:'2026-10-12T00:00:00Z',source:'facebook',campaign:'promo-octubre'}), true);
for(const [ty,ex] of [['product_view',{productId:'p1'}],['add_to_cart',{productId:'p1'}],['wishlist_add',{productId:'p1'}],['checkout_start',{cartTotal:300}],['purchase',{orderTotal:300}]])
  await t('tienda registra evento '+ty, addDoc(collection(anon,'analyticsEvents'),{type:ty,date:'2026-10-12T00:00:00Z',...ex}), true);
await t('tienda envía mensaje al buzón', addDoc(collection(anon,'storeMessages'),{date:'2026-10-12T00:00:00Z',name:'Ana',phone:'3312345678',type:'sugerencia',message:'Hola',status:'nuevo'}), true);
await t('tienda guarda su borrador de carrito', setDoc(doc(anon,'abandonedCarts/ac_abcdefghij1234567890'),{name:'Ana',phone:'3312345678',address:'x',notes:'',items:[],total:5,updatedAt:'x',completed:false}), true);
await t('tienda borra su borrador', deleteDoc(doc(anon,'abandonedCarts/ac_abcdefghij1234567890')), true);
await t('tienda cuenta uso de cupón nuevo (n=1)', setDoc(doc(anon,'couponCounters/OTONO'),{n:1}), true);
await t('tienda cuenta uso de cupón existente (+1)', runTransaction(anon, async tx=>{ const r=doc(anon,'couponCounters/VERANO'); const s=await tx.get(r); tx.set(r,{n:s.data().n+1}); }), true);
await t('tienda revisa si el teléfono ya usó el cupón', getDoc(doc(anon,'couponClaims/VERANO__'+'a'.repeat(32))), true);
await t('tienda registra que el teléfono usó el cupón', setDoc(doc(anon,'couponClaims/OTONO__'+'b'.repeat(32)),{date:'x'}), true);
await t('tienda registra couponUsage', addDoc(collection(anon,'couponUsage'),{code:'OTONO',date:'x',phone:'3312345678'}), true);
await t('tienda reporta un error del sistema', addDoc(collection(anon,'systemErrors'),{message:'x',stack:'',source:'index',page:'/',userAgent:'ua',date:'x'}), true);
// --- Lo que la auditoría encontró abierto debe quedar cerrado
await t('anónimo lee un producto completo (S-01)', getDoc(doc(anon,'products/p1')), false);
await t('anónimo lista productos (S-01)', getDocs(collection(anon,'products')), false);
await t('anónimo lista productStock', getDocs(collection(anon,'productStock')), false);
await t('anónimo escribe productStock', setDoc(doc(anon,'productStock/p1'),{stock:999,variants:[]}), false);
await t('anónimo crea pedido con renglón a precio negativo (S-03)', setDoc(doc(anon,'orders/c1'), {...order, items:[{id:'p1',name:'X',qty:1,price:-100}], total:0}), false);
await t('anónimo crea pedido con total que no es la suma', setDoc(doc(anon,'orders/c2'), {...order, total:1}), false);
await t('anónimo crea pedido con cantidad 0', setDoc(doc(anon,'orders/c3'), {...order, items:[{id:'p1',name:'X',qty:0,price:100}], total:0}), false);
await t('anónimo crea pedido con 31 renglones', setDoc(doc(anon,'orders/c4'), {...order, items:Array.from({length:31},()=>({id:'p1',name:'X',qty:1,price:1})), total:31}), false);
await t('anónimo lee security_totp', getDoc(doc(anon,'security_totp/x@example.com')), false);
await t('admin sin código de 6 dígitos lee pedidos (S-04)', getDoc(doc(adminSinCodigo,'orders/o1')), false);
await t('admin sin código de 6 dígitos lee productos (S-04)', getDoc(doc(adminSinCodigo,'products/p1')), false);
await t('admin con sesión de más de 30 días lee pedidos (S-04)', getDoc(doc(adminVencido,'orders/o1')), false);
await t('anónimo lee settings/store (notas, webhook)', getDoc(doc(anon,'settings/store')), false);
await t('anónimo lee settings/publish', getDoc(doc(anon,'settings/publish')), false);
await t('anónimo lee costos', getDoc(doc(anon,'productCosts/p1')), false);
await t('anónimo crea pedido "Entregado"', setDoc(doc(anon,'orders/b1'), {...order, status:'Entregado'}), false);
await t('anónimo crea pedido con origen "pos"', setDoc(doc(anon,'orders/b2'), {...order, source:'pos'}), false);
await t('anónimo crea pedido con total negativo', setDoc(doc(anon,'orders/b3'), {...order, total:-500}), false);
await t('anónimo crea pedido con campo extra stockDeducted', setDoc(doc(anon,'orders/b4'), {...order, stockDeducted:true}), false);
await t('anónimo crea pedido sin productos', setDoc(doc(anon,'orders/b5'), {...order, items:[]}), false);
await t('anónimo lee pedidos', getDoc(doc(anon,'orders/o1')), false);
await t('anónimo manda mensaje con campo extra', addDoc(collection(anon,'storeMessages'),{date:'x',name:'a',phone:'1',type:'queja',message:'x',status:'nuevo',extra:1}), false);
await t('anónimo manda mensaje de 900 KB', addDoc(collection(anon,'storeMessages'),{date:'x',name:'a',phone:'1',type:'queja',message:'x'.repeat(900000),status:'nuevo'}), false);
await t('anónimo registra visita con campos inventados', addDoc(collection(anon,'visits'),{date:'x',source:'y',basura:'z'}), false);
await t('anónimo registra evento desconocido', addDoc(collection(anon,'analyticsEvents'),{type:'hack',date:'x'}), false);
await t('anónimo sobrescribe carrito de otra persona (id = teléfono)', setDoc(doc(anon,'abandonedCarts/3312345678'),{name:'Otra',phone:'3312345678',items:[],total:1}), false);
await t('anónimo borra carrito de otra persona (id = teléfono)', deleteDoc(doc(anon,'abandonedCarts/3312345678')), false);
await t('anónimo crea contador nuevo', setDoc(doc(anon,'counters/basura'),{next:5}), false);
await t('anónimo salta el folio', updateDoc(doc(anon,'counters/orders'),{next:500}), false);
await t('anónimo pone un cupón en 5 usos de golpe', setDoc(doc(anon,'couponCounters/NUEVO'),{n:5}), false);
await t('anónimo regresa el contador de un cupón', setDoc(doc(anon,'couponCounters/VERANO'),{n:0}), false);
await t('anónimo lista teléfonos que usaron cupones', getDocs(collection(anon,'couponClaims')), false);
await t('anónimo borra un registro de cupón', deleteDoc(doc(anon,'couponClaims/VERANO__'+'a'.repeat(32))), false);
await t('cuenta registrada sin rol lee settings/store', getDoc(doc(stranger,'settings/store')), false);
await t('cuenta registrada sin rol lee pedidos', getDoc(doc(stranger,'orders/o1')), false);
await t('cuenta registrada sin rol lee costos', getDoc(doc(stranger,'productCosts/p1')), false);
// --- Personal
await t('vendedor copia existencia a productStock', setDoc(doc(vendedor,'productStock/p1'),{stock:4,variants:[{id:'v1',stock:2}],updatedAt:'x'}), true);
await t('vendedor pone campo extra en productStock', setDoc(doc(vendedor,'productStock/p1'),{stock:4,variants:[],cost:40}), false);
await t('cajero lee productos (POS)', getDoc(doc(cajero,'products/p1')), true);
await t('cajero lee settings/store y publish', Promise.all([getDoc(doc(cajero,'settings/store')), getDoc(doc(cajero,'settings/publish'))]), true);
await t('cajero sin permiso de productos no puede descontar existencias', runTransaction(cajero, async tx=>{ const pr=doc(cajero,'products/p1'), cr=doc(cajero,'counters/orders'); const p=await tx.get(pr); const c=await tx.get(cr); tx.update(pr,{stock:p.data().stock-1}); tx.set(cr,{next:c.data().next+1},{merge:true}); tx.set(doc(cajero,'sales/s1'),{total:100,orderNumber:c.data().next,source:'pos'}); }), false);
await t('vendedor (pedidos+productos): venta + folio + existencias en una transacción', runTransaction(vendedor, async tx=>{ const pr=doc(vendedor,'products/p1'), cr=doc(vendedor,'counters/orders'); const p=await tx.get(pr); const c=await tx.get(cr); tx.update(pr,{stock:p.data().stock-1}); tx.set(cr,{next:c.data().next+1},{merge:true}); tx.set(doc(vendedor,'sales/s2'),{total:100,orderNumber:c.data().next,source:'pos'}); }), true);
await t('cajero (pedidos, sin productos) actualiza existencias', updateDoc(doc(cajero,'products/p1'),{stock:4}), false);
await t('cajero lee y actualiza costos de variante', setDoc(doc(cajero,'productCosts/p1'),{cost:41},{merge:true}), true);
await t('cajero lee settings privados de configuración', getDoc(doc(cajero,'settings/syncTombstones')), false);
await t('colaborador de productos escribe costos', setDoc(doc(colab,'productCosts/p1'),{cost:42},{merge:true}), true);
await t('colaborador de productos lee pedidos', getDoc(doc(colab,'orders/o1')), false);
await t('staff sin documento de permisos lee costos', getDoc(doc(staffSinDoc,'productCosts/p1')), false);
await t('admin lee y escribe todo lo nuevo', Promise.all([getDoc(doc(admin,'productCosts/p1')), setDoc(doc(admin,'settingsPrivate/x'),{a:1}), getDoc(doc(admin,'settings/syncTombstones')), getDocs(collection(admin,'couponClaims')), getDoc(doc(admin,'settings/store'))]), true);
await t('admin crea pedido manual con cualquier forma', setDoc(doc(admin,'orders/m1'),{...order, source:'manual', status:'Entregado', stockDeducted:true}), true);
const lines = R; for (let i=0;i<lines.length;i+=8) console.log('::notice::'+lines.slice(i,i+8).join(' ‖ '));
console.log(R.join('\n'));
await env.cleanup();
if (bad) { console.log(`::error::${bad} caso(s) no cuadran con lo esperado`); process.exit(1); }
console.log('Todas las reglas se comportan como se espera.'); process.exit(0);
