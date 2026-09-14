const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8'}});
const text = (data, status=200) => new Response(data, {status, headers:{'content-type':'text/plain; charset=utf-8'}});

function b64u(bytes) { let s=''; for (const b of bytes) s+=String.fromCharCode(b); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function unb64u(s) { s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; const raw=atob(s); return Uint8Array.from(raw,c=>c.charCodeAt(0)); }
async function sha256(s){return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));}
async function hmac(secret, data){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(data))));}
const PASSWORD_ITERATIONS = 10000;
async function passwordHash(password){
 const salt=crypto.randomUUID();
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),{name:'PBKDF2'},false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:PASSWORD_ITERATIONS,hash:'SHA-256'},key,256);
 return `pbkdf2$${PASSWORD_ITERATIONS}$${salt}$${b64u(new Uint8Array(bits))}`;
}
async function passwordOk(password, stored){
 const parts=String(stored||'').split('$');
 let iterations,salt,want;
 if(parts.length===4){[,iterations,salt,want]=parts;iterations=Number(iterations)}
 else if(parts.length===3){[,salt,want]=parts;iterations=120000}
 else return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),{name:'PBKDF2'},false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations,hash:'SHA-256'},key,256);
 return b64u(new Uint8Array(bits))===want;
}
function cookie(req){return req.headers.get('Cookie')?.match(/session=([^;]+)/)?.[1] || ''}
async function auth(req,env){const t=cookie(req); if(!t)return null; const th=await sha256(t); const row=await env.DB.prepare('SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(th,new Date().toISOString()).first(); return row||null;}
async function session(user,env){const raw=crypto.randomUUID()+'-'+crypto.randomUUID(); const th=await sha256(raw); const exp=new Date(Date.now()+1000*60*60*24*14).toISOString(); await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(th,user.id,exp).run(); return new Response(JSON.stringify({user}),{headers:{'content-type':'application/json','Set-Cookie':`session=${raw}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1209600`}})}

const seedExercises = [
 {chapter:1,code:'1.1',title:'Predir i executar',type:'predict',statement:'Estudia el codi i afegeix comentaris amb la teva predicció. Utilitza els termes executar, sortida i cadena de text. Respon també les preguntes d’investigació dins del codi.',starter:`# Exemple de codi\n\nprint("Hola Món!")\n\n# La Meva Predicció - substitueix aquest comentari per la teva predicció.\n\n##### Tasca d'Investigació\n# Quina part del codi és l'ordre de sortida (output)?\n# Resposta:\n\n# Quina part del codi és la cadena (string)?\n# Resposta:\n\n# Quina seria la sortida de print("I love Computing")?\n# Resposta:\n\n# Què passaria amb print("I love Comping")?\n# Resposta:\n\n# Què passaria amb print("I love Computing"?\n# Resposta:`,solution:`# El codi mostrarà la cadena Hola Món! a la consola.\nprint("Hola Món!")\n# print és l'ordre de sortida i "Hola Món!" és la cadena de text.`,rubric:[['Predicció i explicació',4],['Preguntes d’investigació',4],['Sintaxi/comentaris',2]],tests:[]},
 {chapter:1,code:'1.2',title:'Modificar',type:'modify',statement:'Adapta el codi perquè mostri el teu propi missatge. Afegeix comentaris per mostrar què fa.',starter:`print("Hello World!")\n`,solution:`# La instrucció print mostra text a la sortida.\nprint("I love computer science!")`,rubric:[['Funcionament',5],['Ús de print i cadena',3],['Comentaris',2]],tests:[{kind:'stdout',expected:'CUSTOM',points:5},{kind:'has','pattern':'print','points':2},{kind:'comment','points':1}]},
 {chapter:1,code:'1.3',title:'Construir',type:'build',statement:'Escriu un programa que mostri un acudit. L’acudit i la gràcia han de sortir en línies separades. Ampliació: fes-ho amb un sol print i, opcionalment, amb un retard.',starter:`# Escriu aquí el teu programa d'acudits.\n`,solution:`print("Com es diu a un pollastre mirant una amanida?")\nprint("Amanida Cèsar de pollastre")`,rubric:[['Funcionament i dues línies',6],['Ús de print',2],['Comentaris/qualitat',2]],tests:[{kind:'stdout_lines',minLines:2,points:6},{kind:'has','pattern':'print','points':2},{kind:'comment','pattern':'#','points':1}]},
 {chapter:2,code:'2.1',title:'Predir i executar',type:'predict',statement:'Afegeix comentaris al codi explicant què fa cada exemple i predient la sortida.',starter:`# Exemple 1\nfirstName = "Andy"\nprint(firstName)\n\n# Exemple 2\nlastName = "Colley"\nfullName = firstName + " " + lastName\nprint(fullName)\n\n# Exemple 3\nprint("Hola " + firstName + ". El teu nom complet és " + fullName + ".")`,solution:`firstName = "Andy"\nprint(firstName)\nlastName = "Colley"\nfullName = firstName + " " + lastName\nprint(fullName)`,rubric:[['Predicció i comprensió',5],['Explicació de variables',3],['Comentaris',2]],tests:[]},
 {chapter:2,code:'2.2',title:'Investiga',type:'investigate',statement:'Respon dins dels comentaris les preguntes sobre variables, strings, assignació, concatenació i sortida del codi.',starter:`### Codi d'exemple 1\nfName = "Mr"\nlName = "Colley"\nprint(fName)\n\n# Identifica una variable en el codi.\n# Resposta:\n\n# Identifica una cadena de text.\n# Resposta:\n\n# Si lName = "Thorpe", com afecta la sortida?\n# Resposta:\n\n# Si fName = "Mrs", com afecta la sortida?\n# Resposta:\n\n### Codi d'exemple 2\nnum1 = 20\nnum2 = 5\ntotal1 = num1 + 15\ntotal2 = num2 * 2\ntotal3 = num1 - num2\nprint(total3)\n# Què mostrarà el programa?\n# Resposta:\n\n### Codi d'exemple 3\nname1 = "Ross"\nname2 = "Monica"\nname3 = "Joey"\nname4 = "Rachel"\nname5 = "Chandler"\nprint(name1 + " and " + name4)\nprint(name3)\nname3 = "Phoebe"\n# Quantes variables?\n# Resposta:\n# Què passa si name4 es canvia per name5?\n# Resposta:\n# Quina és la funció de '+'?\n# Resposta:\n# Què farà print(name3) al final?\n# Resposta:`,solution:`# Respostes de referència: fName/lName; Mr/Colley; no afecta; mostra Mrs; 15; 5 variables; Ross and Chandler; concatenació; Phoebe.`,rubric:[['Comprensió de variables',4],['Comprensió de la sortida',3],['Concatenació i raonament',3]],tests:[]},
 {chapter:2,code:'2.3',title:'Modifica',type:'modify',statement:'Adapta el codi per produir el teu propi missatge. Afegeix comentaris. Completa les dues variables que falten i la concatenació final.',starter:`# Assignació de Variable - Modifica\nname1 = "Axl"\nname2 = "Slash"\n# Afegeix 2 variables més per emmagatzemar 'Duff' i 'Izzy'\n\n# Completa la línia per mostrar totes les variables\nprint(name1 + " and " + name2 + " and ")`,solution:`name1 = "Axl"\nname2 = "Slash"\nname3 = "Duff"\nname4 = "Izzy"\nprint(name1 + " and " + name2 + " and " + name3 + " and " + name4)`,rubric:[['Funcionament',5],['Assignació de variables',3],['Concatenació/comentaris',2]],tests:[{kind:'hasvar',name:'name3',points:1.5},{kind:'hasvar',name:'name4',points:1.5},{kind:'has','pattern':'+','points':2},{kind:'stdout_contains','expected':'Axl','points':1}]},
 {chapter:2,code:'2.4',title:'Construeix',type:'build',statement:'Assigna el teu nom i el teu menjar preferit a dues variables amb noms adequats i mostra la informació. Fes també les ampliacions si vols.',starter:`# Assignació de Variables\n\n# Assigna el teu nom i el teu menjar preferit a 2 variables separades.\n\n############# SENZILL ###################\n# Mostra el contingut de les variables en 2 línies separades\n\n############# MITJÀ ####################\n# Mostra dues frases amb el nom i el menjar preferit.\n\n############# COMPLEX ###################\n# Mostra ambdues informacions com a part de la mateixa frase.`,solution:`name = "Andy"\nfavFood = "Pie"\nprint(name)\nprint(favFood)\nprint("El meu nom és " + name)\nprint("El meu menjar preferit és " + favFood)\nprint("El meu nom és " + name + " i el meu menjar preferit és " + favFood)`,rubric:[['Funcionament',4],['Variables adequades',3],['Sortida i concatenació',2],['Comentaris/qualitat',1]],tests:[{kind:'has_assignment',points:3},{kind:'stdout_lines',minLines:2,points:4},{kind:'has','pattern':'print','points':1}]}
];

async function seed(env){for(const e of seedExercises){await env.DB.prepare(`INSERT OR IGNORE INTO exercises(chapter,code,title,type,statement,starter_code,reference_solution,rubric_json,tests_json,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(e.chapter,e.code,e.title,e.type,e.statement,e.starter,e.solution,JSON.stringify(e.rubric),JSON.stringify(e.tests),parseFloat(e.code)).run();}}

async function aiGrade(env, exercise, code, tests){
 if(!env.OPENAI_API_KEY) return {score:null,feedback:'La IA encara no està configurada. La proposta es generarà només quan afegeixis OPENAI_API_KEY als secrets de Cloudflare.',criteria:[],configured:false};
 const prompt=`Ets el corrector pedagògic d'un curs de Python de 4t d'ESO. Avalua exclusivament els objectius ensenyats en aquest exercici. No donis la solució completa a l'alumne. Proposa una nota sobre 10, però recorda que el professor l'ha de validar.\n\nEXERCICI:\n${exercise.statement}\n\nCRITERIS:\n${exercise.rubric_json}\n\nRESULTATS DELS TESTS:\n${JSON.stringify(tests)}\n\nSOLUCIÓ DE REFERÈNCIA (només per al corrector):\n${exercise.reference_solution}\n\nCODI DE L'ALUMNE:\n${code}\n\nRetorna NOMÉS JSON vàlid amb aquesta forma: {"score":number,"criteria":[{"name":string,"score":number,"max":number,"reason":string}],"strengths":[string],"errors":[string],"feedback":string,"hints":[string]}`;
 const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.AI_MODEL||'gpt-5.6-luna',input:prompt,store:false})});
 if(!r.ok) return {score:null,feedback:`No s'ha pogut consultar la IA (${r.status}).`,criteria:[],configured:true};
 const data=await r.json(); const out=data.output_text || data.output?.flatMap(x=>x.content||[]).map(x=>x.text||'').join('') || '{}'; try{return {...JSON.parse(out),configured:true}}catch{return {score:null,feedback:out,criteria:[],configured:true}}
}

async function api(req,env){
 await seed(env); const url=new URL(req.url); const path=url.pathname; const user=await auth(req,env);
 if(path==='/api/register' && req.method==='POST'){
  let b;
  try{ b=await req.json(); }
  catch{ return json({error:'La petició de registre no és JSON vàlid.'},400); }
  if(!b.name||!b.email||!b.password||b.password.length<6) return json({error:'Nom, correu i contrasenya (mínim 6 caràcters) són obligatoris.'},400);
  const email=b.email.toLowerCase().trim();
  try{
    const existing=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
    if(existing) return json({error:'Aquest correu ja està registrat.'},409);
    const h=await passwordHash(b.password);
    const r=await env.DB.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?) RETURNING id,name,email,role').bind(b.name.trim(),email,h,'student').first();
    if(!r) return json({error:'No s’ha pogut crear l’usuari.'},500);
    return session(r,env);
  }catch(err){
    console.error('REGISTER_ERROR', err);
    const msg=String(err?.message||err||'Error desconegut');
    if(/unique|constraint/i.test(msg)) return json({error:'Aquest correu ja està registrat.'},409);
    return json({error:'Error intern en crear l’usuari.',detail:msg.slice(0,300)},500);
  }
}
 if(path==='/api/login' && req.method==='POST'){const b=await req.json(); const r=await env.DB.prepare('SELECT id,name,email,password_hash,role FROM users WHERE email=?').bind((b.email||'').toLowerCase().trim()).first(); if(!r||!(await passwordOk(b.password||'',r.password_hash)))return json({error:'Credencials incorrectes.'},401); delete r.password_hash; return session(r,env)}
 if(path==='/api/me') return json({user});
 if(path==='/api/logout'){const t=cookie(req);if(t)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(t)).run();return new Response('',{status:204,headers:{'Set-Cookie':'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'}})}
 if(path==='/api/exercises'){const rows=await env.DB.prepare('SELECT id,chapter,code,title,type,statement,starter_code,rubric_json FROM exercises ORDER BY chapter,sort_order').all(); return json({exercises:rows.results})}
 if(path.startsWith('/api/exercises/') && req.method==='GET'){const id=path.split('/').pop(); const e=await env.DB.prepare('SELECT id,chapter,code,title,type,statement,starter_code,rubric_json,tests_json FROM exercises WHERE id=?').bind(id).first(); return e?json(e):json({error:'No trobat'},404)}
 if(path.startsWith('/api/exercises/') && path.endsWith('/submissions') && req.method==='POST'){if(!user)return json({error:'Cal iniciar sessió.'},401);const id=path.split('/')[3];const e=await env.DB.prepare('SELECT * FROM exercises WHERE id=?').bind(id).first();if(!e)return json({error:'Exercici no trobat'},404);const b=await req.json();const code=String(b.code||'').slice(0,30000);const ai=await aiGrade(env,e,code,b.tests||[]);const result=await env.DB.prepare('INSERT INTO submissions(user_id,exercise_id,code,test_results_json,ai_result_json,status) VALUES(?,?,?,?,?,?) RETURNING id,submitted_at').bind(user.id,e.id,code,JSON.stringify(b.tests||[]),JSON.stringify(ai),'pending').first();return json({submission:result,ai})}
 if(path==='/api/my-submissions' && user){const rows=await env.DB.prepare('SELECT s.*,e.code,e.title FROM submissions s JOIN exercises e ON e.id=s.exercise_id WHERE s.user_id=? ORDER BY s.submitted_at DESC').bind(user.id).all();return json({submissions:rows.results})}
 if(path==='/api/teacher/submissions' && user?.role==='teacher'){const rows=await env.DB.prepare('SELECT s.*,u.name,e.code,e.title FROM submissions s JOIN users u ON u.id=s.user_id JOIN exercises e ON e.id=s.exercise_id ORDER BY s.submitted_at DESC').all();return json({submissions:rows.results})}
 if(path.startsWith('/api/teacher/submissions/') && req.method==='POST' && user?.role==='teacher'){const id=path.split('/').pop();const b=await req.json();const score=Number(b.score);if(!Number.isFinite(score)||score<0||score>10)return json({error:'La nota ha de ser entre 0 i 10.'},400);await env.DB.prepare('UPDATE submissions SET final_score=?,status=?,validated_at=CURRENT_TIMESTAMP WHERE id=?').bind(score,'validated',id).run();return json({ok:true})}
 return json({error:'No trobat'},404);
}

export default {
 async fetch(req,env,ctx){
  try{
   if(new URL(req.url).pathname.startsWith('/api/')) return await api(req,env);
   if(env.ASSETS) return env.ASSETS.fetch(req);
   return text('Digitalització 4ESO');
  }catch(err){
   console.error('UNHANDLED_ERROR',err);
   if(new URL(req.url).pathname.startsWith('/api/')) return json({error:'Error intern del servidor.',detail:String(err?.message||err||'Error desconegut').slice(0,300)},500);
   return text('Error intern del servidor.',500);
  }
 }
};
