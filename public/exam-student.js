let examMode=false, examSession=null, examQuestionIndex=0, examSaveTimer=null, examTimerInterval=null, examIntegrityBound=false, examFullscreenWasActive=false, examSaving=false, examDirty=false, examAutoSubmitting=false;

function examStateLabel(state){
  return ({draft:'Esborrany',upcoming:'Programat',active:'Obert',closed:'Tancat'})[state]||state||'—';
}
function fmtDateTime(iso){
  if(!iso)return '—';
  const d=new Date(iso);
  return Number.isNaN(d.getTime())?String(iso):d.toLocaleString('ca-ES',{dateStyle:'short',timeStyle:'short'});
}
function toLocalInput(iso){
  if(!iso)return '';
  const d=new Date(iso); if(Number.isNaN(d.getTime()))return '';
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v){return v?new Date(v).toISOString():null}

function studentExamCards(items){
  if(!items?.length)return '';
  return `<section class="exam-home-section"><div class="exam-home-head"><div><span class="pill exam-pill">EXÀMENS</span><h2>Exàmens de programació</h2></div></div>
    <div class="exam-home-grid">${items.map(e=>{
      const a=e.attempt,state=e.effective_state;
      const status=a?.status==='graded'?`<span class="status ok">Corregit · ${a.final_score==null?'—':esc(a.final_score)}/10</span>`
        :a?.status==='submitted'?'<span class="status pending">Lliurat</span>'
        :a?.status==='in_progress'?'<span class="status exam-live">En curs</span>'
        :state==='upcoming'?'<span class="status draft">Programat</span>'
        :state==='active'?'<span class="status exam-live">Obert</span>':'';
      const when=e.start_at?`<small>Inici: ${esc(fmtDateTime(e.start_at))}${e.end_at?` · Final: ${esc(fmtDateTime(e.end_at))}`:''}</small>`:'';
      const duration=e.duration_minutes?`<small>Temps: ${esc(e.duration_minutes)} min</small>`:'';
      let action='';
      if(a?.status==='in_progress') action=`<button onclick="openExam(${e.id})">Continua l’examen →</button>`;
      else if(a?.status==='submitted'||a?.status==='graded') action=`<button class="secondary" onclick="openExam(${e.id})">Revisa el lliurament</button>`;
      else if(state==='active') action=`<button onclick="startExam(${e.id})">Comença l’examen</button>`;
      else if(state==='upcoming') action=`<button class="secondary" disabled>Encara no disponible</button>`;
      return `<article class="card exam-home-card"><div><span class="pill">${esc(examStateLabel(state))}</span><h3>${esc(e.title)}</h3><p>${esc(e.description||'')}</p><div class="exam-meta">${when}${duration}<small>${esc(e.question_count||0)} exercicis</small></div>${status}</div><div>${action}</div></article>`;
    }).join('')}</div></section>`;
}

async function startExam(id){
  const ok=confirm('Vols començar l’examen ara?\n\nEn començar, el temps comptarà. La feina es desarà automàticament i es registraran canvis de pestanya, sortides de pantalla completa i enganxats de blocs de codi de més d’una línia.');
  if(!ok)return;
  try{
    if(document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(()=>{});
    await api(`/api/exams/${id}/start`,{method:'POST',body:'{}'});
    await openExam(id);
  }catch(e){alert(e.message)}
}

function examCleanup(){
  examMode=false;
  if(examSaveTimer){clearTimeout(examSaveTimer);examSaveTimer=null}
  if(examTimerInterval){clearInterval(examTimerInterval);examTimerInterval=null}
  document.removeEventListener('visibilitychange',examVisibilityHandler);
  document.removeEventListener('fullscreenchange',examFullscreenHandler);
  window.removeEventListener('beforeunload',examBeforeUnload);
  examIntegrityBound=false;
  examSaving=false;examDirty=false;examAutoSubmitting=false;
  nav();
}
function examBeforeUnload(e){
  if(!examMode)return;
  e.preventDefault();e.returnValue='';
}
function examVisibilityHandler(){
  if(examMode && document.hidden) examIntegrityEvent('tab_hidden',{at:new Date().toISOString()});
}
function examFullscreenHandler(){
  if(!examMode)return;
  if(document.fullscreenElement) examFullscreenWasActive=true;
  else if(examFullscreenWasActive) examIntegrityEvent('fullscreen_exit',{at:new Date().toISOString()});
}
function bindExamIntegrity(){
  if(examIntegrityBound)return;
  examIntegrityBound=true;
  examFullscreenWasActive=!!document.fullscreenElement;
  document.addEventListener('visibilitychange',examVisibilityHandler);
  document.addEventListener('fullscreenchange',examFullscreenHandler);
  window.addEventListener('beforeunload',examBeforeUnload);
}
async function examIntegrityEvent(type,meta={}){
  if(!examMode||!examSession?.attempt?.id)return;
  try{
    await api(`/api/exam-attempts/${examSession.attempt.id}/events`,{method:'POST',body:JSON.stringify({
      event_type:type,question_id:examSession.questions?.[examQuestionIndex]?.id??null,meta
    })});
  }catch{}
}
function showExamWarning(text){
  const box=$('#exam-integrity-warning');
  if(!box)return;
  box.textContent=text;box.hidden=false;
  clearTimeout(showExamWarning._t);
  showExamWarning._t=setTimeout(()=>{if(box)box.hidden=true},5000);
}

async function openExam(id){
  try{
    const d=await api(`/api/exams/${id}/attempt`);
    examSession=d;
    examSession.answersMap=new Map((d.answers||[]).map(x=>[Number(x.question_id),x]));
    examQuestionIndex=0;
    const inProgress=d.attempt.status==='in_progress';
    if(!inProgress){
      examCleanup();
      return renderSubmittedExam(d);
    }
    examMode=true;nav();bindExamIntegrity();
    renderExamQuestion();
    if(examTimerInterval)clearInterval(examTimerInterval);
    examTimerInterval=setInterval(updateExamTimer,1000);
    updateExamTimer();
  }catch(e){
    examCleanup();
    alert(e.message);dashboard();
  }
}
function examAnswerFor(q){
  return examSession?.answersMap?.get(Number(q.id))||{question_id:q.id,code:q.starter_code||'',stdin:''};
}
function renderExamQuestion(){
  const s=examSession,q=s.questions[examQuestionIndex],ans=examAnswerFor(q);
  const total=s.questions.length;
  $('#app').innerHTML=`<div class="exam-shell">
    <aside class="exam-sidebar">
      <div class="exam-brand"><span>MODE EXAMEN</span><strong>${esc(s.exam.title)}</strong></div>
      <div id="exam-timer" class="exam-timer">--:--</div>
      <div class="exam-question-nav">${s.questions.map((x,i)=>{
        const a=examAnswerFor(x),has=String(a.code||'').trim().length>0;
        return `<button class="${i===examQuestionIndex?'active':''} ${has?'has-work':''}" onclick="goExamQuestion(${i})"><b>${i+1}</b><span>${esc(x.title)}</span></button>`;
      }).join('')}</div>
      <button class="secondary exam-review-btn" onclick="examReview()">Revisa i lliura</button>
      <small class="exam-security-note">Desament automàtic actiu · controls d’integritat actius</small>
    </aside>
    <main class="exam-workspace">
      <div id="exam-integrity-warning" class="exam-integrity-warning" hidden></div>
      <div class="exam-question-head"><div><span class="pill">Exercici ${examQuestionIndex+1}/${total}</span><h1>${esc(q.title)}</h1></div><strong>${esc(q.max_score)} punts</strong></div>
      <div class="exam-statement">${esc(q.statement)}</div>
      <div class="editor-heading"><h2>Editor Python</h2><span id="exam-save-status" class="draft-status saved">✓ Desat</span></div>
      <textarea id="code" spellcheck="false">${esc(ans.code??q.starter_code??'')}</textarea>
      <div class="program-input-panel"><label for="stdin">⌨ Entrades del programa (<code>input()</code>)</label><p>Una resposta per línia, en l’ordre que les demana el programa.</p><textarea id="stdin" class="stdin" rows="3" spellcheck="false"></textarea></div>
      <div class="editor-actions exam-editor-actions">
        <button class="run-primary" onclick="runCode()">▶ Executa</button>
        <button class="secondary" onclick="examSaveCurrent(true)">💾 Desa ara</button>
        <span class="exam-spacer"></span>
        <button class="secondary" onclick="goExamQuestion(${examQuestionIndex-1})" ${examQuestionIndex===0?'disabled':''}>← Anterior</button>
        <button onclick="goExamQuestion(${examQuestionIndex+1})" ${examQuestionIndex===total-1?'disabled':''}>Següent →</button>
      </div>
      <div class="output-heading"><h3>Sortida</h3><small>Només execució local; no hi ha correcció ni pistes</small></div>
      <div id="output" class="output resizable-output"></div>
    </main>
  </div>`;
  $('#stdin').value=ans.stdin||'';
  codeEditor=CodeMirror.fromTextArea($('#code'),{mode:{name:'python',version:3,singleLineStringErrors:false},lineNumbers:true,indentUnit:4,tabSize:4,indentWithTabs:false,lineWrapping:false,viewportMargin:Infinity,autofocus:true,extraKeys:{Tab:cm=>cm.replaceSelection('    ','end')}});
  codeEditor.setSize('100%','clamp(500px,64vh,780px)');
  codeEditor.on('change',()=>scheduleExamSave());
  codeEditor.on('beforeChange',(cm,change)=>{
    if(change.origin===