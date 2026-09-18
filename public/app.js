let user=null, exercises=[], current=null, py=null, studentPreview=false, codeEditor=null, draftTimer=null, draftSaving=false;
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



function editStudent(student){
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="student-modal card">
    <div class="modal-title"><div><h2>Editar alumne</h2><p class="muted">Modifica el nom o el correu del compte.</p></div><button class="modal-close" aria-label="Tancar">×</button></div>
    <label>Nom<input id="edit-student-name" type="text" maxlength="120" value="${esc(student.name)}"></label>
    <label>Correu electrònic<input id="edit-student-email" type="email" maxlength="254" value="${esc(student.email)}"></label>
    <div id="edit-student-error" class="form-error"></div>
    <div class="modal-actions"><button class="secondary modal-cancel">Cancel·la</button><button id="save-student-btn">✓ Desa els canvis</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('.modal-cancel').onclick=close;
  overlay.onclick=e=>{if(e.target===overlay)close()};
  overlay.querySelector('#edit-student-name').focus();
  overlay.querySelector('#save-student-btn').onclick=async()=>{
    const name=overlay.querySelector('#edit-student-name').value.trim();
    const email=overlay.querySelector('#edit-student-email').value.trim();
    const err=overlay.querySelector('#edit-student-error');
    const btn=overlay.querySelector('#save-student-btn');
    err.textContent='';
    if(!name){err.textContent='Escriu el nom de l’alumne.';return}
    if(!email){err.textContent='Escriu el correu de l’alumne.';return}
    btn.disabled=true;btn.textContent='Desant…';
    try{
      await api(`/api/teacher/students/${student.id}`,{method:'PUT',body:JSON.stringify({name,email})});
      close();await teacherProgress();
    }catch(e){err.textContent=e.message;btn.disabled=false;btn.textContent='✓ Desa els canvis'}
  };
}

async function deleteStudent(id,name){
  const ok=confirm(`Vols eliminar definitivament l'alumne "${name}"?\n\nS'eliminaran també totes les seves entregues, notes, esborranys i sessions. Aquesta acció no es pot desfer.`);
  if(!ok)return;
  const second=confirm(`Confirmació final:\n\nEliminar "${name}" i tot el seu historial de Programació 4ESO?`);
  if(!second)return;
  try{
    await api(`/api/teacher/students/${id}`,{method:'DELETE'});
    await teacherProgress();
  }catch(e){alert(`No s'ha pogut eliminar l'alumne: ${e.message}`)}
}

function filterProgressChapter(){const v=$('#progress-chapter')?.value||'all';document.querySelectorAll('.progress-table [data-chapter]').forEach(x=>x.style.display=(v==='all'||x.dataset.chapter===v)?'':'none')}
async function teacherStudentDetail(id){
 const d=await api(`/api/teacher/students/${id}/progress`),{student,exercises:exs,submissions:subs,drafts}=d,byEx={};for(const s of subs)(byEx[s.exercise_id]??=[]).push(s);
 const val=subs.filter(s=>s.status==='validated'&&s.final_score!=null),avg=val.length?(val.reduce((x,s)=>x+Number(s.final_score),0)/val.length).toFixed(1):'—',chs=[...new Set(exs.map(e=>e.chapter))];
 $('#app').innerHTML=`<section class="card student-detail"><div class="progress-toolbar"><div><h1>${esc(student.name)}</h1><p class="muted">${esc(student.email)}</p></div><button class="secondary" onclick="teacherProgress()">← Seguiment</button></div><div class="student-kpis"><div><strong>${val.length}/${exs.length}</strong><span>Tasques validades</span></div><div><strong>${avg}${avg!=='—'?'/10':''}</strong><span>Mitjana validada</span></div><div><strong>${drafts.length}</strong><span>Esborranys</span></div></div><div class="chapter-summary">${chs.map(ch=>{const ce=exs.filter(e=>e.chapter===ch),n=ce.filter(e=>(byEx[e.id]||[]).some(s=>s.status==='validated'&&s.final_score!=null)).length;return `<div><strong>Capítol ${ch}</strong><span>${n}/${ce.length}</span><div class="mini-progress"><i style="width:${ce.length?Math.round(n*100/ce.length):0}%"></i></div></div>`}).join('')}</div><h2>Historial d'entregues</h2>${exs.map(e=>{const arr=byEx[e.id]||[];return arr.length?`<div class="student-exercise-history"><h3>${esc(e.code)} · ${esc(e.title)}</h3>${arr.map((s,i)=>{const n=s.final_score??s.returned_score;return `<div class="history-line"><span>Intent ${i+1}</span><span>${esc(s.submitted_at)}</span><strong>${n!=null?esc(n)+'/10':'—'}</strong><span>${s.status==='validated'?'Validat':s.status==='returned'?'Retornat':'Pendent'}</span>${s.teacher_comment?`<p>💬 ${esc(s.teacher_comment)}</p>`:''}</div>`}).join('')}</div>`:''}).join('')||'<p>Encara no hi ha entregues.</p>'}</section>`;
}
async function teacherProgress(){
  const d=await api('/api/teacher/progress');
  const students=d.students||[], exs=d.exercises||[], subs=d.submissions||[], drafts=d.drafts||[];
  const subMap=new Map(subs.map(s=>[`${s.user_id}:${s.exercise_id}`,s]));
  const draftMap=new Map(drafts.map(x=>[`${x.user_id}:${x.exercise_id}`,x]));
  const cell=(student,e)=>{
    const s=subMap.get(`${student.id}:${e.id}`);
    const dr=draftMap.get(`${student.id}:${e.id}`);
    if(s?.status==='validated' && s.final_score!=null){
      const n=Number(s.final_score);
      return `<span class="progress-grade ${n>=5?'pass':'fail'}" title="Nota validada">${esc(s.final_score)}</span>`;
    }
    if(s?.status==='pending') return `<span class="progress-state pending" title="Entregada, pendent de validació">Pendent</span>`;
    if(s?.status==='returned') return dr
      ? `<span class="progress-state draft" title="Retornada i amb un nou esborrany">Esborrany</span>`
      : `<span class="progress-state returned" title="Retornada perquè l'alumne la repeteixi">Retorn</span>`;
    if(dr) return `<span class="progress-state draft" title="L'alumne té un esborrany desat">Esborrany</span>`;
    return `<span class="progress-empty" title="Sense entrega">—</span>`;
  };
  const completedFor=student=>exs.filter(e=>{
    const s=subMap.get(`${student.id}:${e.id}`);
    return s?.status==='validated' && s.final_score!=null;
  }).length;
  $('#app').innerHTML=`
    <section class="card progress-card">
      <div class="progress-toolbar">
        <div><h1>Seguiment dels alumnes</h1><p class="muted">Darrera situació de cada tasca. Clica un alumne per veure'n la fitxa completa.</p></div>
        <button class="secondary" onclick="teacherDashboard()">← Panell professor</button>
      </div>
      <div class="progress-legend">
        <span><b class="legend-swatch pass"></b> Aprovada</span>
        <span><b class="legend-swatch fail"></b> Suspesa</span>
        <span>Pendent = entregada per validar</span>
        <span>Esborrany = encara no entregada</span>
        <span>— = no iniciada</span>
      </div>
      <div class="progress-filters"><label>Capítol <select id="progress-chapter" onchange="filterProgressChapter()"><option value="all">Tots</option>${[...new Set(exs.map(e=>e.chapter))].map(c=>`<option value="${c}">${c}</option>`).join('')}</select></label></div><div class="progress-table-wrap">
        <table class="progress-table">
          <thead><tr>
            <th class="student-col">Alumne</th>
            <th class="summary-col">Fetes</th>
            ${exs.map(e=>`<th data-chapter="${e.chapter}" title="${esc(e.title)}"><span>${esc(e.code)}</span><small>${esc(e.title)}</small></th>`).join('')}
          </tr></thead>
          <tbody>
            ${students.map(st=>`<tr>
              <th class="student-col"><div class="student-identity"><div class="student-open" onclick="teacherStudentDetail(${st.id})"><strong>${esc(st.name)}</strong><small>${esc(st.email)}</small></div><div class="student-row-actions"><button class="mini-btn" title="Editar alumne" onclick='editStudent(${JSON.stringify(st)})'>✏ Edita</button><button class="mini-btn delete-student-btn" title="Eliminar alumne" onclick='deleteStudent(${st.id},${JSON.stringify(st.name)})'>🗑</button></div></div></th>
              <td class="summary-col"><strong>${completedFor(st)}/${exs.length}</strong></td>
              ${exs.map(e=>`<td data-chapter="${e.chapter}">${cell(st,e)}</td>`).join('')}
            </tr>`).join('') || `<tr><td colspan="${exs.length+2}">Encara no hi ha alumnes registrats.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>`;
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


function inlineTheory(s){
  return esc(s)
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g,'<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'<span class="theory-link">$1</span>');
}
function renderTheory(md){
  const lines=String(md||'').split(/\r?\n/); let h='',inCode=false,code=[],inUl=false,inOl=false,inTable=false,table=[];
  const closeLists=()=>{if(inUl){h+='</ul>';inUl=false}if(inOl){h+='</ol>';inOl=false}};
  const flushTable=()=>{if(!inTable)return;const rows=table.filter(r=>!r.every(x=>/^:?-+:?$/.test(x.trim())));if(rows.length){h+='<div class="theory-table-wrap"><table class="theory-table">';rows.forEach((r,i)=>{h+=`<tr>${r.map(x=>`<${i===0?'th':'td'}>${inlineTheory(x.trim())}</${i===0?'th':'td'}>`).join('')}</tr>`});h+='</table></div>'}table=[];inTable=false};
  for(const line of lines){
    if(line.trim().startsWith('```')){flushTable();closeLists();if(!inCode){inCode=true;code=[]}else{h+=`<pre class="theory-code"><code>${esc(code.join('\n'))}</code></pre>`;inCode=false}continue}
    if(inCode){code.push(line);continue}
    if(/^\s*\|.*\|\s*$/.test(line)){closeLists();inTable=true;table.push(line.trim().slice(1,-1).split('|'));continue}else flushTable();
    const m=line.match(/^(#{1,4})\s+(.*)$/);if(m){closeLists();const level=Math.min(4,m[1].length+1);h+=`<h${level}>${inlineTheory(m[2])}</h${level}>`;continue}
    const ul=line.match(/^\s*[-*]\s+(.*)$/);if(ul){if(inOl){h+='</ol>';inOl=false}if(!inUl){h+='<ul>';inUl=true}h+=`<li>${inlineTheory(ul[1])}</li>`;continue}
    const ol=line.match(/^\s*\d+\.\s+(.*)$/);if(ol){if(inUl){h+='</ul>';inUl=false}if(!inOl){h+='<ol>';inOl=true}h+=`<li>${inlineTheory(ol[1])}</li>`;continue}
    closeLists(); if(!line.trim()){h+='<div class="theory-space"></div>';continue}
    if(/^---+$/.test(line.trim())){h+='<hr>';continue}
    h+=`<p>${inlineTheory(line.trim())}</p>`;
  }
  flushTable();closeLists();if(inCode)h+=`<pre class="theory-code"><code>${esc(code.join('\n'))}</code></pre>`;return h;
}
function openTheory(chapter){
 const names={1:'Sortida (output)',2:'Assignació de Variables',3:'Entrada (Input)',4:'Calcular',5:'Selecció IF ELSE',6:'Selecció ELIF',7:'Iteracions',8:'Llistes',9:'Subrutines',10:'Criptografia',11:'Input Loop Adventure Game',12:'Personal Database'};
 const md=COURSE_THEORY?.[chapter]||COURSE_THEORY?.[String(chapter)]||'';
 $('#app').innerHTML=`${studentPreview?`<div class="preview-banner compact"><strong>👁 Vista d'alumne</strong><button class="secondary" onclick="exitStudentPreview()">← Panell professor</button></div>`:''}<article class="card theory-page"><div class="theory-eyebrow">📖 Teoria · Capítol ${chapter}</div><div class="theory-content">${renderTheory(md)}</div><div class="theory-footer"><button class="secondary" onclick="dashboard()">← Índex del curs</button><button onclick="openFirstExercise(${chapter})">Comença els exercicis →</button></div></article>`;
 window.scrollTo({top:0,behavior:'smooth'});
}
function openFirstExercise(chapter){const e=exercises.find(x=>x.chapter===chapter);if(e)openExercise(e.id);else dashboard()}
async function dashboard(){
 const d=await api('/api/exercises'); exercises=d.exercises;
 const chapterNames={1:'Sortida (output)',2:'Assignació de Variables',3:'Entrada (Input)',4:'Calcular',5:'Selecció IF ELSE',6:'Selecció ELIF',7:'Iteracions',8:'Llistes',9:'Subrutines',10:'Criptografia',11:'Input Loop Adventure Game',12:'Personal Database'};
 const last={},drafts={};
 try{const x=await api('/api/my-submissions');for(const s of x.submissions)if(!last[s.exercise_id])last[s.exercise_id]=s;if(!studentPreview){const dr=await api('/api/my-drafts');for(const x of dr.drafts||[])drafts[x.exercise_id]=x}}catch{}
 const done=e=>last[e.id]?.status==='validated'&&last[e.id]?.final_score!=null;
 const n=exercises.filter(done).length,pct=exercises.length?Math.round(n*100/exercises.length):0;
 $('#app').innerHTML=`${studentPreview?"<div class=\"preview-banner\"><strong>👁 Vista d'alumne</strong><span>Estàs previsualitzant el curs. Pots executar exercicis, però no entregar-los.</span><button class=\"secondary\" onclick=\"exitStudentPreview()\">← Tornar al panell del professor</button></div>":''}<div class="course-heading"><div><h1>Programació 4ESO</h1><p>Recorregut de Python: dels primers print() fins als projectes finals.</p></div><strong>${n}/${exercises.length} tasques · ${pct}%</strong></div><div class="course-progress"><span style="width:${pct}%"></span></div><div id="list"></div>`;
 for(const chapter of Object.keys(chapterNames).map(Number)){
  const ce=exercises.filter(x=>x.chapter===chapter);if(!ce.length)continue;const cd=ce.filter(done).length,symbol=cd===ce.length?'✓':cd?'●':'○';
  $('#list').insertAdjacentHTML('beforeend',`<h2 class="chapter-title"><span>${symbol} Capítol ${chapter}: ${esc(chapterNames[chapter])}</span><small>${cd}/${ce.length}</small></h2>`);
  $('#list').insertAdjacentHTML('beforeend',`<div class="card theory-card" onclick="openTheory(${chapter})"><div class="theory-card-icon">📖</div><div><span class="pill theory-pill">TEORIA</span><h3>Teoria · ${esc(chapterNames[chapter])}</h3><p>Conceptes, explicacions i exemples del curs original abans de començar els exercicis.</p></div><span class="theory-arrow">→</span></div>`);
  ce.forEach(x=>{const sub=last[x.id];const status=sub?.status==='returned'?'<span class="status returned">↩ Retornada</span>':sub?.final_score!=null?`<span class="status ok">Nota validada: ${esc(sub.final_score)}/10</span>`:sub?.ai_result_json?'<span class="status pending">Pendent de validació</span>':drafts[x.id]?'<span class="status draft">💾 Esborrany desat</span>':'';const note=sub?.teacher_comment?`<div class="dashboard-teacher-note">💬 ${esc(sub.teacher_comment)}</div>`:'';$('#list').insertAdjacentHTML('beforeend',`<div class="card exercise" onclick="openExercise(${x.id})"><span class="pill">${esc(x.type)}</span><h3>${esc(x.code)} · ${esc(x.title)}</h3><p>${esc(x.statement.slice(0,220))}${x.statement.length>220?'…':''}</p>${status}${note}</div>`);});
 }
}
async function openExercise(id){
 if(draftTimer){clearTimeout(draftTimer);draftTimer=null} current=await api(`/api/exercises/${id}`);
 let savedDraft=null,history=[];if(!studentPreview){try{savedDraft=(await api(`/api/exercises/${id}/draft`)).draft}catch{}try{history=(await api('/api/my-submissions')).submissions.filter(s=>s.exercise_id===id)}catch{}}
 let rubric=[];try{rubric=JSON.parse(current.rubric_json||'[]')}catch{}
 const attempts=history.map((s,i)=>{const n=s.final_score??s.returned_score,state=s.status==='validated'?'Validat':s.status==='returned'?'Retornat':'Pendent';return `<div class="attempt-row"><span>Intent ${history.length-i}</span><strong>${n!=null?esc(n)+'/10':'—'}</strong><span>${state}</span>${s.teacher_comment?`<p>💬 ${esc(s.teacher_comment)}</p>`:''}</div>`}).join('');
 const latestSubmission=history[0]||null;
 const isReturned=!studentPreview && latestSubmission?.status==='returned';
 const submissionLocked=!studentPreview && latestSubmission && !isReturned;
 const submitLabel=submissionLocked?'✓ Enviat':isReturned?'✓ Enviar nou intent':'✓ Entregar';
 const editorCode=isReturned ? latestSubmission.code : (savedDraft?.code??current.starter_code);
 const returnedFeedback=isReturned?`<div class="returned-feedback"><div><span class="status returned">↩ Retornada</span><h3>Comentaris del professor</h3></div><p>${latestSubmission.teacher_comment?esc(latestSubmission.teacher_comment):'El professor ha retornat aquesta tasca perquè la puguis revisar i tornar a enviar.'}</p>${latestSubmission.returned_score!=null?`<small>Nota de l'intent retornat: ${esc(latestSubmission.returned_score)}/10</small>`:''}</div>`:'';
 $('#app').innerHTML=`${studentPreview?"<div class=\"preview-banner compact\"><strong>👁 Vista d'alumne</strong><button class=\"secondary\" onclick=\"exitStudentPreview()\">← Panell professor</button></div>":''}<div id="exercise-layout" class="grid ide-layout"><section id="statement-panel" class="card statement-panel"><div class="statement-head"><span class="pill">${esc(current.type)}</span><button class="collapse-statement secondary" onclick="toggleStatement()">◀ Amaga enunciat</button></div><h1>${esc(current.code)} · ${esc(current.title)}</h1><p class="statement">${esc(current.statement)}</p><h3>Criteris</h3><ul>${rubric.map(x=>`<li>${esc(x[0])}: ${esc(x[1])} punts</li>`).join('')}</ul>${attempts?`<details class="attempt-history"><summary>Historial d'intents (${history.length})</summary>${attempts}</details>`:''}<button class="secondary" onclick="dashboard()">← Tornar</button></section><section class="card python-workspace">${returnedFeedback}<div class="editor-heading"><h2>Editor Python</h2>${studentPreview?'':`<span id="draft-status" class="draft-status">${isReturned?'↩ Codi de l’intent recuperat':savedDraft?'✓ Esborrany recuperat':'Desament automàtic actiu'}</span>`}</div><textarea id="code" spellcheck="false">${esc(editorCode)}</textarea><div class="editor-actions"><button class="run-primary" onclick="runCode()">▶ Executar</button>${studentPreview?'':`<button class="save-subtle secondary" onclick="saveDraft(true)">💾 Desa ara</button>`}<button id="submit-btn" class="submit-final ${submissionLocked?'submitted-lock':''}" onclick="submitCode()" ${(studentPreview||submissionLocked)?'disabled':''} title="${submissionLocked?'Aquest exercici ja està enviat. Es reactivarà si el professor el retorna.':''}">${submitLabel}</button></div><div class="output-heading"><h3>Sortida</h3><small>La pots redimensionar verticalment</small></div><div id="output" class="output resizable-output"></div><div id="grade"></div></section></div>`;
 codeEditor=CodeMirror.fromTextArea($('#code'),{mode:{name:'python',version:3,singleLineStringErrors:false},lineNumbers:true,indentUnit:4,tabSize:4,indentWithTabs:false,lineWrapping:false,viewportMargin:Infinity,autofocus:true,extraKeys:{Tab:cm=>cm.replaceSelection('    ','end')}});
 codeEditor.setSize('100%','clamp(540px,70vh,860px)');
 if(!studentPreview)codeEditor.on('change',()=>{const st=$('#draft-status');if(st){st.textContent='Canvis pendents…';st.className='draft-status pending-save'}if(draftTimer)clearTimeout(draftTimer);draftTimer=setTimeout(()=>saveDraft(false),1800)});
 setTimeout(()=>codeEditor.refresh(),0);
}
function toggleStatement(){const l=$('#exercise-layout'),p=$('#statement-panel'),b=$('.collapse-statement');const h=l.classList.toggle('statement-collapsed');p.classList.toggle('collapsed',h);b.textContent=h?'Enunciat ▶':'◀ Amaga enunciat';setTimeout(()=>codeEditor?.refresh(),80)}
async function saveDraft(manual=false){
  if(studentPreview || !current || !codeEditor || draftSaving) return;
  if(draftTimer){clearTimeout(draftTimer);draftTimer=null}
  draftSaving=true;
  const st=$('#draft-status');
  if(st){st.textContent='Desant…';st.className='draft-status saving'}
  try{
    const d=await api(`/api/exercises/${current.id}/draft`,{method:'PUT',body:JSON.stringify({code:codeEditor.getValue()})});
    const time=new Date().toLocaleTimeString('ca-ES',{hour:'2-digit',minute:'2-digit'});
    if(st){st.textContent=`✓ Esborrany desat · ${time}`;st.className='draft-status saved'}
  }catch(e){
    if(st){st.textContent='⚠ No s’ha pogut desar';st.className='draft-status save-error';st.title=e.message}
    if(manual) alert(`No s'ha pogut desar l'esborrany: ${e.message}`);
  }finally{draftSaving=false}
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
    const p=await loadPy(); const code=codeEditor?codeEditor.getValue():$('#code').value;
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
    const currentSubs=(await api('/api/my-submissions')).submissions.filter(s=>s.exercise_id===current.id);
    const latest=currentSubs[0]||null;
    if(latest && latest.status!=='returned'){
      const btn=$('#submit-btn');if(btn){btn.disabled=true;btn.textContent='✓ Enviat';btn.classList.add('submitted-lock')}
      $('#grade').innerHTML='<p class="submitted-message">✓ Aquest exercici ja està enviat. El botó es reactivarà si el professor el retorna.</p>';
      return;
    }
    if(draftTimer){clearTimeout(draftTimer);draftTimer=null}
    const code=codeEditor?codeEditor.getValue():$('#code').value; const tests=await localTests(code);
    $('#output').textContent=tests.map((t,i)=>`${t.passed?'✓':'✗'} Test ${i+1}${t.detail?' — '+String(t.detail).trim():''}`).join('\n')||'Sense tests automàtics configurats';
    const d=await api(`/api/exercises/${current.id}/submissions`,{method:'POST',body:JSON.stringify({code,tests})});
    const btn=$('#submit-btn');if(btn){btn.disabled=true;btn.textContent='✓ Enviat';btn.classList.add('submitted-lock');btn.title="Aquest exercici ja està enviat. Es reactivarà si el professor el retorna."}
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

function filterTeacher(status,btn){document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));btn?.classList.add('active');document.querySelectorAll('.submission[data-status]').forEach(x=>x.style.display=(status==='all'||x.dataset.status===status)?'':'none')}
async function teacherDashboard(){
  try{
    const d=await api('/api/teacher/submissions');
    $('#app').innerHTML=`<div class="teacher-head"><div><h1>Panell del professor</h1><p>Revisa les entregues i valida la nota final.</p></div><div class="teacher-actions"><button class="secondary" onclick="enterStudentPreview()">👁 Veure com a alumne</button> <button class="secondary" onclick="teacherProgress()">📊 Seguiment alumnes</button><button class="secondary" onclick="teacherDashboard()">↻ Actualitzar</button></div></div><div class="teacher-filters"><button class="filter-btn active" onclick="filterTeacher(\'all\',this)">Totes</button><button class="filter-btn" onclick="filterTeacher(\'pending\',this)">Només pendents</button><button class="filter-btn" onclick="filterTeacher(\'returned\',this)">Retornades</button><button class="filter-btn" onclick="filterTeacher(\'validated\',this)">Validades</button></div><div id="teacher-list"></div>`;
    if(!d.submissions.length){ $('#teacher-list').innerHTML='<div class="card"><p>Encara no hi ha entregues.</p></div>'; return; }
    for(const s of d.submissions){
      let ai={}; try{ai=JSON.parse(s.ai_result_json||'{}')}catch{}
      const validated=s.status==='validated';
      const returned=s.status==='returned';
      const stateLabel=returned?'↩ Retornada':validated?'✓ Validada':'Pendent';
      $('#teacher-list').insertAdjacentHTML('beforeend',`<article class="card submission ${returned?'returned-submission':''}" data-status="${returned?'returned':validated?'validated':'pending'}"><div class="submission-head"><div><span class="pill">${esc(s.exercise_code)}</span> <span class="status ${returned?'returned':validated?'ok':'pending'}">${stateLabel}</span><h3>${esc(s.name)} · ${esc(s.title)}</h3><small>${esc(s.submitted_at)}</small></div><div class="score small">${returned?'—':s.final_score!=null?esc(s.final_score):ai.score!=null?esc(Number(ai.score).toFixed(1)):'—'}/10</div></div><details><summary>Veure codi i correcció</summary><h4>Codi entregat</h4><pre>${esc(s.student_code)}</pre><h4>Feedback per a l'alumne</h4><p>${esc(ai.feedback||'Sense proposta IA')}</p>${Array.isArray(ai.criteria)&&ai.criteria.length?`<h4>Rúbrica proposada</h4><div class="teacher-criteria">${ai.criteria.map(c=>`<p><strong>${esc(c.name)}: ${esc(c.score)}/${esc(c.max)}</strong> — ${esc(c.reason||'')}</p>`).join('')}</div>`:''}${ai.teacher_feedback?`<h4>Informe per al professor</h4><p>${esc(ai.teacher_feedback)}</p>`:''}${ai.teacher_warning?`<div class="ai-warning"><strong>⚠ Revisió recomanada:</strong> ${esc(ai.teacher_warning)}</div>`:''}</details><div class="teacher-comment-box"><label>Comentari del professor</label><textarea id="comment-${s.id}" placeholder="Comentari opcional que veurà l\'alumne" ${returned?'disabled':''}>${esc(s.teacher_comment||'')}</textarea></div><div class="validate"><input id="score-${s.id}" type="number" min="0" max="10" step="0.1" value="${esc(s.final_score!=null?s.final_score:(s.returned_score!=null?s.returned_score:(ai.score??'')))}" ${validated||returned?'disabled':''}><button onclick="validateSubmission(${s.id})" ${validated||returned?'disabled':''}>${validated?'✓ Validada':returned?'Retornada':'Validar nota'}</button>${returned?'':`<button class="return-btn" onclick="returnSubmission(${s.id})">↩ Retorn</button><button class="danger delete-btn" onclick="deleteSubmission(${s.id})">🗑 Eliminar</button>`}</div></article>`);
    }
  }catch(e){ $('#app').innerHTML=`<div class="card"><h1>Panell del professor</h1><p class="error">${esc(e.message)}</p></div>`; }
}

async function validateSubmission(id){
  const input=$(`#score-${id}`); const score=Number(input.value);
  if(!Number.isFinite(score)||score<0||score>10){ alert('La nota ha de ser entre 0 i 10.'); return; }
  const comment=$(`#comment-${id}`)?.value||''; try{ await api(`/api/teacher/submissions/${id}`,{method:'POST',body:JSON.stringify({score,comment})}); await teacherDashboard(); }
  catch(e){ alert(e.message); }
}


async function deleteSubmission(id){
  if(!confirm("Vols eliminar definitivament aquesta entrega?\n\nAquesta acció esborrarà l'intent del panell i de l'historial de l'alumne i no es pot desfer.")) return;
  try{
    await api(`/api/teacher/submissions/${id}`,{method:'DELETE'});
    await teacherDashboard();
  }catch(e){ alert(e.message); }
}

async function returnSubmission(id){
  const ok=confirm("Vols retornar aquesta entrega?\n\nL'intent es conservarà a l'historial i l'exercici tornarà a aparèixer com a no fet perquè l'alumne el pugui repetir.");
  if(!ok) return;
  try{
    const score=Number($(`#score-${id}`)?.value),comment=$(`#comment-${id}`)?.value||''; await api(`/api/teacher/submissions/${id}`,{method:'POST',body:JSON.stringify({action:'return',score:Number.isFinite(score)?score:null,comment})});
    await teacherDashboard();
  }catch(e){ alert(e.message); }
}

start();
