const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
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
async function ensurePasswordResetTable(env){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS password_reset_tokens(
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   user_id INTEGER NOT NULL,
   token_hash TEXT NOT NULL UNIQUE,
   expires_at TEXT NOT NULL,
   used_at TEXT,
   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
   created_by INTEGER
 )`).run();
 await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash)').run();
}
const RESET_CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function normalizeResetCode(code){return String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');}
function newPasswordResetCode(){
 const bytes=crypto.getRandomValues(new Uint8Array(10));
 let raw='';
 for(const b of bytes) raw+=RESET_CODE_ALPHABET[b%RESET_CODE_ALPHABET.length];
 return raw.slice(0,5)+'-'+raw.slice(5);
}
let examSchemaReady=false, examSchemaPromise=null;
async function ensureExamTables(env){
 if(examSchemaReady)return;
 if(examSchemaPromise)return examSchemaPromise;
 examSchemaPromise=(async()=>{
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS exams(
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'draft',
     start_at TEXT,
     end_at TEXT,
     duration_minutes INTEGER,
     created_by INTEGER NOT NULL,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`).run();
   await env.DB.prepare(`CREATE TABLE IF NOT EXISTS exam_questions(
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     exam_id INTEGER NOT NULL,
     position INTEGER NOT NULL DEFAULT 1,
     title TEXT NOT NULL,
     statement TEXT NOT NULL DEFAULT '',
     starter_code TEXT NOT NULL DEFAULT '',
     max_score REAL NOT NULL DEFAULT 10,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`).run();
   await env.DB.prepare(`CREATE TABLE IF NOT EXISTS exam_attempts(
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     exam_id INTEGER NOT NULL,
     user_id INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'in_progress',
     started_at TEXT NOT NULL,
     submitted_at TEXT,
     graded_at TEXT,
     final_score REAL,
     teacher_comment TEXT NOT NULL DEFAULT '',
     UNIQUE(exam_id,user_id)
   )`).run();
   await env.DB.prepare(`CREATE TABLE IF NOT EXISTS exam_answers(
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     attempt_id INTEGER NOT NULL,
     question_id INTEGER NOT NULL,
     code TEXT NOT NULL DEFAULT '',
     stdin TEXT NOT NULL DEFAULT '',
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     score REAL,
     feedback TEXT NOT NULL DEFAULT '',
     UNIQUE(attempt_id,question_id)
   )`).run();
   await env.DB.prepare(`CREATE TABLE IF NOT EXISTS exam_events(
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     attempt_id INTEGER NOT NULL,
     question_id INTEGER,
     event_type TEXT NOT NULL,
     meta_json TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`).run();
   await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_exam_questions_exam ON exam_questions(exam_id,position)').run();
   await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam_user ON exam_attempts(exam_id,user_id)').run();
   await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_exam_answers_attempt ON exam_answers(attempt_id,question_id)').run();
   await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_exam_events_attempt ON exam_events(attempt_id,created_at)').run();
  examSchemaReady=true;
 })();
 try{await examSchemaPromise}
 catch(err){examSchemaPromise=null;throw err}
}
function examState(exam,nowMs=Date.now()){
 if(!exam) return 'closed';
 if(exam.status==='draft') return 'draft';
 if(exam.status==='closed') return 'closed';
 const start=exam.start_at?Date.parse(exam.start_at):null,end=exam.end_at?Date.parse(exam.end_at):null;
 if(end!=null && Number.isFinite(end) && nowMs>=end) return 'closed';
 if(exam.status==='open') return 'active';
 if(exam.status==='scheduled'){
  if(start!=null && Number.isFinite(start) && nowMs<start) return 'upcoming';
  return 'active';
 }
 return 'closed';
}
function examAttemptDeadline(exam,attempt){
 const limits=[];
 if(exam?.end_at){const t=Date.parse(exam.end_at);if(Number.isFinite(t))limits.push(t)}
 const mins=Number(exam?.duration_minutes);
 if(attempt?.started_at && Number.isFinite(mins) && mins>0){
  const st=Date.parse(attempt.started_at);if(Number.isFinite(st))limits.push(st+mins*60000);
 }
 return limits.length?new Date(Math.min(...limits)).toISOString():null;
}
async function autoSubmitExpiredExam(env,exam,attempt){
 if(!attempt || attempt.status!=='in_progress') return attempt;
 const deadline=examAttemptDeadline(exam,attempt);
 const expired=deadline && Date.now()>=Date.parse(deadline);
 const closed=examState(exam)==='closed';
 if(expired||closed){
  const at=new Date().toISOString();
  await env.DB.prepare(`UPDATE exam_attempts SET status='submitted',submitted_at=COALESCE(submitted_at,?) WHERE id=? AND status='in_progress'`).bind(at,attempt.id).run();
  return {...attempt,status:'submitted',submitted_at:attempt.submitted_at||at};
 }
 return attempt;
}
async function examHasAttempts(env,examId){
 const row=await env.DB.prepare('SELECT id FROM exam_attempts WHERE exam_id=? LIMIT 1').bind(examId).first();
 return !!row;
}
async function syncExpiredExamAttempts(env,examId=null){
 const sql=`SELECT a.*,e.status exam_status,e.start_at,e.end_at,e.duration_minutes,e.title exam_title
   FROM exam_attempts a JOIN exams e ON e.id=a.exam_id
   WHERE a.status='in_progress'${examId==null?'':' AND a.exam_id=?'}`;
 const rows=examId==null
   ? await env.DB.prepare(sql).all()
   : await env.DB.prepare(sql).bind(examId).all();
 for(const a of rows.results||[]){
  await autoSubmitExpiredExam(env,{
   id:a.exam_id,title:a.exam_title,status:a.exam_status,start_at:a.start_at,end_at:a.end_at,duration_minutes:a.duration_minutes
  },a);
 }
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
,
 {"chapter": 3, "code": "3.1", "title": "Predir i executar", "type": "predict", "statement": "Prediu què farà el programa, explica com s’utilitza input() i identifica la variable que guarda la resposta de l’usuari.", "starter": "# Tasca 1 - Afegeix comentaris al codi següent per predir què passarà quan s'executi.\n\n# Tasca 2 - afegeix comentaris al codi per explicar com es diuen les variables i on s'utilitzen. Assegura't de mostrar on està la variable.\n\nprint(\"Hola! Com et dius?\")\n\nname = input() \n\nprint(\"Hola \" + name + \"! Com estàs avui?\")", "solution": "#Task 1 - Add comments to the code below to predict what will happen when it is run.\n\n#Task 2 - add comments to the code to explain what the variable(s) are called and where they are used. Make sure to show where the variable.\n\n#Outputs the string in the brackets\nprint(\"Hi! What's your name?\")\n\n# Gets user input and assigns it to the name variable\nname = input()\n\n# Outputs a message concatenating the name variable containing user input into the sentence.\nprint(\"Hi \" + name + \"! How are you today?\")", "rubric": [["Predicció i vocabulari", 4], ["Comprensió del codi", 4], ["Comentaris", 2]], "tests": []},
 {"chapter": 3, "code": "3.2", "title": "Investigar", "type": "investigate", "statement": "Respon als comentaris les preguntes sobre entrada, sortida, assignació i concatenació del programa d’exemple.", "starter": "name = \"Billy\"\nprint(\"We want to know if you like progamming!\")\nprint()  # Imprimeix una línia en blanc\nprint(\"Do you like programming \" + name + \"?\")\nanswer = input()\nprint(\"Great, \" + name + \", you said \" + answer + \"!\")\nprint(\"Let's learn some Python today\")\n\n# Quants enunciats de sortida s'utilitzen en el codi?\n # Resposta\n\n# Quin símbol s'utilitza per a la concatenació?\n # Resposta\n\n# Quina és la finalitat del programa?\n # Resposta\n\n# En quina(es) línia(es) s'utilitza l'assignació?\n # Resposta\n\n# Quin símbol s'utilitza per a l'assignació?\n # Resposta\n\n# Quina és la finalitat de l'enunciat de print buit a la línia 3?\n # Resposta", "solution": "name = \"Billy\"\nprint(\"We want to know if you like progamming!\")\nprint()\nprint(\"Do you like programming \" + name + \"?\")\nanswer = input()\nprint(\"Great, \" + name + \", you said \" + answer + \"!\")\nprint(\"Let's learn some Python today\")\n\n# How many output statements are used in the code?\n # Answer 5\n\n# What symbol is used for concatenation?\n # Answer +\n\n# What is the purpose of the program?\n # Answer To greet the user and give them a personalised message.\n\n# What line(s) is assignment used on?\n # Answer 1 and 3\n\n# What symbol is used for assignment?\n # Answer = \n\n# What is the purpose of the empty print statement on line 3?\n # Answer To insert an empty line", "rubric": [["Comprensió conceptual", 5], ["Raonament sobre el codi", 3], ["Respostes/comentaris", 2]], "tests": []},
 {"chapter": 3, "code": "3.3", "title": "Modificar", "type": "modify", "statement": "Modifica el programa perquè demani el nom amb input(), combini la pregunta sobre programació amb l’entrada i utilitzi name i answer a la resposta final.", "starter": "name = \"Billy\"\nprint(\"We want to know if you like progamming!\")\nprint()\nprint(\"Do you like programming \" + name + \"?\")\nanswer = input()\nprint(\"Great! You said \" + answer + \"!\")\nprint(\"Let's learn some Python today\")", "solution": "# Adapta el codi de manera que assigni l'entrada a la variable 'name'. DESAFIAMENT - posa una sol·licitud a la comanda d'entrada per demanar el nom de l'usuari.\nname = input(\"Hola! Com et dius?\")\n\nprint(\"Hola \" + name + \"! Com estàs avui?\")\n\n# Combina les línies 'T'agrada programar?' i answer = input de manera que l'entrada tingui una sol·licitud inclosa.\n\n# Adapta la sortida a la penúltima línia perquè inclogui tant les variables name com answer.\n\nname = \"Billy\"\nprint(\"Volem saber si t'agrada programar!\")\nprint()\n# Combina les línies 'T'agrada programar?' i answer = input de manera que l'entrada tingui una sol·licitud inclosa.\nanswer = input(\"T'agrada programar, \" + name + \"?\")\n# Adapta la sortida a la penúltima línia perquè inclogui tant les variables name com answer.\nprint(\"Genial \" + name + \". Has dit \" + answer + \"!\")\nprint(\"Aprendrem una mica de Python avui\")", "rubric": [["Funcionament", 5], ["Canvis demanats", 3], ["Claredat i comentaris", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "input(", "points": 2}, {"kind": "hasvar", "name": "name", "points": 2}, {"kind": "hasvar", "name": "answer", "points": 2}]},
 {"chapter": 3, "code": "3.4", "title": "Construir", "type": "build", "statement": "Construeix un xatbot senzill: pregunta el nom, fes tres preguntes personals, guarda les respostes, respon utilitzant el nom i mostra un resum final.", "starter": "# Pregunta a l'usuari com es diu i guarda-ho en una variable.\nprint(\"Hola, com et dius?\")\nname = input()\n\n# Saluda a l'usuari pel seu nom.\nprint(\"Encantat de conèixer-te \" + name)\n# Pregunta a l'usuari tres qüestions sobre ell mateix i guarda les seves respostes en tres variables amb noms adequats.\nprint(\"Quin és el teu menjar preferit?\")\nfood = input()\n# Respon a cada una de les preguntes una per una, utilitzant el nom de l'usuari en la resposta.\nprint(\"Guau, \" + name + \", a mi també m'agrada \" + food + \"!\")\n  # Repeteix per a altres 2 preguntes\n\n# Mostra un resum de totes les respostes de l'usuari en una sola frase.\nprint(\"Així que \" + name + \", t'agrada menjar \" + food + \" i tu.......\" + newVariable) # completa la línia amb les variables utilitzades per la Q2 i la Q3\n\n# Finalment, mostra un missatge d'acomiadament.\nprint(\"Molt bé, ara ja saps com començar a programar!\")", "solution": "# Pregunta a l'usuari com es diu i guarda-ho en una variable.\nprint(\"Hola, com et dius?\")\nname = input()\n\n# Saluda a l'usuari pel seu nom.\nprint(\"Encantat de conèixer-te \" + name)\n# Pregunta a l'usuari tres qüestions sobre ell mateix i guarda les seves respostes en tres variables amb noms adequats.\nprint(\"Quin és el teu menjar preferit?\")\nfood = input()\n# Respon a cada una de les preguntes una per una, utilitzant el nom de l'usuari en la resposta.\nprint(\"Guau, \" + name + \", a mi també m'agrada \" + food + \"!\")\n  # Repeteix per a altres 2 preguntes\n\n# Mostra un resum de totes les respostes de l'usuari en una sola frase.\nprint(\"Així que \" + name + \", t'agrada menjar \" + food + \" i tu.......\" + newVariable) # completa la línia amb les variables utilitzades per la Q2 i la Q3\n\n# Finalment, mostra un missatge d'acomiadament.\nprint(\"Molt bé, ara ja saps com començar a programar!\")", "rubric": [["Funcionament", 5], ["Requisits de la tasca", 3], ["Qualitat del codi", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "count_has", "pattern": "input(", "min": 4, "points": 3}, {"kind": "stdout", "inputs": ["Alex", "pizza", "blau", "futbol"], "points": 2}]},
 {"chapter": 4, "code": "4.1", "title": "Predir i executar", "type": "predict", "statement": "Prediu els resultats dels operadors +, -, *, / i // i explica com intervenen variables, operadors i sortida.", "starter": "# Afegeix comentaris a aquest codi per predir què farà.\nprint(8 + 2) \n\nprint(8 - 2)  \n\nprint(8 * 2)  \n\nprint(10 / 4)  \n\nprint(10 // 4)  \n\n# Aquest codi utilitza variables en lloc de números en el càlcul. Afegeix comentaris per explicar com funciona.\n\nnum1 = 20  \nnum2 = 5   \n\nresult = num1 * num2  \n\nprint(result)  \n\n# Aquest codi utilitza l'entrada d'usuari per assignar dades a una variable. Afegeix comentaris per explicar com funciona.\nprint(\"Enter a number\")  \nnum1 = int(input())  \nnum2 = 2  \n\nresult = num1 // num2  \n\nprint(result)", "solution": "# Add comments to this code to predict what it will do.\nprint(8 + 2) #Adds the numbers and outputs 10\n\nprint( 8 - 2) #Subtracts the numbers and outputs 6\n\nprint(8 * 2) #Multiplies the numbers and outputs 16\n\nprint(10 / 4) #Divides the numbers and outputs 2.5 (decimal division)\n\nprint(10 // 4) #Divides the numbers and outputs 2 (integer division)\n\n# This code uses variables in place of numbers in the calculation.  Add comments to explain how it works.\n\nnum1 = 20\nnum2 = 5 #Assigns numbers into the two variables\n\nresult = num1 * num2 # Multiplies num1 & num2 and assigns the answer into the result variable\n\nprint(result) #Outputs the result variable\n\n# This code uses input to assign data into a variable.  Add comments to explain how it works.\nprint(\"Enter a number\")\nnum1 = int(input()) # Casts the input to an integer and assigns it to num1\nnum2 = 2\n\nresult = num1 // num2 # Performs integer division of the user input divided by 2. Assigns the answer to the result variable.\n\nprint(result) # Outputs the result variable.", "rubric": [["Predicció i vocabulari", 4], ["Comprensió del codi", 4], ["Comentaris", 2]], "tests": []},
 {"chapter": 4, "code": "4.2", "title": "Investigar", "type": "investigate", "statement": "Investiga el codi i respon les preguntes sobre càlculs, variables, operadors aritmètics, int() i entrada de dades.", "starter": "# Codi inicial\n\nnum1 = 25\nnum2 = 4\nprint(\"Introdueix un número\")\nnum3 = int(input())\n\ntotal1 = num1 * num2\ntotal2 = num3 + num2\ntotal3 = total1 - total2\n\n# Quantes variables s'utilitzen en el codi?\n  # Resposta\n\n# Indica el número de línia on s'utilitza una instrucció de sortida.\n  # Resposta\n\n# Quin símbol s'utilitza per a l'assignació de variables?\n  # Resposta\n\n# Quin valor es guarda a total1 al final del programa?\n  # Resposta\n\n# Quin valor es guarda a num3 al final del programa?\n  # Resposta\n\n# La línia 8 canvia a total1 = num1 // num2. Com afectaria al programa?\n  # Resposta", "solution": "# Starter code\n\nnum1 = 25\nnum2 = 4\nprint(\"Enter a number\")\nnum3 = int(input())\n\ntotal1 = num1 * num2\ntotal2 = num3 + num2\ntotal3 = total1 - total2\n\n# How many variables are used in the code?\n  # 6\n\n# Give the line number where an output statement is used.\n  # 5\n\n# What symbol is used for variable assignment?\n  # =\n\n# What value is stored in total1 at the end of the program?\n  # 100\n\n# What value is stored in num3 at the end of the program?\n  # Whatever the user has input on line 6\n\n# Line 8 is changed to total1 = num1 // num2. How would it affect the program?\n  # total1 will now store 6 (integer division so it only stores the whole number).  Line 10 will now subratct total2 from 24.", "rubric": [["Comprensió conceptual", 5], ["Raonament sobre el codi", 3], ["Respostes/comentaris", 2]], "tests": []},
 {"chapter": 4, "code": "4.3", "title": "Modificar", "type": "modify", "statement": "Modifica el programa de càlcul seguint les indicacions de l’activitat i comenta els canvis.", "starter": "# Starter code\n\nnum1 = 10\nnum2 = input()\n\ntotal1 = num1 + num2\n\nprint(str(num1) + \" plus \" + str(num2) + \" = \")\n\n# Instruccions\n\n# La línia 4 crea un error. Mira amb atenció per veure què no està bé amb el codi i arregla-ho.\n\n# Afegeix una sol·licitud de text entre les línies 3 i 4 per dir a l'usuari que introdueixi un número.\n\n# Completa la línia 8 per concatenar total 1 en l'afirmació de sortida.\n\n# Afegeix una nova variable amb un identificador sensat. Multiplica num1 i num2 i assigna el resultat a aquesta variable.\n\n# Mostra num1, num2 i la teva nova variable en un format similar a la línia 8.", "solution": "# Starter code\n\nnum1 = 10\n# Line 4 creates an error. Look carefully to see what is wrong with the code and fix it.\n\n# Add a text prompt between lines 3 and 4 to tell the user to enter a number.\nprint(\"Enter a number\")\nnum2 = int(input())\n\ntotal1 = num1 + num2\n# Complete line 8 to concatenate total 1 into the output statement.\nprint(str(num1) + \" plus \" + str(num2) + \" = \" + str(total1))\n\n# Add a new variable with a sensible identifier.  Multiply num1 and num2 together and assign the result into this variable.\n\ntotal2 = num1 * num2\n\n# Output num1, num2 and your new variable in a similar format to line 8.\nprint(str(num1) + \" times \" + str(num2) + \" = \" + str(total2))", "rubric": [["Funcionament", 5], ["Canvis demanats", 3], ["Claredat i comentaris", 2]], "tests": [{"kind": "syntax", "points": 2}]},
 {"chapter": 4, "code": "4.4", "title": "Construir", "type": "build", "statement": "Crea una calculadora d’àrea: demana altura i amplada, converteix-les a enters, calcula l’àrea i mostra el resultat.", "starter": "# Programa per calcular l'àrea d'un rectangle\n\n# Obtenir les dades per l'altura i l'amplada. Convertir a enters i emmagatzemar en variables\n\n# Calcular l'àrea i emmagatzemar el resultat en la variable area\n\n# Mostrar la variable area (convertida a cadena)", "solution": "# Programa per calcular l'àrea d'un rectangle\n\n# Obtenir les dades per l'altura i l'amplada. Convertir a enters i emmagatzemar en variables\naltura = int(input(\"Introdueix l'altura del rectangle: \"))\namplada = int(input(\"Introdueix l'amplada del rectangle: \"))\n\n# Calcular l'àrea i emmagatzemar el resultat en la variable area\narea = altura * amplada\n\n# Mostrar la variable area (convertida a cadena)\nprint(\"L'àrea del rectangle és: \" + str(area) + \"cm2\")\n\n#Another way of outputting integer as string is replace line 9 with area = str(height * width)\n\n#Then you don't need the str on line 13", "rubric": [["Funcionament", 5], ["Requisits de la tasca", 3], ["Qualitat del codi", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "int(input", "points": 2}, {"kind": "has", "pattern": "*", "points": 2}, {"kind": "stdout_contains", "expected": "20", "inputs": ["4", "5"], "points": 2}]},
 {"chapter": 5, "code": "5.1", "title": "Predir i executar", "type": "predict", "statement": "Prediu el comportament dels exemples amb if/else i explica condicions, comparadors, doble igual i indentació.", "starter": "## Exemple de codi 1\n\nedat = 18 \n\nif edat > 18: \n print(\"Ets prou gran per conduir\") \n\n# Exemple de codi 2\n\nnum1 = 1337 \n\nif num1 == 10: \n  print(\"Aquest text es mostra perquè la condició era veritable\") \nelse:\n  print(\"Aquest text es mostra perquè la condició era falsa\") \n\n# Exemple de codi 3\n\nnombre = 5\nprint(\"He pensat en un número entre l'1 i el 10\")\nendevina = int(input(\"Pots endevinar quin és?\"))\n\nif endevina == nombre:\n  print(\"Correcte!\")\nif endevina < nombre:\n  print(\"Massa baix!\")\nif endevina > nombre:\n  print(\"Massa alt!\")", "solution": "# Example code 1\n\nage = 18 \n \nif age > 18: \n print(\"You are old enough to drive\") \n\n # This code contains one branch.  The condition checks the age variable to see if it is greater than 18.  If it is the code outputs 'old enough to drive', otherwise it does nothing.\n\n# Example code 2\n\nnum1 = 1337 \n \nif num1 == 10: \n  print(\"This text is output because the condition was true\") \nelse:\n  print(\"This text is output because the condition was false\") \n\n  # This code has two branches.  The condition checks the num1 variable to see if it is equal to 10.  If it is the code outputs 'This text is output because the condition was true', otherwise it outputs 'This text is output because the condition was false'.\n\n# Example code 3\n\nnumber = 5\nprint(\"I have thought of a number between 1 and 10\")\nguess = int(input(\"Can you guess what it is?\"))\n\nif guess == number:\n  print(\"Correct!\")\nif guess < number:\n  print(\"Too Low!\")\nif guess > number:\n  print(\"Too High!\")\n\n  # This code has three selection statements, each with one branch.  The conditions compare the guess and number variables.  Each condition gets checked, even if the one before it was true.", "rubric": [["Predicció i vocabulari", 4], ["Comprensió del codi", 4], ["Comentaris", 2]], "tests": []},
 {"chapter": 5, "code": "5.2", "title": "Investigar", "type": "investigate", "statement": "Respon les preguntes sobre el funcionament de la selecció if/else del codi d’exemple.", "starter": "# Codi d'exemple\n\nnumber = 5\nprint(\"He pensat en un número entre l'1 i el 10\")\nguess = int(input(\"Pots endevinar quin és?\"))\n\nif guess == number:\n  print(\"Correcte!\")\nif guess < number:\n  print(\"Massa baix!\")\nif guess > number:\n  print(\"Massa alt!\")\n\n# Què passa si introdueixes el conjetura '2'?\n  # Resposta\n\n# Què passa si introdueixes el conjetura '6'?\n  # Resposta\n\n# Què passa si introdueixes el conjetura '5'?\n  # Resposta\n\n# Què passa si introdueixes el conjetura '-5'?\n  # Resposta\n\n# Què passa si introdueixes el conjetura '0'?\n  # Resposta\n\n# Què signifiquen els símbols '<' i '>' a les línies 9 i 11?\n  # Resposta\n\n# Què passa si canviem la línia 5 per if guess = number: ?\n  # Resposta\n\n# Què notes sobre cada línia que SEGUEIX cada declaració IF?\n  # Resposta", "solution": "# Example Code\n\nnumber = 5\nprint(\"I have thought of a number between 1 and 10\")\nguess = int(input(\"Can you guess what it is?\"))\n\nif guess == number:\n  print(\"Correct!\")\nif guess < number:\n  print(\"Too Low!\")\nif guess > number:\n  print(\"Too High!\")\n\n# What happens if you input the guess '2'?\n  # Output 'Too Low!'\n\n# What happens if you input the guess '6'?\n  # Output 'Too High!'\n\n# What happens if you input the guess '5'?\n  # Output 'Correct!'\n\n# What happens if you input the guess '-5'?\n  # Output 'Too Low!'\n\n# What happens if you input the guess '0'?\n  # Output 'Too Low!'\n\n# What do the symbols '<' and '>' mean on lines 9 and 11?\n  # Less than and greater than.\n\n# What happens if you change line 5 to if guess = number: ?\n  # Error message.  Single equals is variable assignment and can't be used in a condition.\n\n# What do you notice about each line that FOLLOWS each IF statement?\n  # They are indented.", "rubric": [["Comprensió conceptual", 5], ["Raonament sobre el codi", 3], ["Respostes/comentaris", 2]], "tests": []},
 {"chapter": 5, "code": "5.3", "title": "Modificar", "type": "modify", "statement": "Modifica el joc d’endevinar perquè comprovi respostes correctes i incorrectes, i mostri missatges adequats amb if/else.", "starter": "# Codi d'Inici\n\nnumber = 5\nprint(\"He pensat en un número entre l'1 i el 10\")\nguess = int(input(\"Pots endevinar quin és?\"))\n\nif guess < number:\n  print(\"Massa baix!\")\nif guess > number:\n  print(\"Massa alt!\")", "solution": "# Starter Code\n\nnumber = 5\nprint(\"I have thought of a number between 1 and 10\")\nguess = int(input(\"Can you guess what it is?\"))\n\nif guess < number:\n  print(\"Too Low!\")\nif guess > number:\n  print(\"Too High!\")\n\n# As well checking whether the answer is too high or too low, add a line that checks whether the guess is equal to the answer and if it isn’t, displays a “Bad luck” message\n\nif guess != number:\n  print(\"Bad luck\")\n\n# The user is asked at the end if they guessed correctly. If they did, display a “Well done” message. If they didn’t, display a “Never mind” message\n\nprint(\"Did you get it right?\")\nanswer = input()\n\nif answer == \"yes\":\n  print(\"Congrats!\")\nelse:\n  print(\"Unlucky!\")", "rubric": [["Funcionament", 5], ["Canvis demanats", 3], ["Claredat i comentaris", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "if ", "points": 2}, {"kind": "has", "pattern": "else", "points": 2}]},
 {"chapter": 5, "code": "5.4", "title": "Construir", "type": "build", "statement": "Crea un programa de qualificacions que comprovi una nota de 1 a 100, indiqui si s’ha aprovat i assigni NA, AS, AN o AE segons el resultat.", "starter": "print(\"Input your test mark.  It should be between 1 and 100\")\nmark = int(input())\n\nif mark > 100:\n  print(\"Too high\")\nif mark < 0:\n  print(\"Too low\")\n\nFail = \"N\"\n\nif mark < 40:\n  Fail = \"Y\"\nelse:\n  Fail = \"N\"\n\nif Fail == \"N\":\n  print(\"Retake required\")\n\n# Extra Challenge\n\nif mark < 40:\n  print(\"Grade U\")\nif mark in range(40,59):\n  print(\"Grade C\")\nif mark in range(60,79):\n  print(\"Grade B\")\nif mark > 80:\n  print(\"Grade any\")", "solution": "", "rubric": [["Funcionament", 5], ["Requisits de la tasca", 3], ["Qualitat del codi", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "if ", "points": 1}, {"kind": "has", "pattern": "else", "points": 1}, {"kind": "has", "pattern": "NA", "points": 1}, {"kind": "has", "pattern": "AE", "points": 1}]},
 {"chapter": 6, "code": "6.1", "title": "Predir i executar", "type": "predict", "statement": "Prediu què farà el codi amb if/elif/else i identifica l’ordre en què es comproven les condicions.", "starter": "# Exemple de codi 1\n\nnumber = 7\nprint(\"He pensat en un número entre l'1 i el 10\")\nguess = int(input(\"Pots endevinar quin és?\"))\n\nif guess == number:\n  print(\"Correcte!\")\nelif guess < number:\n  print(\"Massa baix!\")\nelse:\n  print(\"Massa alt!\")\n\n# Exemple de codi 2\n\nnumber1 = int(input(\"Si us plau, introdueix un número\"))\nnumber2 = int(input(\"Si us plau, introdueix un altre número\"))\n\nif number1 > number2:\n  print(\"El número 1 és més gran que el número 2\")\nelif number2 > number1: \n  print(\"El número 2 és més gran que el número 1\")\nelse:\n  print(\"Ambdós números són iguals\")", "solution": "# Example code 1\n\nnumber = 7# Assigns 7 to the 'number variable'\nprint(\"I have thought of a number between 1 and 10\")\nguess = int(input(\"Can you guess what it is?\")) # Gets input, casts to integer and assigns to 'guess variable'\n\nif guess == number: # Compares guess and number variables to see if they are the same\n  print(\"Correct!\") # Outputs correct if condition is true, otherwise moves to 'elif'\nelif guess < number: # Compares guess and number variables to see if guess is lower\n  print(\"Too Low!\") # Outputs Too low if condition is true, otherwise moves to 'elif'\nelse: # Runs if all previous conditions are false\n  print(\"Too High!\") # Outputs Too high\n\n# Example code 2\n\nnumber1 = int(input(\"Please enter a number\"))\nnumber2 = int(input(\"Please enter another number\")) # Gets and casts two inputs into two variables.\n\nif number1 > number2: # Compares number variables to see if number1 is bigger\n  print(\"Number 1 is bigger than number 2\") # Outputs 'Number 1 is...'' if condition is true, otherwise moves to 'elif'\nelif number2 > number1: # Compares number variables to see if number2 is bigger\n  print(\"Number 2 is bigger than number 1\") # Outputs 'Number 2 is...'' if condition is true, otherwise moves to 'else'\nelse: # Runs if all previous conditions are false\n  print(\"Both numbers are the same\") # Outputs 'The same'", "rubric": [["Predicció i vocabulari", 4], ["Comprensió del codi", 4], ["Comentaris", 2]], "tests": []},
 {"chapter": 6, "code": "6.2", "title": "Investigar", "type": "investigate", "statement": "Investiga una cadena de selecció múltiple i respon les preguntes sobre if, elif, else, comparadors i indentació.", "starter": "# Codi d'exemple\n\nnumero1 = int(input(\"Si us plau, introdueix un número\"))  \nnumero2 = int(input(\"Si us plau, introdueix un altre número\"))  \n\nif numero1 > numero2:\n  print(\"El número 1 és més gran que el número 2\")  \nelif numero2 > numero1: \n  print(\"El número 2 és més gran que el número 1\")  \nelse:\n  print(\"Ambdós números són iguals\")  \n \n\n  # A quina línia comença la selecció?\n    # Resposta\n\n  # Quantes sentències de selecció hi ha en el codi?\n    # Resposta\n\n  # Quantes condicions hi ha en el codi?\n    # Resposta\n\n  # Què significa l'operador >?\n    # Resposta\n\n  # Per què les línies 7, 9 i 11 estan indentades?\n    # Resposta\n\n  # Quina és la finalitat d'aquest programa?\n    # Resposta", "solution": "# Example Code\n\nnumber1 = int(input(\"Please enter a number\"))\nnumber2 = int(input(\"Please enter another number\"))\n\nif number1 > number2:\n  print(\"Number 1 is bigger than number 2\")\nelif number2 > number1: \n  print(\"Number 2 is bigger than number 1\")\nelse:\n  print(\"Both numbers are the same\")\n\n# What line does selection start on?\n  # 6\n\n# How many selection statements are there in the code?\n  # 1 (if, elif & else are all part of the same statement)\n\n# How many conditions are there in the code?\n  # 2 (lines 6 & 8)\n\n# What does the > operator mean?\n  # Greater than\n\n# Why are lines 7, 9 and 11 indented?\n  # They are branches that onlyy run if a condition is true (or all previous conditions are false for line 11)\n\n# What is the purpose of this program?\n  # Get two integer inputs from the user and tell them which is bigger.", "rubric": [["Comprensió conceptual", 5], ["Raonament sobre el codi", 3], ["Respostes/comentaris", 2]], "tests": []},
 {"chapter": 6, "code": "6.3", "title": "Modificar", "type": "modify", "statement": "Afegeix un tercer número i utilitza if/elif/else per comparar-lo amb els dos números existents.", "starter": "# Codi Inicial\n\nnumero1 = int(input(\"Si us plau, introdueix un número: \"))\nnumero2 = int(input(\"Si us plau, introdueix un altre número: \"))\n\nif numero1 > numero2:\n  print(\"El número 1 és més gran que el número 2\")\nelif numero2 > numero1:\n  print(\"El número 2 és més gran que el número 1\")\nelse:\n  print(\"Ambdós números són iguals\")", "solution": "number1 = int(input(\"Please enter a number\"))\nnumber2 = int(input(\"Please enter another number\"))\n# Add a line of code asking the user to enter a third number\nnumber3 = int(input(\"Please enter a third number\"))\n\nif number1 > number2:\n  print(\"Number 1 is bigger than number 2\")\nelif number2 > number1: \n  print(\"Number 2 is bigger than number 1\")\nelse:\n  print(\"Both numbers are the same\")\n\n# Add IF/ELIF/ELSE statements to confirm whether the third number is bigger/smaller/the same as the first number\nif number3 > number1:\n  print(\"Number 3 is bigger than number 1\")\nelif number3 < number1: \n  print(\"Number 3 is smaller than number 1\")\nelse:\n  print(\"Both numbers are the same\")\n\n# and whether it is bigger/smaller/the same as the second number\nif number3 > number2:\n  print(\"Number 3 is bigger than number 2\")\nelif number3 < number2: \n  print(\"Number 3 is smaller than number 2\")\nelse:\n  print(\"Both numbers are the same\")", "rubric": [["Funcionament", 5], ["Canvis demanats", 3], ["Claredat i comentaris", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "elif", "points": 2}, {"kind": "count_has", "pattern": "input(", "min": 3, "points": 2}]},
 {"chapter": 6, "code": "6.4", "title": "Construir", "type": "build", "statement": "Crea un programa que rebi una hora (0–23) i mostri el missatge corresponent del dia utilitzant una cadena if/elif/else.", "starter": "# The user has to enter a number between 0 and 23\nprint(\"Enter the hour in 24 hour clock (0 to 23)\")\nhour = int(input())\n\n# Completa el programa amb una cadena if/elif/else segons l'enunciat.", "solution": "", "rubric": [["Funcionament", 5], ["Requisits de la tasca", 3], ["Qualitat del codi", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "elif", "points": 2}, {"kind": "stdout", "inputs": ["18"], "points": 2}]},
 {"chapter": 7, "code": "7.1", "title": "Predir i executar", "type": "predict", "statement": "Prediu com funcionen els bucles while dels exemples i explica la condició, la repetició i la sortida del bucle.", "starter": "# Codi d'exemple 1\n\n# Afegir comentaris a cada línia per indicar si es troba dins o fora del bucle i què fa.\n\n# Explicar les circumstàncies en què s'executarà el bucle.\n\nprint(\"Quina és la capital de França?\")\nresposta = input()  \n\nwhile resposta != \"París\": \n  print(\"Incorrecte! Torna-ho a provar.\")  \n  resposta = input(\"Quina és la capital de França?\")  \n\nprint(\"Correcte!\") \n\n# Codi d'exemple 2\n\ncomptador = 1  \nwhile comptador < 5: \n  print(\"Aquest codi està dins del bucle\") \n  comptador += 1", "solution": "# Example code 1\n\n# Add comments to explain which code is in the loop and will be repeated.\n\n# Explain the circumstances in which the loop will run.\nprint(\"What is the capital of France?\") # Outside\nanswer = input() #Outside the loop. Gets input\n\nwhile answer != \"Paris\": # Starts the loop.  Repeats whilst the answer variable does not contain 'Paris'\n  print(\"Incorrect! Try again.\") # Inside the loop\n  answer = input(\"What is the capital of France?\") # Inside the loop, gives the user another chance to input\n\nprint(\"Correct!\") # Outputs once the loop has finished\n\n# Example code 2\n\ncounter = 1 # Outside the loop. Sets counter to 1\n\nwhile counter < 5: # Starts the loop, repeats whilst counter < 5\n  print(\"This code is inside the loop\") # Inside. Outputs a message\n  counter += 1 # Inside, adds 1 to counter", "rubric": [["Predicció i vocabulari", 4], ["Comprensió del codi", 4], ["Comentaris", 2]], "tests": []},
 {"chapter": 7, "code": "7.2", "title": "Investigar", "type": "investigate", "statement": "Investiga el codi amb while i respon les preguntes sobre comptadors, condicions i actualització de variables.", "starter": "numero = 7\nprint(\"Estic pensant en un número, pots endevinar-lo?\")\nendevinalla = int(input())\nwhile endevinalla != numero:\n  print(\"Incorrecte! Torna-ho a intentar!\")\n  endevinalla = int(input())\nprint(\"Ho has endevinat!\")\n\n# Dóna el número de línia on comença la iteració.\n  # Resposta\n\n# Què significa '!='?\n  # Resposta\n\n# Quantes variables hi ha en el codi?\n  # Resposta\n\n# Com pots saber quines línies de codi estan dins del bucle?\n  # Resposta\n\n# Quantas vegades es repetirà el bucle?\n  # Resposta\n\n# Què ha de passar perquè el programa executi l'última línia de codi?\n  # Resposta", "solution": "number = 7\nprint(\"I'm thinking of a number, can you guess it?\")\nguess = int(input())\nwhile guess != number:\n  print(\"Wrong! Guess again!\")\n  guess = input()\nprint(\"You guessed it!\")\n\n# Give the line number where iteration starts.\n  # 4\n\n# What does '!=' mean?\n  # Not equal to\n\n# How many variables are there in the code?\n  # 2\n\n# How can you tell which lines of code are inside the loop?\n  # They are indented\n\n# How many times will the loop repeat?\n  # Unknown - until the user inputs '7'\n\n# What has to happen to make the program run the last line of code?\n  # The condition on line 4 has to be false (guess and number variables have to contain the same data.)", "rubric": [["Comprensió conceptual", 5], ["Raonament sobre el codi", 3], ["Respostes/comentaris", 2]], "tests": []},
 {"chapter": 7, "code": "7.3", "title": "Modificar", "type": "modify", "statement": "Modifica la taula de multiplicar: demana el número, mostra número × comptador = producte, incrementa de 2 en 2 i avisa quan acaba.", "starter": "number = 6\ncounter = 1\n\nwhile counter < 13:\n  print(counter * number)\n  counter = counter + 1", "solution": "# Get user input into the number variable.\nprint(\"Enter a number\")\nnumber = int(input())\ncounter = 1\n\nwhile counter < 13:\n\n  # Change the print statement so it outputs *'number' multiplied by 'counter' equals 'product'\n  product = number * counter\n  print(str(counter) + \" multiplied by \" + str(number) + \" equals \" + str(product))\n  # Make the counter increase by 2 every loop\n  counter = counter + 1\n\n# Add a line once the loop has finished to output 'The loop has finished'\nprint(\"The loop has finished\")", "rubric": [["Funcionament", 5], ["Canvis demanats", 3], ["Claredat i comentaris", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "while", "points": 2}, {"kind": "has", "pattern": "+= 2", "points": 1}]},
 {"chapter": 7, "code": "7.4", "title": "Construir", "type": "build", "statement": "Construeix un inici de sessió que repeteixi la petició de contrasenya fins que sigui abc123, compti els intents i mostri l’usuari en el missatge final.", "starter": "pwd1 = \"abc123\"\nprint(\"Enter your username\")\nuName = input()\nprint(\"Enter your password\")\npwd2 = input()\n\n# A partir d'aquí, completa el programa:\n# - repeteix la petició de contrasenya fins que sigui correcta\n# - compta quants intents ha necessitat l'usuari\n# - mostra el nom d'usuari i el nombre d'intents al missatge final", "solution": "", "rubric": [["Funcionament", 5], ["Requisits de la tasca", 3], ["Qualitat del codi", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "while", "points": 2}, {"kind": "stdout", "inputs": ["gaspar", "mal", "abc123"], "points": 2}]},
 {"chapter": 8, "code": "8.1", "title": "Predir i executar", "type": "predict", "statement": "Prediu els resultats dels exemples amb llistes i utilitza correctament els termes llista, element i índex.", "starter": "# Example Code 1\n\nSentence = [\"Always\", \"look\", \"on\", \"the\", \"bright\", \"side\", \"of\",]\nprint(Sentence)\nprint(Sentence[1])\nSentence.append(\"life\")\nSentence[4] = \"sunny\"\nprint(Sentence[4])\nprint(Sentence[0] + \" \" + Sentence[3])\nprint(Sentence)", "solution": "# Example Code 1\n\nSentence = [\"Always\", \"look\", \"on\", \"the\", \"bright\", \"side\", \"of\",] #Creates the list\nprint(Sentence) # Outputs the whole list\nprint(Sentence[1]) # Outputs 'look'\nSentence.append(\"life\") # Adds 'life' to the end of the list\nSentence[4] = \"sunny\" # Changes 'bright' to 'sunny'\nprint(Sentence[4]) # Outputs 'sunny'\nprint(Sentence[0] + \" \" + Sentence[3]) # Outputs 'Always the'\nprint(Sentence) # Outputs the whole list - 'Always look on the sunny side of life'", "rubric": [["Predicció i vocabulari", 4], ["Comprensió del codi", 4], ["Comentaris", 2]], "tests": []},
 {"chapter": 8, "code": "8.2", "title": "Investigar", "type": "investigate", "statement": "Investiga les operacions de llista del codi: índexs, longitud, afegir, inserir, eliminar i recorregut.", "starter": "# Example code:\n\nnames = [\"Alex\",\"Anita\",\"Patrick\",\"Atif\",\"Sue\"]\n\nprint(\"Enter a number for your choice.\")\nprint(\"1. Show all\")\nprint(\"2. Add name\")\nprint(\"3. Show name\")\nprint(\"4. Exit\")\nchoice = int(input())\n\nif choice == 1:\n  print(names)\nelif choice == 2:\n  name = input(\"Enter the name\")\n  names.append(name)\nelif choice == 3:\n  print(\"Enter the index of the name\")\n  index = int(input())\n  print(names[index])\nelse:\n  print(\"Goodbye\")\n\n# What is the identifier for the list in this program?\n  # Answer\n\n# What would happen if you choose option “3” and entered index “0”? \n  # Answer\n\n# What would happen if you choose option “3” and entered index “7”?\n  # Answer\n\n# What would happen if you choose option “2” and entered the name “Stuart”?\n  # Answer\n\n# What is the purpose of int(input()) on line 10 ?\n  #", "solution": "# Example code:\n\nnames = [\"Alex\",\"Anita\",\"Patrick\",\"Atif\",\"Sue\"]\n\nprint(\"Enter a number for your choice.\")\nprint(\"1. Show all\")\nprint(\"2. Add name\")\nprint(\"3. Show name\")\nprint(\"4. Exit\")\nchoice = int(input())\n\nif choice == 1:\n  print(names)\nelif choice == 2:\n  name = input(\"Enter the name\")\n  names.append(name)\nelif choice == 3:\n  print(\"Enter the index of the name\")\n  index = int(input())\n  print(names[index])\nelse:\n  print(\"Goodbye\")\n\n# What is the identifier for the list in this program?\n  # names\n\n# What would happen if you choose option “3” and entered index “0”? \n  # Output 'Alex'\n\n# What would happen if you choose option “3” and entered index “7”?\n  # Error - out of range.  List does not have an item at index 7\n\n# What would happen if you choose option “2” and entered the name “Stuart”?\n  # 'Stuart' would be added to the end of the list\n\n# What is the purpose of int(input()) on line 10?\n  # To convert the input from a string into an integer (casting).", "rubric": [["Comprensió conceptual", 5], ["Raonament sobre el codi", 3], ["Respostes/comentaris", 2]], "tests": []},
 {"chapter": 8, "code": "8.3", "title": "Modificar", "type": "modify", "statement": "Afegeix Minecraft al principi, permet seleccionar un element per índex i afegeix o elimina un videojoc segons si ja és a la llista.", "starter": "# Starter Code\n\nvideoGames = [\"Mario\", \"Sonic\", \"Pokemon\", \"Zelda\"]", "solution": "videoGames = [\"Mario\", \"Sonic\", \"Joust\", \"Zelda\"]\n\n# Write code to perform the following tasks.\n\n  # Add 'Minecraft' to the start of the list.\nvideoGames.insert(0,\"Minecraft\")\n  # Ask the user to input a number between 0 and 4 and store it in a variable.  Output the item at this position in the list.\n\ngamePos = int(input(\"Enter a number between 0 and 4.\"))\n\n#Complex concatentaion with variables and strings here, make sure students are using all the necessary + signs\nprint(\"The game at position \" + str(gamePos) + \" is \" + videoGames[gamePos])\n\n# Ask the user to input the name of a video game and store it in a variable.  If this video game is in the list then remove it from the list and output a message .  If it isn't in the list then add it to the end.\ngame = input(\"Enter the name of a video game\")\n\nif game in videoGames:\n  print(game + \" was already in the list, so has been deleted.\")\n  videoGames.remove(game)\nelse:\n  print(game + \" wasn't already in the list, so has been added to the end.\")\n  videoGames.append(game)\n\n  # Output the whole list\nprint(videoGames)", "rubric": [["Funcionament", 5], ["Canvis demanats", 3], ["Claredat i comentaris", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "Minecraft", "points": 1}, {"kind": "has", "pattern": ".append", "points": 1}, {"kind": "has", "pattern": ".remove", "points": 1}]},
 {"chapter": 8, "code": "8.4", "title": "Executar", "type": "build", "statement": "Construeix el combat contra un zombi: crea una llista d’armes, permet triar-ne o afegir-ne una i compara l’arma escollida amb la debilitat del zombi.", "starter": "#Define four functions - add, subtract, multiply, divide that add multiply etc two numbers and return the result. Each should have two integer number arguments.\n\ndef add(num1,num2):\n  return(num1 + num2)\n\ndef subtract(num1,num2):\n  return(num1 - num2)\n\ndef multiply(num1,num2):\n  return(num1 * num2)\n\ndef divide(num1,num2):\n  return(num1 / num2)\n\n# The user is asked to input two numbers.  These numbers will be passed as arguments into one of the functions.\nuserNum1 = int(input(\"Enter a number\"))\nuserNum2 = int(input(\"Enter another number\"))\n\n# The user is asked to input 1 to add, 2 to subtract etc.\n\nchoice = int(input(\"Enter 1 to add, 2 to subtract, 3 to multiply or 4 to divide\"))\n\n# If they input 1, call the ‘add’ function, input 2 calls the ‘subtract’ function etc\n\nif choice == 1:\n  outputNum = add(userNum1, userNum2)\nelif choice == 2:\n  outputNum = subtract(userNum1, userNum2)\nelif choice == 3:\n  outputNum = multiply(userNum1, userNum2)\nelse:\n  outputNum = divide(userNum1, userNum2)\n\n# Output the returned result as part of a sentence.\nprint(outputNum)", "solution": "", "rubric": [["Funcionament", 5], ["Requisits de la tasca", 3], ["Qualitat del codi", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "[", "points": 1}, {"kind": "has", "pattern": "if ", "points": 1}, {"kind": "has", "pattern": "debilitat", "points": 1}]},
 {"chapter": 9, "code": "9.1", "title": "Predir i executar", "type": "predict", "statement": "Prediu l’ordre d’execució dels exemples amb subrutines i explica els conceptes subrutina, crida, paràmetre i return.", "starter": "# Exemple de Codi 1\n\ndef dir_hola():\n  print(\"Hola! Bon dia!\")\n\ndef oferir_beguda():\n  print(\"Voldries una mica de te?\")\n\ndef oferir_menjar():\n  print(\"Vols una galeta?\")\n\ndef dir_adeu():\n  print(\"Doncs adéu.\")\n\noferir_beguda()\ndir_hola()\noferir_menjar()\n\n# Exemple de codi 2\ndef matematiques1():\n  num1 = 50\n  num2 = 5\n  return num1 + num2\n\ndef matematiques2():\n  num1 = 50\n  num2 = 5\n  return num1 - num2\n\ndef matematiques3():\n  num1 = 50\n  num2 = 5\n  return num1 * num2\n\nresultatNum = matematiques2()\nprint(resultatNum)\n\n# Exemple de Codi 3\ndef ubicacio(pais):\n  print(\"Sóc de \" + pais)\n\nubicacio(\"Filipines\")", "solution": "# Example Code 1\n\n# Program will output: Would you care for a spot of tea?  Why hello there! Biscuit? \n\ndef say_hi():\n  print(\"Why hello there!\")\n\ndef offer_drink():\n  print(\"Would you care for a spot of tea?\")\n\ndef offer_food():\n  print(\"Biscuit?\")\n\ndef say_bye():\n  print(\"Cheerio then.\")\n\noffer_drink()\nsay_hi()\noffer_food()\n\n# Example Code 2\n\n# The output will be 45. There are three different functions defined, but only maths2 is called.  This function subtracts 5 ftom 50.\n\ndef maths1():\n  num1 = 50\n  num2 = 5\n  return num1 + num2\n\ndef maths2():\n  num1 = 50\n  num2 = 5\n  return num1 - num2 # Preforms the calculation and returns the result to the main program\n\ndef maths3():\n  num1 = 50\n  num2 = 5\n  return num1 * num2\n\noutputNum = maths2() # Calls the function and assigns the data returned into the 'outputNum' variable.\nprint(outputNum)\n\n# Example Code 3\n\ndef location(country): # Creates the subroutine\n  print(\"I am from \" + country)\n\nlocation(\"Brazil\") # Calls the subroutine. Puts 'Brazil' into the 'country' parameter.", "rubric": [["Predicció i vocabulari", 4], ["Comprensió del codi", 4], ["Comentaris", 2]], "tests": []},
 {"chapter": 9, "code": "9.2", "title": "Investigar", "type": "investigate", "statement": "Respon les preguntes sobre funcions, return, paràmetres, crides i indentació del codi d’exemple.", "starter": "# Codi d'exemple\n\ndef matematiques1():\n  numero1 = 50\n  numero2 = 5\n  return numero1 + numero2\n\ndef matematiques2():\n  numero1 = 50\n  numero2 = 5\n  return numero1 - numero2\n\ndef matematiques3(numero1, numero2):\n  return numero1 * numero2\n\nnumeroSortida = matematiques2()\nprint(numeroSortida)\n\n# Quantes funcions hi ha en el codi?\n  # Resposta\n\n# Com saps que són funcions, i no només subrutines?\n  # Resposta\n\n# Quines funcions tenen paràmetres? Com pots saber-ho?\n  # Resposta\n\n# Quines funcions són cridades en el codi?\n  # Resposta\n\n# Com saps a quines línies de codi pertanyen a una funció o subrutina?\n  # Resposta", "solution": "# Example Code\n\ndef maths1():\n  num1 = 50\n  num2 = 5\n  return num1 + num2\n\ndef maths2():\n  num1 = 50\n  num2 = 5\n  return num1 - num2\n\ndef maths3(num1, num2):\n  return num1 * num2\n\noutputNum = maths2()\nprint(outputNum)\n\n# How many functions are there in the code?\n  # 3\n\n# How do you know that they are functions, not just subroutines?\n  # They return a value - have the 'return' statement\n\n# Which functions have parameters?  How can you tell?\n  # maths3 - it has two parameters in the brackets after its identifier\n\n# Which functions are called in the code?\n  # maths2\n\n# How do you know which lines of code belong to a function?\n  # They are indented after def functionName", "rubric": [["Comprensió conceptual", 5], ["Raonament sobre el codi", 3], ["Respostes/comentaris", 2]], "tests": []},
 {"chapter": 9, "code": "9.3", "title": "Modificar", "type": "modify", "statement": "Canvia el nom de la funció, crida-la amb Suècia i torna-la a cridar amb un país introduït per l’usuari.", "starter": "def my_function(country):\n  print(\"I am from \" + country)\n\nmy_function(\"Brazil\")", "solution": "def location(country): # Rename the function so that it has a sensible name. \n  print(\"I am from \" + country)\n\nlocation(\"Brazil\") #Don't forget to rename it when it is called.\n\nlocation(\"Sweden\") # Call the function with the argument 'Sweden'\n\n# Get the user to input a country. Store it in a variable. Call the function with the variable as the argument.\nprint(\"Where are you from?\")\ncountry = input\nlocation(country)", "rubric": [["Funcionament", 5], ["Canvis demanats", 3], ["Claredat i comentaris", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "def ", "points": 1}, {"kind": "has", "pattern": "Suècia", "points": 1}, {"kind": "has", "pattern": "input(", "points": 1}]},
 {"chapter": 9, "code": "9.4", "title": "Executar", "type": "build", "statement": "Construeix quatre funcions —suma, resta, multiplica i divideix—, demana dos números i una operació, crida la funció adequada i mostra el resultat.", "starter": "#Define four functions - add, subtract, multiply, divide that add multiply etc two numbers and return the result. Each should have two integer number arguments.\n\ndef add(num1,num2):\n  return(num1 + num2)\n\ndef subtract(num1,num2):\n  return(num1 - num2)\n\ndef multiply(num1,num2):\n  return(num1 * num2)\n\ndef divide(num1,num2):\n  return(num1 / num2)\n\n# The user is asked to input two numbers.  These numbers will be passed as arguments into one of the functions.\nuserNum1 = int(input(\"Enter a number\"))\nuserNum2 = int(input(\"Enter another number\"))\n\n# The user is asked to input 1 to add, 2 to subtract etc.\n\nchoice = int(input(\"Enter 1 to add, 2 to subtract, 3 to multiply or 4 to divide\"))\n\n# If they input 1, call the ‘add’ function, input 2 calls the ‘subtract’ function etc\n\nif choice == 1:\n  outputNum = add(userNum1, userNum2)\nelif choice == 2:\n  outputNum = subtract(userNum1, userNum2)\nelif choice == 3:\n  outputNum = multiply(userNum1, userNum2)\nelse:\n  outputNum = divide(userNum1, userNum2)\n\n# Output the returned result as part of a sentence.\nprint(outputNum)", "solution": "", "rubric": [["Funcionament", 5], ["Requisits de la tasca", 3], ["Qualitat del codi", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "count_has", "pattern": "def ", "min": 4, "points": 3}, {"kind": "has", "pattern": "return", "points": 1}, {"kind": "has", "pattern": "elif", "points": 1}]},
 {"chapter": 10, "code": "10.1", "title": "Manipulació de strings i llistes", "type": "build", "statement": "Escalfament de criptografia. Escriu funcions petites que practiquin índexs, len(), slicing, lower()/upper(), recorreguts i construcció de noves cadenes o llistes. Completa com a mínim els quatre reptes del codi inicial.", "starter": "def tercer_caracter(s):\n    pass\n\ndef ultim_caracter(s):\n    pass\n\ndef compta_vocals(s):\n    pass\n\ndef caracters_parells(s):\n    pass\n\nprint(tercer_caracter(\"PYTHON\"))\nprint(ultim_caracter(\"PYTHON\"))\nprint(compta_vocals(\"Every vowel counts\"))\nprint(caracters_parells(\"PROGRAMACIO\"))", "solution": "def tercer_caracter(s): return s[2]\ndef ultim_caracter(s): return s[-1]\ndef compta_vocals(s):\n    total=0\n    for c in s.lower():\n        if c in \"aeiou\": total += 1\n    return total\ndef caracters_parells(s): return s[::2]", "rubric": [["Funcionament", 5], ["Requisits de la tasca", 3], ["Qualitat del codi", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "count_has", "pattern": "def ", "min": 4, "points": 3}, {"kind": "has", "pattern": "for ", "points": 1}]},
 {"chapter": 10, "code": "10.2", "title": "Projecte Caesar Shift", "type": "build", "statement": "Implementa caesar_encode(text, n) i caesar_decode(text, n). Treballa només amb majúscules i utilitza alpha. HELLOWORLD amb desplaçament 5 ha de codificar-se com MJQQTBTWQI, i descodificar-lo ha de recuperar HELLOWORLD.", "starter": "# Read the instructions to see what you need to do here!\n\nalpha = \"ABCDEFGHIJKLMNOPQRSTUVWXYZ\"\n\ndef caesar_encode(text, n):\n  return \"\"\n\ndef caesar_decode(text, n):\n  return \"\"\n\ntest = \"HELLOWORLD\"\nshift = 5\nenc = caesar_encode(test, shift)\ndec = caesar_decode(enc, shift)\nprint(enc)\nprint(dec)\n# If this worked, dec should be the same as test!", "solution": "# Read the instructions to see what you need to do here!\n\nalpha = \"ABCDEFGHIJKLMNOPQRSTUVWXYZ\"\n\ndef caesar_encode(text, n):\n  answer_list = []\n  for letter in text:\n    ind = alpha.index(letter)\n    ind += n\n    ind %= 26\n    answer_list.append(alpha[ind])\n  return \"\".join(answer_list)\n\ndef caesar_decode(text, n):\n  answer_list = []\n  for letter in text:\n    ind = alpha.index(letter)\n    ind -= n\n    ind %= 26\n    answer_list.append(alpha[ind])\n  return \"\".join(answer_list)\n\ntest = \"HELLOWORLD\"\nshift = 5\nenc = caesar_encode(test, shift)\ndec = caesar_decode(enc, shift)\nprint(enc)\nprint(dec)\n# If this worked, dec should be the same as test!", "rubric": [["Codificació correcta", 4], ["Descodificació correcta", 3], ["Ús d’índexs i mòdul", 2], ["Claredat", 1]], "tests": [{"kind": "syntax", "points": 1}, {"kind": "has", "pattern": "def caesar_encode", "points": 1}, {"kind": "has", "pattern": "def caesar_decode", "points": 1}, {"kind": "stdout_contains", "expected": "MJQQTBTWQI", "inputs": [], "points": 3}, {"kind": "stdout_contains", "expected": "HELLOWORLD", "inputs": [], "points": 2}]},
 {"chapter": 10, "code": "10.3", "title": "Xifrat de substitució", "type": "build", "statement": "Implementa sub_encode i sub_decode amb un alfabet xifrat. Per al test HELLOWORLD i WJKUXVBMIYDTPLHZGONCRSAEFQ, la codificació esperada és MXTTHAHOTU i la descodificació ha de recuperar el text original.", "starter": "# Read the instructions to see what you need to do here!\n\nalpha = \"ABCDEFGHIJKLMNOPQRSTUVWXYZ\"\n\ndef sub_encode(text, codebet):\n  return \"\"\n\ndef sub_decode(text, codebet):\n  return \"\"\n\ntest = \"HELLOWORLD\"\ncipher_alphabet = \"WJKUXVBMIYDTPLHZGONCRSAEFQ\"\nenc = sub_encode(test, cipher_alphabet)\ndec = sub_decode(enc, cipher_alphabet)\nprint(enc)\nprint(dec)\n# If this worked, dec should be the same as test!", "solution": "# Read the instructions to see what you need to do here!\n\nalpha = \"ABCDEFGHIJKLMNOPQRSTUVWXYZ\"\n\ndef sub_encode(text, codebet):\n  answer_list = []\n  for letter in text:\n    ind = alpha.index(letter)\n    new_letter = codebet[ind]\n    answer_list.append(new_letter)\n  return \"\".join(answer_list)\n\ndef sub_decode(text, codebet):\n  answer_list = []\n  for letter in text:\n    ind = codebet.index(letter)\n    new_letter = alpha[ind]\n    answer_list.append(new_letter)\n  return \"\".join(answer_list)\n\ntest = \"HELLOWORLD\"\ncipher_alphabet = \"WJKUXVBMIYDTPLHZGONCRSAEFQ\"\nenc = sub_encode(test, cipher_alphabet)\ndec = sub_decode(enc, cipher_alphabet)\nprint(enc)\nprint(dec)\n# If this worked, dec should be the same as test!", "rubric": [["Funcionament", 5], ["Requisits de la tasca", 3], ["Qualitat del codi", 2]], "tests": [{"kind": "syntax", "points": 1}, {"kind": "stdout_contains", "expected": "MXTTHAHOTU", "points": 4}, {"kind": "stdout_contains", "expected": "HELLOWORLD", "points": 2}]},
 {"chapter": 10, "code": "10.4", "title": "Vigenère Cipher", "type": "build", "statement": "Implementa les funcions per codificar i descodificar un text en majúscules amb una paraula clau Vigenère. Cal recórrer el text per índex perquè la clau es repeteix al llarg del missatge.", "starter": "# Read the instructions to see what you need to do here!\n\nalpha = \"ABCDEFGHIJKLMNOPQRSTUVWXYZ\"\n\ndef vig_encode(text, keyword):\n  return \"\"\n\ndef vig_decode(text, keyword):\n  return \"\"\n\ntest = \"THEQUICKBROWNFOXJUMPEDOVERTHELAZYDOG\"\nvig_key = \"TEST\"\nenc = vig_encode(test, vig_key)\ndec = vig_decode(enc, vig_key)\nprint(enc)\nprint(dec)\n# If this worked, dec should be the same as test!", "solution": "# Read the instructions to see what you need to do here!\n\nalpha = \"ABCDEFGHIJKLMNOPQRSTUVWXYZ\"\n\ndef vig_encode(text, keyword):\n  new_message_list = []\n  for count in range(len(text)):\n    m_num = alpha.index(text[count])\n    k_num = alpha.index(keyword[count % len(keyword)])\n    e_num = (m_num + k_num) % 26\n    new_message_list.append(alpha[e_num])\n  return ''.join(new_message_list)\n\ndef vig_decode(text, keyword):\n  new_message_list = []\n  for count in range(len(text)):\n    m_num = alpha.index(text[count])\n    k_num = alpha.index(keyword[count % len(keyword)])\n    e_num = (m_num - k_num) % 26\n    new_message_list.append(alpha[e_num])\n  return ''.join(new_message_list)\n\ntest = \"THEQUICKBROWNFOXJUMPEDOVERTHELAZYDOG\"\nvig_key = \"TEST\"\nenc = vig_encode(test, vig_key)\ndec = vig_decode(enc, vig_key)\nprint(enc)\nprint(dec)\n# If this worked, dec should be the same as test!", "rubric": [["Codificació", 4], ["Descodificació", 3], ["Gestió correcta de la clau i índexs", 2], ["Claredat", 1]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "count_has", "pattern": "def ", "min": 2, "points": 2}, {"kind": "has", "pattern": "range", "points": 1}]},
 {"chapter": 10, "code": "10.5", "title": "RSA — ampliació", "type": "build", "statement": "Ampliació avançada del projecte de criptografia: experimenta amb l’esquema RSA. Implementa potència modular per xifrar i desxifrar nombres amb una clau pública i una de privada. No cal generar claus grans: treballa amb l’exemple petit proporcionat.", "starter": "# Exemple RSA petit (només didàctic)\np = 61\nq = 53\nm = p*q\ne = 17\nd = 2753\n\ndef encrypt_number(x):\n    # retorna x^e mod m\n    pass\n\ndef decrypt_number(y):\n    # retorna y^d mod m\n    pass\n\nmessage = 65\nencrypted = encrypt_number(message)\ndecrypted = decrypt_number(encrypted)\nprint(encrypted)\nprint(decrypted)", "solution": "def encrypt_number(x): return pow(x,e,m)\ndef decrypt_number(y): return pow(y,d,m)", "rubric": [["Funcionament", 5], ["Requisits de la tasca", 3], ["Qualitat del codi", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "pow(", "points": 2}, {"kind": "stdout_contains", "expected": "65", "points": 3}]},
 {"chapter": 11, "code": "11.1", "title": "Python Basics", "type": "build", "statement": "Repassa funcions amb paràmetres i les funcions len(), input() i print(). Completa les dues funcions perquè mostrin la longitud d’una cadena i diverses còpies de la cadena.", "starter": "def print_length(text):\n    # Mostra la longitud de text\n    pass\n\ndef print_copies(text):\n    # Mostra text 3 vegades\n    pass\n\nword = input(\"Escriu una paraula: \")\nprint_length(word)\nprint_copies(word)", "solution": "def print_length(text): print(len(text))\ndef print_copies(text): print(text*3)", "rubric": [["Funcionament", 5], ["Requisits de la tasca", 3], ["Qualitat del codi", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "count_has", "pattern": "def ", "min": 2, "points": 2}, {"kind": "has", "pattern": "len(", "points": 2}, {"kind": "stdout", "inputs": ["hola"], "points": 1}]},
 {"chapter": 11, "code": "11.2", "title": "Conditionals", "type": "build", "statement": "Crea una funció handle_input(text) que respongui de manera diferent segons el text rebut, utilitzant if, elif i else. Després prova-la amb entrades de l’usuari.", "starter": "def handle_input(text):\n    # Respon a \"hola\", \"adeu\" i qualsevol altre text\n    pass\n\ntext = input(\"Què vols dir? \")\nhandle_input(text.lower())", "solution": "def handle_input(text):\n    if text == \"hola\": print(\"Hola!\")\n    elif text == \"adeu\": print(\"Fins aviat!\")\n    else: print(\"No t'entenc\")", "rubric": [["Funcionament", 5], ["Requisits de la tasca", 3], ["Qualitat del codi", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "elif", "points": 2}, {"kind": "stdout", "inputs": ["hola"], "points": 2}]},
 {"chapter": 11, "code": "11.3", "title": "Guess the Number", "type": "build", "statement": "Completa handle_input perquè compari la suposició de l’usuari amb target_number i indiqui si és massa alta, massa baixa o correcta. El bucle d’entrada ja està preparat; la funció no ha de contenir input() ni while.", "starter": "target_number = 42\n\ndef handle_input(user_number):\n    # user_number és un enter\n    # compara'l amb target_number\n    pass\n\n# Proves ràpides\nhandle_input(30)\nhandle_input(60)\nhandle_input(42)", "solution": "def handle_input(user_number):\n    if user_number > target_number: print(\"Massa alt\")\n    elif user_number < target_number: print(\"Massa baix\")\n    else: print(\"Correcte!\")", "rubric": [["Funcionament", 5], ["Requisits de la tasca", 3], ["Qualitat del codi", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "elif", "points": 2}, {"kind": "stdout_contains", "expected": "Correcte", "points": 2}]},
 {"chapter": 11, "code": "11.4", "title": "Text-Based Adventure", "type": "project", "statement": "Projecte llarg: crea una aventura de text amb almenys tres localitzacions. Utilitza una variable per controlar la localització actual, una funció per cada zona, condicionals per interpretar ordres i variables o diccionaris per guardar l’estat del joc. El joc ha de tenir un objectiu i una manera d’acabar.", "starter": "# Aventura de text\ncurrent_room = \"entrada\"\ninventory = []\n\ndef entrada(command):\n    # Processa ordres de l'entrada\n    pass\n\ndef sala(command):\n    pass\n\ndef sortida(command):\n    pass\n\n# Comença implementant i provant cada funció per separat.\n", "solution": "Projecte obert: la solució depèn del disseny de cada alumne.", "rubric": [["Estructura amb funcions i estat", 3], ["Condicionals i navegació", 3], ["Joc funcional amb objectiu", 2], ["Claredat, proves i creativitat", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "count_has", "pattern": "def ", "min": 3, "points": 2}, {"kind": "has", "pattern": "if ", "points": 1}]},
 {"chapter": 12, "code": "12.1", "title": "Base de dades personal — prototip", "type": "project", "statement": "Adaptació del projecte original de Replit al navegador: decideix quines dades vols recollir i crea un prototip amb un diccionari Python. Cada clau ha d’identificar una observació i cada valor ha de contenir diverses dades relacionades. Afegeix una funció per inserir registres i una altra per llistar-los.", "starter": "database = {}\n\ndef add_record(key, value):\n    # desa el registre\n    pass\n\ndef show_records():\n    # recorre i mostra tots els registres\n    pass\n\n# Afegeix dades de prova abans de començar la recollida real.\n", "solution": "def add_record(key,value): database[key]=value\ndef show_records():\n    for key,value in database.items(): print(key,value)", "rubric": [["Disseny de les dades", 3], ["Inserció i consulta", 3], ["Dades de prova i funcionament", 2], ["Claredat", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "{}", "points": 1}, {"kind": "count_has", "pattern": "def ", "min": 2, "points": 2}]},
 {"chapter": 12, "code": "12.2", "title": "Recollida i persistència CSV", "type": "project", "statement": "Amplia el teu projecte perquè pugui exportar els registres a format CSV. En aquesta plataforma el codi s’executa al navegador, així que utilitzarem CSV en lloc de la base de dades específica de Replit. Genera com a mínim diverses files de dades coherents.", "starter": "import csv\n\nrecords = [\n    # Exemple: [\"data\", valor1, valor2]\n]\n\ndef export_csv(records):\n    with open(\"dades.csv\", \"w\", newline=\"\") as f:\n        writer = csv.writer(f)\n        # escriu les files\n        pass\n", "solution": "def export_csv(records):\n    with open(\"dades.csv\",\"w\",newline=\"\") as f:\n        csv.writer(f).writerows(records)", "rubric": [["Funcionament", 5], ["Requisits de la tasca", 3], ["Qualitat del codi", 2]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "csv", "points": 2}, {"kind": "has", "pattern": "writer", "points": 2}]},
 {"chapter": 12, "code": "12.3", "title": "Visualització amb pyplot", "type": "project", "statement": "Utilitza matplotlib.pyplot per explorar dades. Crea com a mínim tres visualitzacions diferents (per exemple barres, histograma i dispersió), posa títols i etiquetes als eixos i explica què mostra cada gràfic. La primera càrrega de matplotlib al navegador pot tardar una mica.", "starter": "import matplotlib.pyplot as plt\n\n# Substitueix aquestes dades per les teves\nx = [1, 2, 3, 4, 5]\ny = [2, 5, 4, 8, 7]\n\nplt.plot(x, y)\nplt.title(\"Primera visualització\")\nplt.xlabel(\"X\")\nplt.ylabel(\"Y\")\nplt.show()\n\n# Crea almenys dues visualitzacions més.\n", "solution": "Projecte obert: s’esperen almenys tres tipus o configuracions de gràfic amb títols i etiquetes.", "rubric": [["Tres visualitzacions", 4], ["Etiquetes i presentació", 2], ["Interpretació de dades", 3], ["Qualitat del codi", 1]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "matplotlib.pyplot", "points": 1}, {"kind": "count_has", "pattern": "plt.", "min": 6, "points": 2}]},
 {"chapter": 12, "code": "12.4", "title": "Projecte final: analitza les teves dades", "type": "project", "statement": "Projecte final del curs: analitza el conjunt de dades que has recollit. Genera almenys sis gràfics durant l’exploració, selecciona els tres més interessants i documenta al codi què explica cadascun. La nota valorarà especialment que les dades i les conclusions responguin una pregunta real que t’interessi.", "starter": "# PROJECTE FINAL — ANÀLISI DE DADES\n# 1. Carrega o escriu aquí les dades recollides.\n# 2. Prepara les llistes/estructures necessàries.\n# 3. Prova almenys sis visualitzacions.\n# 4. Conserva les tres millors i comenta què mostren.\n\nimport matplotlib.pyplot as plt\n\n", "solution": "Projecte obert i personal. El professor valida la qualitat de les dades, els gràfics i les conclusions.", "rubric": [["Recollida i preparació de dades", 2], ["Exploració amb almenys sis gràfics", 2], ["Tres visualitzacions finals", 2], ["Interpretació i conclusions", 3], ["Qualitat del codi", 1]], "tests": [{"kind": "syntax", "points": 2}, {"kind": "has", "pattern": "matplotlib.pyplot", "points": 1}]}];

// Inicis corregits: els exercicis de construcció no han de revelar la solució.
const correctedStarters = {
 '5.4': `# Programa de qualificacions (nota entre 1 i 100)
nota = int(input("Introdueix la nota (1-100): "))

# Comprova que la nota sigui vàlida.
# Indica si l'alumne ha aprovat amb if/else.
# Assigna NA, AS, AN o AE segons la qualificació.
`,
 '8.4': `# Combat contra un zombi: treball amb llistes
armes = ["espasa", "arc", "destral"]
debilitat = "arc"

# Mostra les armes disponibles.
# Deixa que el jugador en triï una o n'afegeixi una de nova.
# Compara l'arma escollida amb la debilitat del zombi.
`,
 '9.4': `# Calculadora amb quatre funcions
# Defineix les funcions suma, resta, multiplica i divideix.
# Cada funció ha de rebre dos números i retornar el resultat.

# Demana dos números i quina operació es vol fer.

# Crida la funció adequada i mostra el resultat.
`
};
function starterForExercise(exercise){
 return correctedStarters[exercise.code] ?? exercise.starter_code;
}

async function seed(env){const n=await env.DB.prepare('SELECT COUNT(*) AS total FROM exercises').first(); if(Number(n?.total||0)>=seedExercises.length)return; for(const e of seedExercises){await env.DB.prepare(`INSERT OR IGNORE INTO exercises(chapter,code,title,type,statement,starter_code,reference_solution,rubric_json,tests_json,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(e.chapter,e.code,e.title,e.type,e.statement,correctedStarters[e.code]??e.starter,e.solution,JSON.stringify(e.rubric),JSON.stringify(e.tests),parseFloat(e.code)).run();}}

const EXAM_TOPIC_RULES={
  "1": {
    "name": "Sortida (output)",
    "focus": "print(), literals de cadena i seqüències simples de sortida",
    "allowed": [
      "print",
      "strings"
    ],
    "limits": "No utilitzis variables, input, càlculs, condicionals, bucles, llistes ni funcions."
  },
  "2": {
    "name": "Assignació de Variables",
    "focus": "crear variables, assignar-hi dades i usar-les en print()",
    "allowed": [
      "print",
      "strings",
      "variables"
    ],
    "limits": "No utilitzis input, càlculs, condicionals, bucles, llistes ni funcions."
  },
  "3": {
    "name": "Entrada (Input)",
    "focus": "input(), variables, sortida i concatenació de text",
    "allowed": [
      "print",
      "strings",
      "variables",
      "input",
      "concatenation"
    ],
    "limits": "No utilitzis càlculs numèrics, int()/float(), condicionals, bucles, llistes ni funcions."
  },
  "4": {
    "name": "Calcular",
    "focus": "càlculs simples amb +, -, *, / i //, variables, int(input()) i conversió bàsica per mostrar resultats",
    "allowed": [
      "print",
      "strings",
      "variables",
      "input",
      "concatenation",
      "int",
      "arithmetic"
    ],
    "limits": "No utilitzis %, condicionals, bucles, llistes ni funcions."
  },
  "5": {
    "name": "Selecció IF ELSE",
    "focus": "condicions booleanes simples, comparadors, if i if/else",
    "allowed": [
      "print",
      "strings",
      "variables",
      "input",
      "concatenation",
      "int",
      "arithmetic",
      "if",
      "else",
      "comparisons"
    ],
    "limits": "No utilitzis elif, bucles, llistes, funcions ni condicions compostes sofisticades."
  },
  "6": {
    "name": "Selecció ELIF",
    "focus": "cadenes if/elif/else per gestionar tres o més resultats",
    "allowed": [
      "print",
      "strings",
      "variables",
      "input",
      "concatenation",
      "int",
      "arithmetic",
      "if",
      "elif",
      "else",
      "comparisons"
    ],
    "limits": "No utilitzis bucles, llistes ni funcions."
  },
  "7": {
    "name": "Iteracions",
    "focus": "bucles while, condicions de bucle i comptadors",
    "allowed": [
      "print",
      "strings",
      "variables",
      "input",
      "concatenation",
      "int",
      "arithmetic",
      "if",
      "elif",
      "else",
      "comparisons",
      "while",
      "counters"
    ],
    "limits": "No utilitzis for, llistes, funcions ni tècniques avançades de bucles."
  },
  "8": {
    "name": "Llistes",
    "focus": "crear i mostrar llistes, accedir i canviar elements per índex, append(), insert() i eliminar elements",
    "allowed": [
      "print",
      "strings",
      "variables",
      "input",
      "concatenation",
      "int",
      "arithmetic",
      "if",
      "elif",
      "else",
      "comparisons",
      "while",
      "counters",
      "lists",
      "indexing",
      "append",
      "insert",
      "remove",
      "len"
    ],
    "limits": "No utilitzis bucles for, funcions definides amb def, comprensions ni estructures de dades més avançades."
  },
  "9": {
    "name": "Subrutines",
    "focus": "definir i cridar funcions, paràmetres, arguments i return",
    "allowed": [
      "print",
      "strings",
      "variables",
      "input",
      "concatenation",
      "int",
      "arithmetic",
      "if",
      "elif",
      "else",
      "comparisons",
      "while",
      "counters",
      "lists",
      "indexing",
      "append",
      "insert",
      "remove",
      "len",
      "def",
      "parameters",
      "return"
    ],
    "limits": "No utilitzis for, criptografia, fitxers, classes, recursió ni tècniques no treballades."
  },
  "10": {
    "name": "Criptografia",
    "focus": "indexació i slicing de cadenes/llistes, bucles for, funcions i xifrats històrics senzills com Caesar, substitució o Vigenère",
    "allowed": [
      "print",
      "strings",
      "variables",
      "input",
      "concatenation",
      "int",
      "arithmetic",
      "if",
      "elif",
      "else",
      "comparisons",
      "while",
      "counters",
      "lists",
      "indexing",
      "append",
      "insert",
      "remove",
      "len",
      "def",
      "parameters",
      "return",
      "for",
      "slicing",
      "string_methods",
      "cryptography"
    ],
    "limits": "No utilitzis classes, recursió, comprensions, fitxers, llibreries externes ni RSA per defecte; RSA és ampliació."
  },
  "11": {
    "name": "Input Loop Adventure Game",
    "focus": "funcions amb arguments, if/elif/else, variables locals/globals i un bucle d'entrada per controlar un programa de text",
    "allowed": [
      "print",
      "strings",
      "variables",
      "input",
      "concatenation",
      "int",
      "arithmetic",
      "if",
      "elif",
      "else",
      "comparisons",
      "while",
      "counters",
      "lists",
      "indexing",
      "append",
      "insert",
      "remove",
      "len",
      "def",
      "parameters",
      "return",
      "for",
      "slicing",
      "string_methods",
      "program_flow"
    ],
    "limits": "L'exercici ha de ser curt i examinable; no exigeixis un projecte llarg, fitxers, gràfics, classes ni llibreries externes."
  },
  "12": {
    "name": "Personal Database",
    "focus": "diccionaris simples per organitzar registres, CSV bàsic o visualització elemental amb matplotlib.pyplot",
    "allowed": [
      "print",
      "strings",
      "variables",
      "input",
      "concatenation",
      "int",
      "arithmetic",
      "if",
      "elif",
      "else",
      "comparisons",
      "while",
      "counters",
      "lists",
      "indexing",
      "append",
      "insert",
      "remove",
      "len",
      "def",
      "parameters",
      "return",
      "for",
      "slicing",
      "string_methods",
      "dictionaries",
      "csv",
      "matplotlib"
    ],
    "limits": "Tria una sola habilitat central (diccionari, CSV o gràfic) i mantén l'exercici curt. No utilitzis pandas, numpy, classes, xarxa ni tècniques de ciència de dades avançades."
  }
};

function generatedExamViolations(chapter,candidate){
  const text=[candidate?.title,candidate?.statement,candidate?.starter_code].filter(Boolean).join("\n");
  const thresholds=[
    {min:3,label:"input",re:/\binput\s*\(|\bentrada\s+de\s+l['’]?usuari\b/i},
    {min:4,label:"càlculs",re:/\bint\s*\(|\bfloat\s*\(|\bcalcul(?:a|ar|i|s)\b|\bsum(?:a|ar)\b|\brest(?:a|ar)\b|\bmultiplic(?:a|ar)\b|\bdivid(?:eix|ir)\b/i},
    {min:5,label:"if/else",re:/\bif\b|\belse\b|\bcondici[oó]\b|\bcompar(?:a|ar|aci[oó])\b/i},
    {min:6,label:"elif",re:/\belif\b/i},
    {min:7,label:"while",re:/\bwhile\b|\bbucle\b|\biteraci[oó]\b/i},
    {min:8,label:"llistes",re:/\bllist(?:a|es)\b|\bappend\s*\(|\binsert\s*\(|\bremove\s*\(|\bindex(?:aci[oó]|ar|ing)?\b|\bíndex\b/i},
    {min:9,label:"funcions",re:/\bdef\s+\w+\s*\(|\breturn\b|\bfunci[oó]\b|\bsubrutina\b|\bpar[aà]metr/i},
    {min:10,label:"for/criptografia",re:/\bfor\b|\bslicing\b|\bxifrat\b|\bcriptograf|\bcaesar\b|\bvigen[eè]re\b|\brsa\b/i},
    {min:12,label:"dades/gràfics",re:/\bdiccionari\b|\bcsv\b|\bmatplotlib\b|\bpyplot\b|\bgr[aà]fic\b/i}
  ];
  const violations=[];
  for(const rule of thresholds) if(chapter<rule.min && rule.re.test(text)) violations.push(rule.label);
  const common=[
    ["classes",/\bclass\s+\w+/i],
    ["async/await",/\basync\b|\bawait\b/i],
    ["lambda",/\blambda\b/i],
    ["comprensions",/\[[^\]\n]+\bfor\b[^\]\n]+\]/i],
    ["recursió",/\brecursi[oó]\b/i],
    ["xarxa/API",/\brequests\b|\baiohttp\b|\bhttpx\b|\bsocket\b|\bAPI\b/i]
  ];
  for(const [label,re] of common) if(re.test(text)) violations.push(label);
  if(chapter<12 && /\bimport\s+\w+|\bfrom\s+\w+\s+import\b/i.test(String(candidate?.starter_code||""))) violations.push("imports");
  if(chapter===12 && /\bimport\s+(?!csv\b|matplotlib\b)|\bfrom\s+(?!matplotlib\b)/i.test(String(candidate?.starter_code||""))) violations.push("import no permès");
  return [...new Set(violations)];
}

async function generateExamQuestionAI(env,chapter,avoidText){
  const rules=EXAM_TOPIC_RULES[chapter];
  if(!rules) throw new Error("Tema no vàlid.");
  if(!env.AI) throw new Error("Workers AI no està vinculat al Worker.");
  const schema={
    type:"object",
    properties:{
      title:{type:"string"},
      statement:{type:"string"},
      starter_code:{type:"string"},
      concepts_used:{type:"array",items:{type:"string",enum:rules.allowed}}
    },
    required:["title","statement","starter_code","concepts_used"]
  };
  let lastError="";
  for(let n=0;n<2;n++){
    const prompt=`Ets un professor de Programació Python de 4t d'ESO a Catalunya.
Has de crear UNA proposta original d'exercici d'examen, escrita en català.

TEMA ${chapter}: ${rules.name}
CONCEPTES CENTRALS DEL TEMA:
${rules.focus}

CONCEPTES PERMESOS:
${rules.allowed.join(", ")}

LÍMITS OBLIGATORIS:
${rules.limits}

REGLES ESTRICTES:
- Avalua principalment els conceptes del tema seleccionat i només coneixements ja treballats abans.
- NO introdueixis cap concepte més avançat que aquest tema.
- Crea una tasca de programació de tipus construir: l'alumne ha d'escriure o completar codi.
- Ha de ser resoluble aproximadament en 10-20 minuts per un alumne de 4t d'ESO.
- L'enunciat ha de ser precís: indica entrades, comportament esperat i sortida quan sigui necessari.
- No donis la solució ni pseudocodi que resolgui la part principal.
- starter_code pot contenir comentaris, dades inicials o preparació mínima, però NO pot resoldre el concepte que s'avalua.
- Evita trucs, ambigüitats i coneixements de fora del curs.
- No demanis instal·lar paquets, accedir a Internet ni llegir documentació externa.
- L'exercici ha de ser ORIGINAL i no una simple còpia amb noms canviats dels exemples següents.
- concepts_used ha de contenir exclusivament valors de la llista CONCEPTES PERMESOS.

EXEMPLES QUE HAS D'EVITAR REPETIR O PARAFRASEJAR:
${avoidText||"(cap)"}

${lastError?`La proposta anterior s'ha rebutjat perquè introduïa: ${lastError}. Genera'n una de nova corregint-ho.`:""}

Retorna només el JSON estructurat demanat.`;
    const result=await env.AI.run(env.AI_MODEL||"@cf/meta/llama-3.3-70b-instruct-fp8-fast",{
      messages:[
        {role:"system",content:"Genera exercicis escolars estrictament limitats al temari indicat. No avancis continguts."},
        {role:"user",content:prompt}
      ],
      response_format:{type:"json_schema",json_schema:schema},
      temperature:0.75,
      max_tokens:1100
    });
    let parsed=result?.response ?? result;
    if(typeof parsed==="string") parsed=JSON.parse(parsed);
    if(!parsed||typeof parsed!=="object") throw new Error("Workers AI no ha retornat una proposta vàlida.");
    parsed.title=String(parsed.title||"").trim().slice(0,180);
    parsed.statement=String(parsed.statement||"").trim().slice(0,6000);
    parsed.starter_code=String(parsed.starter_code||"").slice(0,12000);
    parsed.concepts_used=Array.isArray(parsed.concepts_used)?parsed.concepts_used.filter(x=>rules.allowed.includes(x)):[];
    if(!parsed.title||!parsed.statement){lastError="proposta incompleta";continue}
    const violations=generatedExamViolations(chapter,parsed);
    if(!violations.length) return parsed;
    lastError=violations.join(", ");
  }
  throw new Error("La IA no ha pogut generar una proposta dins dels límits exactes del tema. Torna-ho a provar.");
}

async function aiGrade(env, exercise, code, tests){
  if(!env.AI) return {score:null,feedback:"Workers AI encara no està vinculat al Worker. Afegeix una vinculació Workers AI amb el nom AI.",teacher_feedback:"Falta el binding de Workers AI: env.AI.",criteria:[],strengths:[],errors:[],hints:[],teacher_warning:"Workers AI no configurat",configured:false};

  let rubric=[];
  try{ rubric=JSON.parse(exercise.rubric_json||'[]'); }catch{}
  const normalizedTests=Array.isArray(tests)?tests:[];
  // Separa el material proporcionat de la resposta en tasques d'investigació.
  const researchMarkers=["##### Tasca d'Investigació","##### Tasca d’Investigació"];
  const markerIndexes=researchMarkers.map(m=>code.indexOf(m)).filter(i=>i>=0);
  const researchMarkerIndex=markerIndexes.length?Math.min(...markerIndexes):-1;
  const isResearchTask=researchMarkerIndex>=0;
  const studentAnswer=isResearchTask ? code.slice(researchMarkerIndex) : code;

  const prompt=`Ets un corrector pedagògic de Programació Python de 4t d'ESO.
La teva feina és PROPOSAR una qualificació; la decisió final sempre és del professor.

REGLES:
- Avalua només els coneixements i requisits de l'exercici.
- Segueix estrictament la rúbrica i respecta el màxim de cada criteri.
- La suma dels criteris ha de coincidir amb score (0-10).
- Accepta solucions correctes diferents de la referència.
- Els tests automàtics són evidència objectiva: no afirmis que funciona allò que un test funcional demostra que falla.
- No inventis resultats d'execució.
- No penalitzis conceptes que l'exercici no demana.
- Si no pots valorar amb prou seguretat, explica-ho a teacher_warning.
- El feedback ha de ser breu, clar i adequat a 4t d'ESO.
- No revelis la solució completa ni escriguis el programa corregit.
- Les pistes han de ser accionables sense donar la resposta.
- teacher_feedback és una explicació tècnica per al professor.

EXERCICI
Codi: ${exercise.code}
Títol: ${exercise.title}
Tipus: ${exercise.type}
Enunciat: ${exercise.statement}

RÚBRICA
${JSON.stringify(rubric)}

TESTS AUTOMÀTICS
${JSON.stringify(normalizedTests)}

SOLUCIÓ DE REFERÈNCIA (només orientativa; no la copiïs)
${exercise.reference_solution||''}

CODI / RESPOSTA DE L'ALUMNE
${studentAnswer}

NOTA SOBRE TASQUES D'INVESTIGACIÓ
${isResearchTask ? "Aquesta és una tasca d'investigació. Avalua exclusivament el contingut a partir del marcador '##### Tasca d'Investigació'. Tot el contingut anterior al marcador és material proporcionat a l'alumne: no l'atribueixis a l'alumne ni li concedeixis punts per aquest contingut." : "No s'ha detectat el marcador de tasca d'investigació."}`;

  const schema={type:"object",properties:{
    score:{type:"number",minimum:0,maximum:10},
    criteria:{type:"array",items:{type:"object",properties:{name:{type:"string"},score:{type:"number",minimum:0},max:{type:"number",minimum:0},reason:{type:"string"}},required:["name","score","max","reason"]}},
    strengths:{type:"array",items:{type:"string"}},
    errors:{type:"array",items:{type:"string"}},
    feedback:{type:"string"},
    hints:{type:"array",items:{type:"string"}},
    teacher_feedback:{type:"string"},
    teacher_warning:{type:["string","null"]}
  },required:["score","criteria","strengths","errors","feedback","hints","teacher_feedback","teacher_warning"]};

  try{
    const result=await env.AI.run(env.AI_MODEL||"@cf/meta/llama-3.3-70b-instruct-fp8-fast",{
      messages:[
        {role:"system",content:"Respon com a corrector rigorós i pedagògic. Retorna només l'estructura JSON demanada."},
        {role:"user",content:prompt}
      ],
      response_format:{type:"json_schema",json_schema:schema},
      temperature:0.2,
      max_tokens:1800
    });
    let parsed=result?.response ?? result;
    if(typeof parsed==="string") parsed=JSON.parse(parsed);
    if(!parsed || typeof parsed!=="object") throw new Error("Workers AI no ha retornat un objecte de correcció.");
    parsed.score=Math.max(0,Math.min(10,Number(parsed.score)||0));
    if(!Array.isArray(parsed.criteria)) parsed.criteria=[];
    return {...parsed,configured:true,provider:"cloudflare-workers-ai"};
  }catch(err){
    return {score:null,feedback:"La correcció amb Workers AI no s'ha pogut completar.",teacher_feedback:String(err?.message||err).slice(0,700),criteria:[],strengths:[],errors:[],hints:[],teacher_warning:"Error de Workers AI. Revisa el binding AI o el límit d'ús.",configured:true,provider:"cloudflare-workers-ai"};
  }
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
 const teacherSubmissionAction=path.match(/^\/api\/teacher\/submissions\/(\d+)\/?$/);
 if(teacherSubmissionAction && (req.method==='POST'||req.method==='DELETE')){
  if(!user)return json({error:'Cal iniciar sessió.'},401);
  if(user.role!=='teacher')return json({error:'Accés restringit al professor.'},403);
  const id=Number(teacherSubmissionAction[1]);
  const existing=await env.DB.prepare('SELECT id,final_score FROM submissions WHERE id=?').bind(id).first();
  if(!existing)return json({error:'Entrega no trobada.'},404);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS submission_feedback(
    submission_id INTEGER PRIMARY KEY,
    teacher_comment TEXT NOT NULL DEFAULT '',
    returned_score REAL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  if(req.method==='DELETE'){
   await env.DB.prepare('DELETE FROM submission_feedback WHERE submission_id=?').bind(id).run();
   await env.DB.prepare('DELETE FROM submissions WHERE id=?').bind(id).run();
   return json({ok:true,deleted:id});
  }
  let b;try{b=await req.json()}catch{return json({error:'Petició no vàlida.'},400)}
  const comment=String(b.comment||'').trim().slice(0,4000);
  if(b.action==='return'){
   const proposed=Number(b.score);
   const kept=Number.isFinite(proposed)&&proposed>=0&&proposed<=10?proposed:(existing.final_score??null);
   await env.DB.prepare(`INSERT INTO submission_feedback(submission_id,teacher_comment,returned_score,updated_at)
     VALUES(?,?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(submission_id) DO UPDATE SET
       teacher_comment=excluded.teacher_comment,
       returned_score=excluded.returned_score,
       updated_at=CURRENT_TIMESTAMP`).bind(id,comment,kept).run();
   await env.DB.prepare("UPDATE submissions SET status='returned',final_score=NULL,validated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
   return json({ok:true,status:'returned'});
  }
  const score=Number(b.score);
  if(!Number.isFinite(score)||score<0||score>10)return json({error:'La nota ha de ser entre 0 i 10.'},400);
  await env.DB.prepare(`INSERT INTO submission_feedback(submission_id,teacher_comment,returned_score,updated_at)
    VALUES(?,?,NULL,CURRENT_TIMESTAMP)
    ON CONFLICT(submission_id) DO UPDATE SET
      teacher_comment=excluded.teacher_comment,
      returned_score=NULL,
      updated_at=CURRENT_TIMESTAMP`).bind(id,comment).run();
  await env.DB.prepare("UPDATE submissions SET final_score=?,status='validated',validated_at=CURRENT_TIMESTAMP WHERE id=?").bind(score,id).run();
  return json({ok:true,status:'validated'});
 }
 if(path==='/api/logout'){const t=cookie(req);if(t)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(t)).run();return new Response('',{status:204,headers:{'Set-Cookie':'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'}})}
 if(/^\/api\/teacher\/students\/\d+\/password-reset$/.test(path) && req.method==='POST' && user?.role==='teacher'){
  const id=Number(path.split('/')[4]);
  const student=await env.DB.prepare(`SELECT id,name,email,role FROM users WHERE id=?`).bind(id).first();
  if(!student || student.role!=='student') return json({error:'Alumne no trobat.'},404);
  await ensurePasswordResetTable(env);
  await env.DB.prepare(`UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE user_id=? AND used_at IS NULL`).bind(id).run();
  const code=newPasswordResetCode(),normalized=normalizeResetCode(code),tokenHash=await sha256(normalized),expiresAt=new Date(Date.now()+15*60*1000).toISOString();
  await env.DB.prepare(`INSERT INTO password_reset_tokens(user_id,token_hash,expires_at,created_by) VALUES(?,?,?,?)`).bind(id,tokenHash,expiresAt,user.id).run();
  return json({ok:true,code,name:student.name,expires_minutes:15});
 }
 if(path==='/api/password-reset/validate-code' && req.method==='POST'){
  let b;try{b=await req.json()}catch{return json({error:'Petició no vàlida.'},400)}
  const code=normalizeResetCode(b.code);
  if(code.length!==10) return json({valid:false,error:'El codi de recuperació no és vàlid.'},400);
  await ensurePasswordResetTable(env);
  const tokenHash=await sha256(code),now=new Date().toISOString();
  const row=await env.DB.prepare(`SELECT p.id,u.name FROM password_reset_tokens p JOIN users u ON u.id=p.user_id WHERE p.token_hash=? AND p.used_at IS NULL AND p.expires_at>? LIMIT 1`).bind(tokenHash,now).first();
  return row?json({valid:true,name:row.name}):json({valid:false,error:'Aquest codi ha caducat, ja s’ha utilitzat o no és correcte.'},400);
 }
 if(path==='/api/password-reset/complete-code' && req.method==='POST'){
  let b;try{b=await req.json()}catch{return json({error:'Petició no vàlida.'},400)}
  const code=normalizeResetCode(b.code),password=String(b.password||'');
  if(code.length!==10) return json({error:'El codi de recuperació no és vàlid.'},400);
  if(password.length<6) return json({error:'La contrasenya ha de tenir com a mínim 6 caràcters.'},400);
  if(password.length>200) return json({error:'La contrasenya és massa llarga.'},400);
  await ensurePasswordResetTable(env);
  const tokenHash=await sha256(code),now=new Date().toISOString();
  const row=await env.DB.prepare(`SELECT id,user_id FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>? LIMIT 1`).bind(tokenHash,now).first();
  if(!row?.user_id) return json({error:'Aquest codi ha caducat, ja s’ha utilitzat o no és correcte.'},400);
  const h=await passwordHash(password);
  const claimed=await env.DB.prepare(`UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL RETURNING user_id`).bind(row.id).first();
  if(!claimed?.user_id) return json({error:'Aquest codi ja s’ha utilitzat.'},409);
  await env.DB.batch([
   env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(h,claimed.user_id),
   env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(claimed.user_id),
   env.DB.prepare(`UPDATE password_reset_tokens SET used_at=COALESCE(used_at,CURRENT_TIMESTAMP) WHERE user_id=? AND used_at IS NULL`).bind(claimed.user_id)
  ]);
  return json({ok:true});
 }
 // Durant un examen en curs, l'alumne només pot utilitzar les API pròpies de l'examen.
 if(user?.role==='student' && !path.startsWith('/api/exams/') && !path.startsWith('/api/exam-attempts/')){
  await ensureExamTables(env);
  const active=await env.DB.prepare(`SELECT a.*,e.title exam_title,e.status exam_status,e.start_at,e.end_at,e.duration_minutes
    FROM exam_attempts a JOIN exams e ON e.id=a.exam_id
    WHERE a.user_id=? AND a.status='in_progress'
    ORDER BY a.started_at DESC LIMIT 1`).bind(user.id).first();
  if(active){
   const checked=await autoSubmitExpiredExam(env,{
    id:active.exam_id,title:active.exam_title,status:active.exam_status,start_at:active.start_at,
    end_at:active.end_at,duration_minutes:active.duration_minutes
   },active);
   if(checked.status==='in_progress') return json({
    error:`Tens un examen en curs: ${active.exam_title}. Torna a l'entorn de l'examen abans de continuar.`,
    code:'EXAM_IN_PROGRESS',
    active_exam_id:active.exam_id
   },423);
  }
 }
 // EXÀMENS — professor: gestió
 if(path==='/api/teacher/exams' && req.method==='GET' && user?.role==='teacher'){
  await ensureExamTables(env);
  await syncExpiredExamAttempts(env);
  const rows=await env.DB.prepare(`SELECT e.*,
    (SELECT COUNT(*) FROM exam_questions q WHERE q.exam_id=e.id) question_count,
    (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id=e.id) attempt_count,
    (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id=e.id AND a.status='submitted') submitted_count,
    (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id=e.id AND a.status='graded') graded_count
    FROM exams e ORDER BY e.created_at DESC,e.id DESC`).all();
  return json({exams:(rows.results||[]).map(e=>({...e,effective_state:examState(e)}))});
 }
 if(path==='/api/teacher/exams' && req.method==='POST' && user?.role==='teacher'){
  await ensureExamTables(env);
  let b;try{b=await req.json()}catch{return json({error:'Petició no vàlida.'},400)}
  const title=String(b.title||'').trim().slice(0,160),description=String(b.description||'').trim().slice(0,6000);
  if(!title)return json({error:'El títol de l’examen és obligatori.'},400);
  const duration=Number(b.duration_minutes);
  const durationMinutes=Number.isFinite(duration)&&duration>0?Math.min(480,Math.round(duration)):null;
  const startAt=b.start_at||null,endAt=b.end_at||null;
  if(startAt&&endAt&&Date.parse(endAt)<=Date.parse(startAt))
   return json({error:'La data de final ha de ser posterior a la d’inici.'},400);
  const row=await env.DB.prepare(`INSERT INTO exams(title,description,status,start_at,end_at,duration_minutes,created_by) VALUES(?,?,?,?,?,?,?) RETURNING *`)
    .bind(title,description,'draft',startAt,endAt,durationMinutes,user.id).first();
  return json({exam:row},201);
 }
 if(/^\/api\/teacher\/exams\/\d+$/.test(path) && req.method==='GET' && user?.role==='teacher'){
  await ensureExamTables(env);
  const id=Number(path.split('/').pop());
  const exam=await env.DB.prepare('SELECT * FROM exams WHERE id=?').bind(id).first();
  if(!exam)return json({error:'Examen no trobat.'},404);
  const q=await env.DB.prepare('SELECT * FROM exam_questions WHERE exam_id=? ORDER BY position,id').bind(id).all();
  const ac=await env.DB.prepare('SELECT COUNT(*) total FROM exam_attempts WHERE exam_id=?').bind(id).first();
  return json({exam:{...exam,effective_state:examState(exam),attempt_count:Number(ac?.total||0)},questions:q.results||[]});
 }
 if(/^\/api\/teacher\/exams\/\d+$/.test(path) && req.method==='PUT' && user?.role==='teacher'){
  await ensureExamTables(env);
  const id=Number(path.split('/').pop());
  const exam=await env.DB.prepare('SELECT * FROM exams WHERE id=?').bind(id).first();
  if(!exam)return json({error:'Examen no trobat.'},404);
  let b;try{b=await req.json()}catch{return json({error:'Petició no vàlida.'},400)}
  const title=String(b.title??exam.title).trim().slice(0,160),description=String(b.description??exam.description).trim().slice(0,6000);
  if(!title)return json({error:'El títol és obligatori.'},400);
  const startAt=b.start_at===''?null:(b.start_at??exam.start_at),endAt=b.end_at===''?null:(b.end_at??exam.end_at);
  if(startAt&&endAt&&Date.parse(endAt)<=Date.parse(startAt))return json({error:'La data de final ha de ser posterior a la d’inici.'},400);
  const rawDuration=b.duration_minutes===undefined?exam.duration_minutes:b.duration_minutes;
  const nDuration=Number(rawDuration);
  const duration=rawDuration==null||rawDuration===''?null:(Number.isFinite(nDuration)&&nDuration>0?Math.min(480,Math.round(nDuration)):null);
  await env.DB.prepare(`UPDATE exams SET title=?,description=?,start_at=?,end_at=?,duration_minutes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(title,description,startAt,endAt,duration,id).run();
  const updated=await env.DB.prepare('SELECT * FROM exams WHERE id=?').bind(id).first();
  return json({exam:{...updated,effective_state:examState(updated)}});
 }
 if(/^\/api\/teacher\/exams\/\d+$/.test(path) && req.method==='DELETE' && user?.role==='teacher'){
  await ensureExamTables(env);
  const id=Number(path.split('/').pop());
  if(await examHasAttempts(env,id))return json({error:'No es pot eliminar un examen que ja té intents d’alumnes.'},409);
  await env.DB.prepare('DELETE FROM exam_questions WHERE exam_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM exams WHERE id=?').bind(id).run();
  return json({ok:true});
 }
 if(/^\/api\/teacher\/exams\/\d+\/status$/.test(path) && req.method==='POST' && user?.role==='teacher'){
  await ensureExamTables(env);
  const id=Number(path.split('/')[4]);
  const exam=await env.DB.prepare('SELECT * FROM exams WHERE id=?').bind(id).first();
  if(!exam)return json({error:'Examen no trobat.'},404);
  let b;try{b=await req.json()}catch{return json({error:'Petició no vàlida.'},400)}
  const status=String(b.status||'');
  if(!['draft','scheduled','open','closed'].includes(status))return json({error:'Estat no vàlid.'},400);
  const qc=await env.DB.prepare('SELECT COUNT(*) total FROM exam_questions WHERE exam_id=?').bind(id).first();
  if((status==='scheduled'||status==='open')&&!Number(qc?.total||0))return json({error:'Afegeix almenys un exercici abans d’obrir o programar l’examen.'},400);
  if(status==='scheduled'&&!exam.start_at)return json({error:'Per programar l’examen has d’indicar una data i hora d’inici.'},400);
  if((status==='scheduled'||status==='open')&&exam.end_at&&Date.parse(exam.end_at)<=Date.now())
   return json({error:'No pots obrir o programar un examen amb una data final que ja ha passat.'},400);
  if(status==='draft'&&await examHasAttempts(env,id))return json({error:'No es pot tornar a esborrany un examen que ja té intents.'},409);
  await env.DB.prepare('UPDATE exams SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(status,id).run();
  if(status==='closed'){
   const closedAt=new Date().toISOString();
   await env.DB.prepare(`UPDATE exam_attempts
     SET status='submitted',submitted_at=COALESCE(submitted_at,?)
     WHERE exam_id=? AND status='in_progress'`).bind(closedAt,id).run();
  }
  const updated=await env.DB.prepare('SELECT * FROM exams WHERE id=?').bind(id).first();
  return json({exam:{...updated,effective_state:examState(updated)}});
 }
 // EXÀMENS — professor: exercicis i correcció
 if(/^\/api\/teacher\/exams\/\d+\/generate-question$/.test(path) && req.method==='POST' && user?.role==='teacher'){
  await ensureExamTables(env);
  const examId=Number(path.split('/')[4]);
  const exam=await env.DB.prepare('SELECT id,title FROM exams WHERE id=?').bind(examId).first();
  if(!exam)return json({error:'Examen no trobat.'},404);
  if(await examHasAttempts(env,examId))return json({error:'No es poden generar exercicis quan l’examen ja té intents.'},409);
  let b;try{b=await req.json()}catch{return json({error:'Petició no vàlida.'},400)}
  const chapter=Number(b.chapter);
  const rules=EXAM_TOPIC_RULES[chapter];
  if(!rules)return json({error:'Selecciona un tema vàlid del curs.'},400);
  if(!env.AI)return json({error:'Workers AI no està disponible. Revisa el binding AI.'},503);

  const base=await env.DB.prepare('SELECT code,title,statement FROM exercises WHERE chapter=? ORDER BY sort_order LIMIT 12').bind(chapter).all();
  const current=await env.DB.prepare('SELECT title,statement FROM exam_questions WHERE exam_id=? ORDER BY position,id LIMIT 20').bind(examId).all();
  const avoid=[
   ...(base.results||[]).map(x=>`${x.code||''} · ${x.title}: ${x.statement}`),
   ...(current.results||[]).map(x=>`Ja és en aquest examen · ${x.title}: ${x.statement}`)
  ].join('\n').slice(0,9000);

  try{
   const proposal=await generateExamQuestionAI(env,chapter,avoid);
   return json({
    proposal:{...proposal,max_score:10},
    topic:{chapter,name:rules.name,focus:rules.focus}
   });
  }catch(err){
   return json({error:String(err?.message||err).slice(0,700)},502);
  }
 }
 if(/^\/api\/teacher\/exams\/\d+\/questions$/.test(path) && req.method==='POST' && user?.role==='teacher'){
  await ensureExamTables(env);
  const examId=Number(path.split('/')[4]);
  const exam=await env.DB.prepare('SELECT id FROM exams WHERE id=?').bind(examId).first();
  if(!exam)return json({error:'Examen no trobat.'},404);
  if(await examHasAttempts(env,examId))return json({error:'No es poden modificar els exercicis quan l’examen ja té intents.'},409);
  let b;try{b=await req.json()}catch{return json({error:'Petició no vàlida.'},400)}
  const title=String(b.title||'').trim().slice(0,180),statement=String(b.statement||'').trim().slice(0,12000),starter=String(b.starter_code||'').slice(0,30000);
  if(!title||!statement)return json({error:'El títol i l’enunciat són obligatoris.'},400);
  const mx=Number(b.max_score),maxScore=Number.isFinite(mx)&&mx>0?Math.min(100,mx):10;
  const posRaw=Number(b.position);let position=Number.isFinite(posRaw)&&posRaw>0?Math.round(posRaw):null;
  if(!position){const p=await env.DB.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM exam_questions WHERE exam_id=?').bind(examId).first();position=Number(p?.p||1)}
  const q=await env.DB.prepare(`INSERT INTO exam_questions(exam_id,position,title,statement,starter_code,max_score) VALUES(?,?,?,?,?,?) RETURNING *`)
    .bind(examId,position,title,statement,starter,maxScore).first();
  return json({question:q},201);
 }
 if(/^\/api\/teacher\/exam-questions\/\d+$/.test(path) && req.method==='PUT' && user?.role==='teacher'){
  await ensureExamTables(env);
  const qid=Number(path.split('/').pop());
  const q=await env.DB.prepare('SELECT * FROM exam_questions WHERE id=?').bind(qid).first();
  if(!q)return json({error:'Exercici d’examen no trobat.'},404);
  if(await examHasAttempts(env,q.exam_id))return json({error:'No es poden modificar els exercicis quan l’examen ja té intents.'},409);
  let b;try{b=await req.json()}catch{return json({error:'Petició no vàlida.'},400)}
  const title=String(b.title??q.title).trim().slice(0,180),statement=String(b.statement??q.statement).trim().slice(0,12000),starter=String(b.starter_code??q.starter_code).slice(0,30000);
  const mx=Number(b.max_score??q.max_score),maxScore=Number.isFinite(mx)&&mx>0?Math.min(100,mx):Number(q.max_score||10);
  const pp=Number(b.position??q.position),position=Number.isFinite(pp)&&pp>0?Math.round(pp):q.position;
  if(!title||!statement)return json({error:'El títol i l’enunciat són obligatoris.'},400);
  await env.DB.prepare(`UPDATE exam_questions SET position=?,title=?,statement=?,starter_code=?,max_score=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(position,title,statement,starter,maxScore,qid).run();
  return json({ok:true});
 }
 if(/^\/api\/teacher\/exam-questions\/\d+$/.test(path) && req.method==='DELETE' && user?.role==='teacher'){
  await ensureExamTables(env);
  const qid=Number(path.split('/').pop());
  const q=await env.DB.prepare('SELECT * FROM exam_questions WHERE id=?').bind(qid).first();
  if(!q)return json({error:'Exercici d’examen no trobat.'},404);
  if(await examHasAttempts(env,q.exam_id))return json({error:'No es poden modificar els exercicis quan l’examen ja té intents.'},409);
  await env.DB.prepare('DELETE FROM exam_questions WHERE id=?').bind(qid).run();
  return json({ok:true});
 }
 if(/^\/api\/teacher\/exams\/\d+\/results$/.test(path) && req.method==='GET' && user?.role==='teacher'){
  await ensureExamTables(env);
  const id=Number(path.split('/')[4]);
  const exam=await env.DB.prepare('SELECT * FROM exams WHERE id=?').bind(id).first();
  if(!exam)return json({error:'Examen no trobat.'},404);
  await syncExpiredExamAttempts(env,id);
  if(examState(exam)==='closed'){
   const closedAt=new Date().toISOString();
   await env.DB.prepare(`UPDATE exam_attempts
     SET status='submitted',submitted_at=COALESCE(submitted_at,?)
     WHERE exam_id=? AND status='in_progress'`).bind(closedAt,id).run();
  }
  const q=await env.DB.prepare('SELECT id,position,title,max_score FROM exam_questions WHERE exam_id=? ORDER BY position,id').bind(id).all();
  const attempts=await env.DB.prepare(`SELECT a.*,u.name,u.email,
    (SELECT COUNT(*) FROM exam_events ev WHERE ev.attempt_id=a.id AND ev.event_type='copy_paste') copy_paste_count,
    (SELECT COUNT(*) FROM exam_events ev WHERE ev.attempt_id=a.id AND ev.event_type='tab_hidden') tab_hidden_count,
    (SELECT COUNT(*) FROM exam_events ev WHERE ev.attempt_id=a.id AND ev.event_type='fullscreen_exit') fullscreen_exit_count,
    (SELECT COUNT(*) FROM exam_events ev WHERE ev.attempt_id=a.id AND ev.event_type='drop_multiline') drop_multiline_count,
    (SELECT COUNT(*) FROM exam_events ev WHERE ev.attempt_id=a.id AND ev.event_type='network_attempt') network_attempt_count,
    (SELECT COUNT(*) FROM exam_events ev WHERE ev.attempt_id=a.id AND ev.event_type='large_insert') large_insert_count,
    (SELECT COUNT(*) FROM exam_events ev WHERE ev.attempt_id=a.id AND ev.event_type='statement_copy') statement_copy_count
    FROM exam_attempts a JOIN users u ON u.id=a.user_id WHERE a.exam_id=? ORDER BY u.name COLLATE NOCASE`).bind(id).all();
  return json({exam:{...exam,effective_state:examState(exam)},questions:q.results||[],attempts:attempts.results||[]});
 }
 if(/^\/api\/teacher\/exam-attempts\/\d+$/.test(path) && req.method==='GET' && user?.role==='teacher'){
  await ensureExamTables(env);
  const id=Number(path.split('/').pop());
  let attempt=await env.DB.prepare(`SELECT a.*,u.name,u.email,e.title exam_title,e.description,e.duration_minutes,e.start_at,e.end_at,e.status exam_status
    FROM exam_attempts a JOIN users u ON u.id=a.user_id JOIN exams e ON e.id=a.exam_id WHERE a.id=?`).bind(id).first();
  if(!attempt)return json({error:'Intent d’examen no trobat.'},404);
  if(attempt.status==='in_progress'){
   const checked=await autoSubmitExpiredExam(env,{
    id:attempt.exam_id,title:attempt.exam_title,status:attempt.exam_status,start_at:attempt.start_at,end_at:attempt.end_at,duration_minutes:attempt.duration_minutes
   },attempt);
   attempt={...attempt,...checked};
  }
  const questions=await env.DB.prepare('SELECT * FROM exam_questions WHERE exam_id=? ORDER BY position,id').bind(attempt.exam_id).all();
  const answers=await env.DB.prepare('SELECT * FROM exam_answers WHERE attempt_id=?').bind(id).all();
  const events=await env.DB.prepare('SELECT * FROM exam_events WHERE attempt_id=? ORDER BY created_at,id').bind(id).all();
  return json({attempt,questions:questions.results||[],answers:answers.results||[],events:events.results||[]});
 }
 if(/^\/api\/teacher\/exam-attempts\/\d+\/grade$/.test(path) && req.method==='POST' && user?.role==='teacher'){
  await ensureExamTables(env);
  const id=Number(path.split('/')[4]);
  let attempt=await env.DB.prepare('SELECT * FROM exam_attempts WHERE id=?').bind(id).first();
  if(!attempt)return json({error:'Intent d’examen no trobat.'},404);
  if(attempt.status==='in_progress'){
   const exam=await env.DB.prepare('SELECT * FROM exams WHERE id=?').bind(attempt.exam_id).first();
   attempt=await autoSubmitExpiredExam(env,exam,attempt);
  }
  if(attempt.status==='in_progress')return json({error:'No es pot corregir un examen que encara està en curs.'},409);
  let b;try{b=await req.json()}catch{return json({error:'Petició no vàlida.'},400)}
  const questions=await env.DB.prepare('SELECT id,max_score FROM exam_questions WHERE exam_id=?').bind(attempt.exam_id).all();
  const scores=Array.isArray(b.scores)?b.scores:[];
  const byQuestion=new Map(scores.map(x=>[Number(x.question_id),x]));
  let total=0,maxTotal=0;
  for(const q of questions.results||[]){
   const qid=Number(q.id),max=Number(q.max_score||0),entry=byQuestion.get(qid);
   maxTotal+=max;
   if(!entry || entry.score===null || entry.score===undefined || String(entry.score).trim()==='')
    return json({error:'Has de posar una nota a tots els exercicis abans de desar la correcció.'},400);
   const n=Number(entry.score);
   if(!Number.isFinite(n)||n<0||n>max)
    return json({error:`La nota de l'exercici ${qid} ha d'estar entre 0 i ${max}.`},400);
   total+=n;
   const feedback=String(entry.feedback||'').slice(0,4000);
   await env.DB.prepare(`INSERT INTO exam_answers(attempt_id,question_id,code,stdin,score,feedback) VALUES(?,?, '', '',?,?)
     ON CONFLICT(attempt_id,question_id) DO UPDATE SET score=excluded.score,feedback=excluded.feedback`).bind(id,qid,n,feedback).run();
  }
  const finalScore=maxTotal>0?Math.round((total/maxTotal)*1000)/100:null;
  const comment=String(b.teacher_comment||'').slice(0,5000);
  await env.DB.prepare(`UPDATE exam_attempts SET status='graded',final_score=?,teacher_comment=?,graded_at=CURRENT_TIMESTAMP WHERE id=?`).bind(finalScore,comment,id).run();
  return json({ok:true,total,max_total:maxTotal,final_score:finalScore});
 }
 // EXÀMENS — alumne
 if(path==='/api/exams/available' && req.method==='GET' && user?.role==='student'){
  await ensureExamTables(env);
  const er=await env.DB.prepare(`SELECT e.*,(SELECT COUNT(*) FROM exam_questions q WHERE q.exam_id=e.id) question_count
    FROM exams e WHERE e.status<>'draft' ORDER BY COALESCE(e.start_at,e.created_at),e.id`).all();
  const ar=await env.DB.prepare('SELECT * FROM exam_attempts WHERE user_id=?').bind(user.id).all();
  const attempts=new Map((ar.results||[]).map(a=>[Number(a.exam_id),a]));
  const out=[];
  for(const e of er.results||[]){
   let attempt=attempts.get(Number(e.id))||null;
   if(attempt) attempt=await autoSubmitExpiredExam(env,e,attempt);
   const state=examState(e);
   const visible=state==='active'||state==='upcoming'||!!attempt;
   if(!visible)continue;
   out.push({...e,effective_state:state,attempt:attempt?{
    id:attempt.id,status:attempt.status,started_at:attempt.started_at,
    submitted_at:attempt.submitted_at,graded_at:attempt.graded_at,final_score:attempt.final_score
   }:null});
  }
  return json({exams:out});
 }
 if(/^\/api\/exams\/\d+\/start$/.test(path) && req.method==='POST' && user?.role==='student'){
  await ensureExamTables(env);
  const examId=Number(path.split('/')[3]);
  const exam=await env.DB.prepare('SELECT * FROM exams WHERE id=?').bind(examId).first();
  if(!exam)return json({error:'Examen no trobat.'},404);
  if(examState(exam)!=='active')return json({error:'Aquest examen no està obert ara mateix.'},409);
  let attempt=await env.DB.prepare('SELECT * FROM exam_attempts WHERE exam_id=? AND user_id=?').bind(examId,user.id).first();
  if(!attempt){
   const other=await env.DB.prepare(`SELECT a.*,e.title exam_title FROM exam_attempts a
     JOIN exams e ON e.id=a.exam_id
     WHERE a.user_id=? AND a.status='in_progress' AND a.exam_id<>?
     ORDER BY a.started_at DESC LIMIT 1`).bind(user.id,examId).first();
   if(other){
    const otherExam=await env.DB.prepare('SELECT * FROM exams WHERE id=?').bind(other.exam_id).first();
    const checked=await autoSubmitExpiredExam(env,otherExam,other);
    if(checked.status==='in_progress') return json({
      error:`Ja tens un examen en curs: ${other.exam_title}. Acaba'l o lliura'l abans de començar-ne un altre.`,
      active_exam_id:other.exam_id
    },409);
   }
   const started=new Date().toISOString();
   attempt=await env.DB.prepare(`INSERT INTO exam_attempts(exam_id,user_id,status,started_at)
     VALUES(?,?, 'in_progress',?) RETURNING *`).bind(examId,user.id,started).first();
  }else{
   attempt=await autoSubmitExpiredExam(env,exam,attempt);
   if(attempt.status!=='in_progress')return json({error:'Aquest examen ja està lliurat i no es pot tornar a començar.'},409);
  }
  const questions=await env.DB.prepare('SELECT id,starter_code FROM exam_questions WHERE exam_id=?').bind(examId).all();
  for(const q of questions.results||[]){
   await env.DB.prepare(`INSERT OR IGNORE INTO exam_answers(attempt_id,question_id,code,stdin) VALUES(?,?,?, '')`)
    .bind(attempt.id,q.id,q.starter_code||'').run();
  }
  const qc=await env.DB.prepare('SELECT COUNT(*) total FROM exam_questions WHERE exam_id=?').bind(examId).first();
  return json({attempt,deadline:examAttemptDeadline(exam,attempt),question_count:Number(qc?.total||0),server_now:new Date().toISOString()});
 }
 if(/^\/api\/exams\/\d+\/attempt$/.test(path) && req.method==='GET' && user?.role==='student'){
  await ensureExamTables(env);
  const examId=Number(path.split('/')[3]);
  const exam=await env.DB.prepare('SELECT * FROM exams WHERE id=?').bind(examId).first();
  if(!exam)return json({error:'Examen no trobat.'},404);
  let attempt=await env.DB.prepare('SELECT * FROM exam_attempts WHERE exam_id=? AND user_id=?').bind(examId,user.id).first();
  if(!attempt)return json({error:'Encara no has començat aquest examen.'},404);
  attempt=await autoSubmitExpiredExam(env,exam,attempt);
  const qr=await env.DB.prepare('SELECT id,position,title,statement,starter_code,max_score FROM exam_questions WHERE exam_id=? ORDER BY position,id').bind(examId).all();
  const ans=await env.DB.prepare('SELECT question_id,code,stdin,updated_at,score,feedback FROM exam_answers WHERE attempt_id=?').bind(attempt.id).all();
  return json({
   exam:{...exam,effective_state:examState(exam)},
   attempt,
   deadline:examAttemptDeadline(exam,attempt),
   server_now:new Date().toISOString(),
   questions:qr.results||[],
   answers:ans.results||[]
  });
 }
 if(/^\/api\/exam-attempts\/\d+\/status$/.test(path) && req.method==='GET' && user?.role==='student'){
  await ensureExamTables(env);
  const attemptId=Number(path.split('/')[3]);
  let attempt=await env.DB.prepare('SELECT * FROM exam_attempts WHERE id=? AND user_id=?').bind(attemptId,user.id).first();
  if(!attempt)return json({error:'Intent no trobat.'},404);
  const exam=await env.DB.prepare('SELECT * FROM exams WHERE id=?').bind(attempt.exam_id).first();
  attempt=await autoSubmitExpiredExam(env,exam,attempt);
  return json({
   status:attempt.status,
   submitted_at:attempt.submitted_at||null,
   deadline:examAttemptDeadline(exam,attempt),
   server_now:new Date().toISOString()
  });
 }
 if(/^\/api\/exam-attempts\/\d+\/answers\/\d+$/.test(path) && req.method==='PUT' && user?.role==='student'){
  await ensureExamTables(env);
  const parts=path.split('/'),attemptId=Number(parts[3]),questionId=Number(parts[5]);
  const attempt=await env.DB.prepare('SELECT * FROM exam_attempts WHERE id=? AND user_id=?').bind(attemptId,user.id).first();
  if(!attempt)return json({error:'Intent no trobat.'},404);
  const exam=await env.DB.prepare('SELECT * FROM exams WHERE id=?').bind(attempt.exam_id).first();
  const currentAttempt=await autoSubmitExpiredExam(env,exam,attempt);
  if(currentAttempt.status!=='in_progress')return json({error:'Aquest examen ja no es pot modificar.'},409);
  const q=await env.DB.prepare('SELECT id FROM exam_questions WHERE id=? AND exam_id=?').bind(questionId,attempt.exam_id).first();
  if(!q)return json({error:'Exercici no trobat.'},404);
  let b;try{b=await req.json()}catch{return json({error:'Petició no vàlida.'},400)}
  const code=String(b.code||'').slice(0,30000),stdin=String(b.stdin||'').slice(0,5000);
  await env.DB.prepare(`INSERT INTO exam_answers(attempt_id,question_id,code,stdin,updated_at)
    VALUES(?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(attempt_id,question_id) DO UPDATE SET
      code=excluded.code,stdin=excluded.stdin,updated_at=CURRENT_TIMESTAMP`)
    .bind(attemptId,questionId,code,stdin).run();
  return json({ok:true,updated_at:new Date().toISOString()});
 }
 if(/^\/api\/exam-attempts\/\d+\/events$/.test(path) && req.method==='POST' && user?.role==='student'){
  await ensureExamTables(env);
  const attemptId=Number(path.split('/')[3]);
  const attempt=await env.DB.prepare('SELECT * FROM exam_attempts WHERE id=? AND user_id=?').bind(attemptId,user.id).first();
  if(!attempt)return json({error:'Intent no trobat.'},404);
  if(attempt.status!=='in_progress')return json({ok:true,ignored:true});
  let b;try{b=await req.json()}catch{return json({error:'Petició no vàlida.'},400)}
  const type=String(b.event_type||'');
  if(!['copy_paste','tab_hidden','fullscreen_exit','drop_multiline','network_attempt','large_insert','statement_copy'].includes(type))
   return json({error:'Tipus d’alerta no vàlid.'},400);
  const count=await env.DB.prepare('SELECT COUNT(*) total FROM exam_events WHERE attempt_id=?').bind(attemptId).first();
  if(Number(count?.total||0)>=500)return json({ok:true,ignored:true});
  const qid=b.question_id==null?null:Number(b.question_id);
  const meta=JSON.stringify(b.meta&&typeof b.meta==='object'?b.meta:{}).slice(0,2000);
  await env.DB.prepare('INSERT INTO exam_events(attempt_id,question_id,event_type,meta_json) VALUES(?,?,?,?)')
    .bind(attemptId,qid,type,meta).run();
  return json({ok:true});
 }
 if(/^\/api\/exam-attempts\/\d+\/submit$/.test(path) && req.method==='POST' && user?.role==='student'){
  await ensureExamTables(env);
  const attemptId=Number(path.split('/')[3]);
  const attempt=await env.DB.prepare('SELECT * FROM exam_attempts WHERE id=? AND user_id=?').bind(attemptId,user.id).first();
  if(!attempt)return json({error:'Intent no trobat.'},404);
  const exam=await env.DB.prepare('SELECT * FROM exams WHERE id=?').bind(attempt.exam_id).first();
  const checked=await autoSubmitExpiredExam(env,exam,attempt);
  if(checked.status!=='in_progress')return json({error:'Aquest examen ja està lliurat.'},409);
  const at=new Date().toISOString();
  await env.DB.prepare(`UPDATE exam_attempts SET status='submitted',submitted_at=? WHERE id=? AND status='in_progress'`).bind(at,attemptId).run();
  return json({ok:true,submitted_at:at});
 }
 if(path==='/api/exercises'){const rows=await env.DB.prepare('SELECT id,chapter,code,title,type,statement,starter_code,rubric_json FROM exercises ORDER BY chapter,sort_order').all(); return json({exercises:rows.results.map(e=>({...e,starter_code:starterForExercise(e)}))})}
 if(/^\/api\/exercises\/\d+\/draft$/.test(path) && req.method==='GET'){
  if(!user)return json({error:'Cal iniciar sessió.'},401);
  if(user.role==='teacher')return json({draft:null});
  const id=Number(path.split('/')[3]);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS drafts(
    user_id INTEGER NOT NULL,
    exercise_id INTEGER NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id,exercise_id)
  )`).run();
  const draft=await env.DB.prepare('SELECT code,updated_at FROM drafts WHERE user_id=? AND exercise_id=?').bind(user.id,id).first();
  return json({draft:draft||null});
 }
 if(/^\/api\/exercises\/\d+\/draft$/.test(path) && req.method==='PUT'){
  if(!user)return json({error:'Cal iniciar sessió.'},401);
  if(user.role==='teacher')return json({error:'La vista del professor no desa esborranys.'},403);
  const id=Number(path.split('/')[3]);
  const e=await env.DB.prepare('SELECT id FROM exercises WHERE id=?').bind(id).first();
  if(!e)return json({error:'Exercici no trobat.'},404);
  const b=await req.json();
  const code=String(b.code||'').slice(0,30000);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS drafts(
    user_id INTEGER NOT NULL,
    exercise_id INTEGER NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id,exercise_id)
  )`).run();
  await env.DB.prepare(`INSERT INTO drafts(user_id,exercise_id,code,updated_at)
    VALUES(?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id,exercise_id) DO UPDATE SET code=excluded.code,updated_at=CURRENT_TIMESTAMP`)
    .bind(user.id,id,code).run();
  const saved=await env.DB.prepare('SELECT updated_at FROM drafts WHERE user_id=? AND exercise_id=?').bind(user.id,id).first();
  return json({ok:true,updated_at:saved?.updated_at||null});
 }
 if(path==='/api/my-drafts' && user){
  if(user.role==='teacher')return json({drafts:[]});
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS drafts(
    user_id INTEGER NOT NULL,
    exercise_id INTEGER NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id,exercise_id)
  )`).run();
  const rows=await env.DB.prepare('SELECT exercise_id,updated_at FROM drafts WHERE user_id=? ORDER BY updated_at DESC').bind(user.id).all();
  return json({drafts:rows.results});
 }
 if(path.startsWith('/api/exercises/') && req.method==='GET'){const id=path.split('/').pop(); const e=await env.DB.prepare('SELECT id,chapter,code,title,type,statement,starter_code,rubric_json,tests_json FROM exercises WHERE id=?').bind(id).first(); if(e?.code==='6.4') e.starter_code=`# The user has to enter a number between 0 and 23\nprint("Enter the hour in 24 hour clock (0 to 23)")\nhour = int(input())\n\n# Completa el programa amb una cadena if/elif/else segons l'enunciat.`; if(e?.code==='7.4') e.starter_code=`pwd1 = "abc123"
print("Enter your username")
uName = input()
print("Enter your password")
pwd2 = input()

# A partir d'aquí, completa el programa:
# - repeteix la petició de contrasenya fins que sigui correcta
# - compta quants intents ha necessitat l'usuari
# - mostra el nom d'usuari i el nombre d'intents al missatge final`; if(e)e.starter_code=starterForExercise(e); return e?json(e):json({error:'No trobat'},404)}
 if(path.startsWith('/api/exercises/') && path.endsWith('/submissions') && req.method==='POST'){
 if(!user)return json({error:'Cal iniciar sessió.'},401);
 const id=path.split('/')[3];
 const e=await env.DB.prepare('SELECT * FROM exercises WHERE id=?').bind(id).first();
 if(!e)return json({error:'Exercici no trobat'},404);
 const latest=await env.DB.prepare('SELECT id,status FROM submissions WHERE user_id=? AND exercise_id=? ORDER BY id DESC LIMIT 1').bind(user.id,e.id).first();
 if(latest && latest.status!=='returned')return json({error:"Aquest exercici ja està enviat. Només el podràs tornar a enviar si el professor te'l retorna.",code:'ALREADY_SUBMITTED'},409);
 const b=await req.json();const code=String(b.code||'').slice(0,30000);
 const ai=await aiGrade(env,e,code,b.tests||[]);
 const result=await env.DB.prepare('INSERT INTO submissions(user_id,exercise_id,code,test_results_json,ai_result_json,status) VALUES(?,?,?,?,?,?) RETURNING id,submitted_at').bind(user.id,e.id,code,JSON.stringify(b.tests||[]),JSON.stringify(ai),'pending').first();
 try{await env.DB.prepare('DELETE FROM drafts WHERE user_id=? AND exercise_id=?').bind(user.id,e.id).run();}catch{}
 return json({submission:result,ai})
}
 if(path==='/api/my-submissions' && user){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS submission_feedback(submission_id INTEGER PRIMARY KEY,teacher_comment TEXT NOT NULL DEFAULT '',returned_score REAL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
 const rows=await env.DB.prepare(`SELECT s.*,e.code AS exercise_code,e.title,COALESCE(f.teacher_comment,'') teacher_comment,f.returned_score FROM submissions s JOIN exercises e ON e.id=s.exercise_id LEFT JOIN submission_feedback f ON f.submission_id=s.id WHERE s.user_id=? ORDER BY s.id DESC`).bind(user.id).all();
 return json({submissions:rows.results})
}
 if(/^\/api\/teacher\/students\/\d+$/.test(path) && req.method==='PUT' && user?.role==='teacher'){
  const id=Number(path.split('/').pop());
  const student=await env.DB.prepare(`SELECT id,name,email,role FROM users WHERE id=?`).bind(id).first();
  if(!student || student.role!=='student') return json({error:'Alumne no trobat.'},404);
  const b=await req.json();
  const name=String(b.name||'').trim().slice(0,120);
  const email=String(b.email||'').trim().toLowerCase().slice(0,254);
  if(!name) return json({error:'El nom no pot estar buit.'},400);
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({error:'El correu no és vàlid.'},400);
  const duplicate=await env.DB.prepare(`SELECT id FROM users WHERE email=? AND id<>?`).bind(email,id).first();
  if(duplicate) return json({error:'Aquest correu ja està registrat per un altre usuari.'},409);
  await env.DB.prepare(`UPDATE users SET name=?,email=? WHERE id=? AND role='student'`).bind(name,email,id).run();
  return json({ok:true,student:{id,name,email}});
 }
 if(/^\/api\/teacher\/students\/\d+$/.test(path) && req.method==='DELETE' && user?.role==='teacher'){
  const id=Number(path.split('/').pop());
  const student=await env.DB.prepare(`SELECT id,name,email,role FROM users WHERE id=?`).bind(id).first();
  if(!student || student.role!=='student') return json({error:'Alumne no trobat.'},404);
  try{await env.DB.prepare('DELETE FROM drafts WHERE user_id=?').bind(id).run();}catch{}
  try{await env.DB.prepare('DELETE FROM submission_feedback WHERE submission_id IN (SELECT id FROM submissions WHERE user_id=?)').bind(id).run();}catch{} await env.DB.prepare('DELETE FROM submissions WHERE user_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();
  await env.DB.prepare(`DELETE FROM users WHERE id=? AND role='student'`).bind(id).run();
  return json({ok:true,deleted:id});
 }
 if(/^\/api\/teacher\/students\/\d+\/progress$/.test(path) && req.method==='GET' && user?.role==='teacher'){
 const id=Number(path.split('/')[4]);
 const student=await env.DB.prepare(`SELECT id,name,email FROM users WHERE id=? AND role='student'`).bind(id).first();
 if(!student)return json({error:'Alumne no trobat.'},404);
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS submission_feedback(submission_id INTEGER PRIMARY KEY,teacher_comment TEXT NOT NULL DEFAULT '',returned_score REAL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
 const exs=(await env.DB.prepare(`SELECT id,chapter,code,title,sort_order FROM exercises ORDER BY chapter,sort_order,id`).all()).results;
 const subs=(await env.DB.prepare(`SELECT s.id,s.exercise_id,s.status,s.final_score,s.submitted_at,s.validated_at,s.ai_result_json,COALESCE(f.teacher_comment,'') teacher_comment,f.returned_score FROM submissions s LEFT JOIN submission_feedback f ON f.submission_id=s.id WHERE s.user_id=? ORDER BY s.exercise_id,s.id`).bind(id).all()).results;
 const drafts=(await env.DB.prepare(`SELECT exercise_id,updated_at FROM drafts WHERE user_id=?`).bind(id).all()).results;
 return json({student,exercises:exs,submissions:subs,drafts});
 }
 if(path==='/api/teacher/progress' && user?.role==='teacher'){
  try{
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS drafts(
      user_id INTEGER NOT NULL,
      exercise_id INTEGER NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id,exercise_id)
    )`).run();
    const students=(await env.DB.prepare(`SELECT id,name,email FROM users WHERE role='student' ORDER BY name COLLATE NOCASE,email`).all()).results;
    const exs=(await env.DB.prepare(`SELECT id,chapter,code,title,sort_order FROM exercises ORDER BY chapter,sort_order,id`).all()).results;
    const subs=(await env.DB.prepare(`SELECT s.id,s.user_id,s.exercise_id,s.status,s.final_score,s.submitted_at,s.validated_at,s.ai_result_json
      FROM submissions s
      JOIN (
        SELECT user_id,exercise_id,MAX(id) AS max_id
        FROM submissions GROUP BY user_id,exercise_id
      ) latest ON latest.max_id=s.id
      ORDER BY s.id DESC`).all()).results;
    const drafts=(await env.DB.prepare(`SELECT user_id,exercise_id,updated_at FROM drafts`).all()).results;
    return json({students,exercises:exs,submissions:subs,drafts});
  }catch(e){return json({error:'No s’ha pogut carregar el seguiment.',detail:String(e?.message||e)},500)}
 }
 if(path==='/api/teacher/submissions' && user?.role==='teacher'){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS submission_feedback(submission_id INTEGER PRIMARY KEY,teacher_comment TEXT NOT NULL DEFAULT '',returned_score REAL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
 const rows=await env.DB.prepare(`SELECT s.id,s.user_id,s.exercise_id,s.code AS student_code,s.test_results_json,s.ai_result_json,s.status,s.final_score,s.submitted_at,s.validated_at,u.name,e.code AS exercise_code,e.title,e.statement,e.rubric_json,COALESCE(f.teacher_comment,'') teacher_comment,f.returned_score FROM submissions s JOIN users u ON u.id=s.user_id JOIN exercises e ON e.id=s.exercise_id LEFT JOIN submission_feedback f ON f.submission_id=s.id ORDER BY s.submitted_at DESC`).all();
 return json({submissions:rows.results})
}
 if(path.startsWith('/api/teacher/submissions/') && req.method==='DELETE' && user?.role==='teacher'){
  const id=Number(path.split('/').pop());
  if(!Number.isInteger(id)||id<1) return json({error:'Identificador d’entrega no vàlid.'},400);
  const existing=await env.DB.prepare('SELECT id FROM submissions WHERE id=?').bind(id).first();
  if(!existing) return json({error:'Entrega no trobada.'},404);
  try{await env.DB.prepare('DELETE FROM submission_feedback WHERE submission_id=?').bind(id).run();}catch{} await env.DB.prepare('DELETE FROM submissions WHERE id=?').bind(id).run();
  return json({ok:true,deleted:id});
 }
 if(path.startsWith('/api/teacher/submissions/') && req.method==='POST' && user?.role==='teacher'){
  const id=path.split('/').pop(); const b=await req.json();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS submission_feedback(submission_id INTEGER PRIMARY KEY,teacher_comment TEXT NOT NULL DEFAULT '',returned_score REAL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  const comment=String(b.comment||'').trim().slice(0,4000);
  if(b.action==='return'){
    const row=await env.DB.prepare('SELECT id,final_score FROM submissions WHERE id=?').bind(id).first();
    if(!row)return json({error:'Entrega no trobada.'},404);
    const proposed=Number(b.score), kept=Number.isFinite(proposed)&&proposed>=0&&proposed<=10?proposed:(row.final_score??null);
    await env.DB.prepare(`INSERT INTO submission_feedback(submission_id,teacher_comment,returned_score,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(submission_id) DO UPDATE SET teacher_comment=excluded.teacher_comment,returned_score=excluded.returned_score,updated_at=CURRENT_TIMESTAMP`).bind(id,comment,kept).run();
    await env.DB.prepare("UPDATE submissions SET status='returned',final_score=NULL,validated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
    return json({ok:true,status:'returned'});
  }
  const score=Number(b.score);
  if(!Number.isFinite(score)||score<0||score>10)return json({error:'La nota ha de ser entre 0 i 10.'},400);
  await env.DB.prepare(`INSERT INTO submission_feedback(submission_id,teacher_comment,returned_score,updated_at) VALUES(?,?,NULL,CURRENT_TIMESTAMP) ON CONFLICT(submission_id) DO UPDATE SET teacher_comment=excluded.teacher_comment,returned_score=NULL,updated_at=CURRENT_TIMESTAMP`).bind(id,comment).run();
  await env.DB.prepare('UPDATE submissions SET final_score=?,status=?,validated_at=CURRENT_TIMESTAMP WHERE id=?').bind(score,'validated',id).run();
  return json({ok:true});
}
 return json({error:'No trobat'},404);
}

export default {
 async fetch(req,env,ctx){
  try{
   if(new URL(req.url).pathname.startsWith('/api/')) return await api(req,env);
   if(env.ASSETS) return env.ASSETS.fetch(req);
   return text('Programació 4ESO');
  }catch(err){
   console.error('UNHANDLED_ERROR',err);
   if(new URL(req.url).pathname.startsWith('/api/')) return json({error:'Error intern del servidor.',detail:String(err?.message||err||'Error desconegut').slice(0,300)},500);
   return text('Error intern del servidor.',500);
  }
 }
};
