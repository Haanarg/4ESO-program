let user=null, exercises=[], current=null, py=null, studentPreview=false;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(path,opt={}){
  const r=await fetch(path,{...opt,headers:{'content-type':'application/json',...(opt.headers||{})}});
  const raw=await r.text();
  let d={};
  if(raw){
    try{ d=JSON.parse(raw); }
    catch{ throw Error(`El servidor ha retornat una resposta inesperada (${r.status}).`); }
  }
  if(!r.ok) throw Error(d.detail ? `${d.error||'Error'} — ${d.detail}` : (d.error||`Error ${r.status}`));
  return d;
}

function nav(){
  $('#nav').innerHTML=user
    ? `Hola, ${esc(user.name)}${user.role==='teacher'?' · Professor':''}${studentPreview?' · Vista d\'alumne':''} · ${studentPreview?'<button class=\"secondary\" onclick=\"exitStudentPreview()\">← Panell professor</button> · ':''}<button onclick=\"logout()\">Sortir</button>`
    : '';
}

async function start(){
  try{ user=(await api('/api/me')).user; }catch{}
  nav();
  if(!user) return login();
  if(user.role==='teacher') return teacherDashboard();
  return dashboard();
}

function login(){
  $('#app').innerHTML=`<div class="card auth"><h1>Programació 4ESO</h1><h2>Inicia sessió</h2><input id="email" type="email" placeholder="Correu electrònic"><input id="pw" type="password" placeholder="Contrasenya"><button onclick="doLogin()">Entrar</button> <button class="secondary" onclick="register()">Crear compte</button><p id="msg"></p></div>`;
}

function register(){
  $('#app').innerHTML=`<div class="card auth"><h1>Crear compte</h1><input id="name" placeholder="Nom"><input id="email" type="email" placeholder="Correu electrònic"><input id="pw" type="password" placeholder="Contrasenya (mínim 6 caràcters)"><button onclick="doRegister()">Registrar-me</button> <button class="secondary" onclick="login()">Ja tinc compte</button><p id="msg"></p></div>`;
}

async function doLogin(){
  try{
    const d=await api('/api/login',{method:'POST',body:JSON.stringify({email:$('#email').value,password:$('#pw').value})});
    user=d.user; nav(); user.role==='teacher'?teacherDashboard():dashboard();
  }catch(e){ $('#msg').textContent=e.message; $('#msg').className='error'; }
}

async function doRegister(){
  try{
    const d=await api('/api/register',{method:'POST',body:JSON.stringify({name:$('#name').value,email:$('#email').value,password:$('#pw').value})});
    user=d.user; nav(); dashboard();
  }catch(e){ $('#msg').textContent=e.message; $('#msg').className='error'; }
}

async function logout(){
  try{ await api('/api/logout'); }catch{}
  user=null; studentPreview=false; nav(); login();
}

function enterStudentPreview(){
  if(!user || user.role!=='teacher') return;
  studentPreview=true;
  nav();
  dashboard();
}

function exitStudentPreview(){
  studentPreview=false;
  nav();
  teacherDashboard();
}

async function dashboard(){
  const d=await api('/api/exercises'); exercises=d.exercises;
  const chapterNames={1:'Sortida (output)',2:'Assignació de Variables',3:'Entrada (Input)',4:'Calcular',5:'Selecció IF ELSE',6:'Selecció ELIF',7:'Iteracions',8:'Llistes',9:'Subrutines',10:'Criptografia',11:'Input Loop Adventure Game',12:'Personal Database'};
  $('#app').innerHTML=`${studentPreview?'<div class=\"preview-banner\"><strong>👁 Vista d\'alumne</strong><span>Estàs previsualitzant el curs. Pots executar exercicis, però no entregar-los.</span><button class=\"secondary\" onclick=\"exitStudentPreview()\">← Tornar al panell del professor</button></div>':''}<h1>Programació 4ESO</h1><p>Recorregut de Python: dels primers print() fins als projectes de criptografia, aventura de text i dades.</p><div id="list"></div>`;
  const last={};
  try{
    const s=await api('/api/my-submissions');
    for(const x of s.submissions) if(!last[x.exercise_id]) last[x.exercise_id]=x;
  }catch{}
  for(const chapter of Object.keys(chapterNames).map(Number)){
    const chapterExercises=exercises.filter(e=>e.chapter===chapter);
    if(!chapterExercises.length) continue;
    $('#list').insertAdjacentHTML('beforeend',`<h2 class="chapter-title">Capítol ${chapter}: ${esc(chapterNames[chapter])}</h2>`);
    chapterExercises.forEach(e=>{
      const sub=last[e.id];
      const status=sub?.status==='returned'
        ? ''
        : sub?.final_score!=null
          ? `<span class="status ok">Nota validada: ${esc(sub.final_score)}/10</span>`
          : sub?.ai_result_json ? `<span class="status pending">Proposta IA pendent de validació</span>` : '';
      $('#list').insertAdjacentHTML('beforeend',`<div class="card exercise" onclick="openExercise(${e.id})"><span class="pill">${esc(e.type)}</span><h3>${esc(e.code)} · ${esc(e.title)}</h3><p>${esc(e.statement.slice(0,220))}${e.statement.length>220?'…':''}</p>${status}</div>`);
    });
  }
}
async function openExercise(id){
  current=await api(`/api/exercises/${id}`);
  let rubric=[]; try{rubric=JSON.parse(current.rubric_json||'[]')}catch{}
  $('#app').innerHTML=`${studentPreview?'<div class=\"preview-banner compact\"><strong>👁 Vista d\'alumne</strong><button class=\"secondary\" onclick=\"exitStudentPreview()\">← Panell professor</button></div>':''}<div class="grid"><section class="card"><span class="pill">${esc(current.type)}</span><h1>${esc(current.code)} · ${esc(current.title)}</h1><p class="statement">${esc(current.statement)}</p><h3>Criteris</h3><ul>${rubric.map(x=>`<li>${esc(x[0])}: ${esc(x[1])} punts</li>`).join('')}</ul><button class="secondary" onclick="dashboard()">← Tornar</button></section><section class="card"><h2>Editor Python</h2><textarea id="code" spellcheck="false">${esc(current.starter_code)}</textarea><label class="input-label" for="stdin"><strong>Entrades de prova</strong> — una resposta per línia per als <code>input()</code></label><textarea id="stdin" class="stdin" spellcheck="false" placeholder="Exemple:\nGaspar\n42\nsí"></textarea><button onclick="runCode()">▶ Executar</button> <button onclick="submitCode()" ${studentPreview?'disabled title=\"Desactivat en la vista d’alumne del professor\"':''}>✓ Entregar</button>${studentPreview?'<p class=\"preview-note\">L’entrega està desactivada en mode de previsualització.</p>':''}<h3>Sortida</h3><div id="output" class="output"></div><div id="grade"></div></section></div>`;
}
async function loadPy(){
  if(py) return py;
  $('#output').textContent='Carregant Python…';
  py=await loadPyodide();
  return py;
}

function inputValues(){ return ($('#stdin')?.value||'').split(/\r?\n/); }

function pythonWrapper(code, inputs){
  return `import io, contextlib, builtins\n__out=io.StringIO()\n__values=iter(${JSON.stringify(inputs)})\n__old_input=builtins.input\ndef __fake_input(prompt=''):\n print(prompt,end='')\n try: return next(__values)\n except StopIteration: raise EOFError('Falten entrades de prova: afegeix una resposta per línia')\nbuiltins.input=__fake_input\ntry:\n with contextlib.redirect_stdout(__out):\n  exec(${JSON.stringify(code)}, {})\n __err=''\nexcept Exception as e:\n __err=repr(e)\nfinally:\n builtins.input=__old_input\n(__out.getvalue(), __err)`;
}

async function runCode(){
  try{
    const p=await loadPy(); const code=$('#code').value;
    if(/matplotlib/.test(code)) { $('#output').textContent='Carregant matplotlib…'; await p.loadPackage('matplotlib'); }
    const out=await p.runPythonAsync(pythonWrapper(code,inputValues()));
    $('#output').textContent=out[0]+(out[1]?`\n${out[1]}`:'');
  }catch(e){ $('#output').textContent=e.message; }
}

async function executeForTest(p,code,inputs=[]){
  if(/matplotlib/.test(code)) await p.loadPackage('matplotlib');
  const out=await p.runPythonAsync(pythonWrapper(code,inputs));
  if(out[1]) throw Error(out[1]);
  return String(out[0]);
}

async function localTests(code){
  const p=await loadPy(); let tests=[];
  try{ tests=JSON.parse(current.tests_json||'[]'); }catch{}
  const results=[];
  for(const t of tests){
    let passed=false,detail='';
    try{
      if(t.kind==='has') passed=code.includes(t.pattern);
      else if(t.kind==='count_has') passed=(code.split(t.pattern).length-1)>=(t.min||1);
      else if(t.kind==='comment') passed=code.includes(t.pattern||'#');
      else if(t.kind==='hasvar') passed=new RegExp(`\\b${t.name}\\s*=`).test(code);
      else if(t.kind==='has_assignment') passed=/(^|\n)\s*[A-Za-z_]\w*\s*=/.test(code);
      else if(t.kind==='syntax') { await p.runPythonAsync(`compile(${JSON.stringify(code)}, '<alumne>', 'exec')`); passed=true; }
      else if(t.kind==='stdout_contains'){
        const r=await executeForTest(p,code,t.inputs||[]); passed=r.includes(t.expected); detail=r;
      } else if(t.kind==='stdout_equals'){
        const r=await executeForTest(p,code,t.inputs||[]); passed=r.trim()===String(t.expected).trim(); detail=r;
      } else if(t.kind==='stdout_lines'){
        const r=await executeForTest(p,code,t.inputs||[]); passed=r.trim()?r.trim().split('\n').length>=t.minLines:false; detail=r;
      } else if(t.kind==='stdout'){
        const r=await executeForTest(p,code,t.inputs||[]); passed=r.trim().length>0; detail=r;
      }
    }catch(e){ detail=e.message; }
    results.push({...t,passed,detail});
  }
  return results;
}
async function submitCode(){
  if(studentPreview){
    $('#grade').innerHTML='<p class="preview-note">Aquesta és una vista prèvia del professor. Les entregues estan desactivades.</p>';
    return;
  }
  try{
    const code=$('#code').value; const tests=await localTests(code);
    $('#output').textContent=tests.map((t,i)=>`${t.passed?'✓':'✗'} Test ${i+1}${t.detail?' — '+String(t.detail).trim():''}`).join('\n')||'Sense tests automàtics configurats';
    const d=await api(`/api/exercises/${current.id}/submissions`,{method:'POST',body:JSON.stringify({code,tests})});
    const ai=d.ai||{};
    const criteria=Array.isArray(ai.criteria)?ai.criteria:[];
    const strengths=Array.isArray(ai.strengths)?ai.strengths:[];
    const errors=Array.isArray(ai.errors)?ai.errors:[];
    const hints=Array.isArray(ai.hints)?ai.hints:[];
    $('#grade').innerHTML=`<div class="card grade"><div class="ai-grade-head"><div><span class="pill">Correcció IA</span><h2>Proposta de correcció</h2></div><div class="score">${ai.score==null?'—':esc(Number(ai.score).toFixed(1))}/10</div></div>
      ${criteria.length?`<div class="criteria-grid">${criteria.map(c=>`<div class="criterion"><div><strong>${esc(c.name)}</strong><span>${esc(c.score)} / ${esc(c.max)}</span></div><p>${esc(c.reason||'')}</p></div>`).join('')}</div>`:''}
      <div class="student-feedback"><h3>Feedback</h3><p>${esc(ai.feedback||'Sense feedback')}</p></div>
      ${strengths.length?`<h3>✓ Punts forts</h3><ul>${strengths.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}
      ${errors.length?`<h3>Aspectes a revisar</h3><ul>${errors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}
      ${hints.length?`<h3>💡 Pistes per millorar</h3><ul>${hints.map(h=>`<li>${esc(h)}</li>`).join('')}</ul>`:''}
      <div class="provisional-note">La correcció de la IA és orientativa. La nota final la valida el professor.</div></div>`;
  }catch(e){ $('#grade').innerHTML=`<p class="error">${esc(e.message)}</p>`; }
}

async function teacherDashboard(){
  try{
    const d=await api('/api/teacher/submissions');
    $('#app').innerHTML=`<div class="teacher-head"><div><h1>Panell del professor</h1><p>Revisa les entregues i valida la nota final.</p></div><div class="teacher-actions"><button class="secondary" onclick="enterStudentPreview()">👁 Veure com a alumne</button><button class="secondary" onclick="teacherDashboard()">↻ Actualitzar</button></div></div><div id="teacher-list"></div>`;
    if(!d.submissions.length){ $('#teacher-list').innerHTML='<div class="card"><p>Encara no hi ha entregues.</p></div>'; return; }
    for(const s of d.submissions){
      let ai={}; try{ai=JSON.parse(s.ai_result_json||'{}')}catch{}
      const validated=s.status==='validated';
      const returned=s.status==='returned';
      const stateLabel=returned?'↩ Retornada':validated?'✓ Validada':'Pendent';
      $('#teacher-list').insertAdjacentHTML('beforeend',`<article class="card submission ${returned?'returned-submission':''}"><div class="submission-head"><div><span class="pill">${esc(s.exercise_code)}</span> <span class="status ${returned?'returned':validated?'ok':'pending'}">${stateLabel}</span><h3>${esc(s.name)} · ${esc(s.title)}</h3><small>${esc(s.submitted_at)}</small></div><div class="score small">${returned?'—':s.final_score!=null?esc(s.final_score):ai.score!=null?esc(Number(ai.score).toFixed(1)):'—'}/10</div></div><details><summary>Veure codi i correcció</summary><h4>Codi entregat</h4><pre>${esc(s.student_code)}</pre><h4>Feedback per a l'alumne</h4><p>${esc(ai.feedback||'Sense proposta IA')}</p>${Array.isArray(ai.criteria)&&ai.criteria.length?`<h4>Rúbrica proposada</h4><div class="teacher-criteria">${ai.criteria.map(c=>`<p><strong>${esc(c.name)}: ${esc(c.score)}/${esc(c.max)}</strong> — ${esc(c.reason||'')}</p>`).join('')}</div>`:''}${ai.teacher_feedback?`<h4>Informe per al professor</h4><p>${esc(ai.teacher_feedback)}</p>`:''}${ai.teacher_warning?`<div class="ai-warning"><strong>⚠ Revisió recomanada:</strong> ${esc(ai.teacher_warning)}</div>`:''}</details><div class="validate"><input id="score-${s.id}" type="number" min="0" max="10" step="0.1" value="${esc(s.final_score!=null?s.final_score:(ai.score??''))}" ${validated||returned?'disabled':''}><button onclick="validateSubmission(${s.id})" ${validated||returned?'disabled':''}>${validated?'✓ Validada':returned?'Retornada':'Validar nota'}</button>${returned?'':`<button class="return-btn" onclick="returnSubmission(${s.id})">↩ Retorn</button>`}</div></article>`);
    }
  }catch(e){ $('#app').innerHTML=`<div class="card"><h1>Panell del professor</h1><p class="error">${esc(e.message)}</p></div>`; }
}

async function validateSubmission(id){
  const input=$(`#score-${id}`); const score=Number(input.value);
  if(!Number.isFinite(score)||score<0||score>10){ alert('La nota ha de ser entre 0 i 10.'); return; }
  try{ await api(`/api/teacher/submissions/${id}`,{method:'POST',body:JSON.stringify({score})}); await teacherDashboard(); }
  catch(e){ alert(e.message); }
}


async function returnSubmission(id){
  const ok=confirm("Vols retornar aquesta entrega?\n\nL'intent es conservarà a l'historial i l'exercici tornarà a aparèixer com a no fet perquè l'alumne el pugui repetir.");
  if(!ok) return;
  try{
    await api(`/api/teacher/submissions/${id}`,{method:'POST',body:JSON.stringify({action:'return'})});
    await teacherDashboard();
  }catch(e){ alert(e.message); }
}

start();
