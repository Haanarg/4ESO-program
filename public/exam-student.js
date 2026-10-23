let examMode=false, examSession=null, examQuestionIndex=0, examSaveTimer=null, examTimerInterval=null, examStatusInterval=null, examIntegrityBound=false, examFullscreenWasActive=false, examFullscreenExitStartedMs=null, examFullscreenExitEventPromise=null, examSaving=false, examDirty=false, examAutoSubmitting=false, examServerOffsetMs=0;

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
  const ok=confirm('Vols començar l’examen ara?\n\nEn començar, el temps comptarà i la feina es desarà automàticament.');
  if(!ok)return;

  if(!document.fullscreenElement){
    if(!document.documentElement.requestFullscreen){
      alert('Aquest navegador no permet iniciar l’examen en pantalla completa. Prova amb un navegador compatible.');
      return;
    }
    try{
      await document.documentElement.requestFullscreen();
    }catch{
      alert('Per començar l’examen has d’entrar en pantalla completa. L’examen encara no s’ha iniciat.');
      return;
    }
  }

  if(!document.fullscreenElement){
    alert('No s’ha pogut activar la pantalla completa. L’examen encara no s’ha iniciat.');
    return;
  }

  try{
    await api(`/api/exams/${id}/start`,{method:'POST',body:'{}'});
    await openExam(id);
  }catch(e){
    if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    alert(e.message);
  }
}

function examCleanup(){
  examMode=false;
  if(examSaveTimer){clearTimeout(examSaveTimer);examSaveTimer=null}
  if(examTimerInterval){clearInterval(examTimerInterval);examTimerInterval=null}
  if(examStatusInterval){clearInterval(examStatusInterval);examStatusInterval=null}
  document.removeEventListener('visibilitychange',examVisibilityHandler);
  document.removeEventListener('fullscreenchange',examFullscreenHandler);
  document.removeEventListener('paste',examGlobalPasteHandler,true);
  window.removeEventListener('beforeunload',examBeforeUnload);
  examIntegrityBound=false;
  examFullscreenExitStartedMs=null;
  examFullscreenExitEventPromise=null;
  examSaving=false;examDirty=false;examAutoSubmitting=false;
  nav();
}
function examBeforeUnload(e){
  if(!examMode)return;
  e.preventDefault();e.returnValue='';
}
function examVisibilityHandler(){
  if(examMode && document.hidden){
    examSaveCurrent(false);
    examIntegrityEvent('tab_hidden',{at:new Date().toISOString()});
  }
}
function syncExamFullscreenButton(){
  const b=$('#exam-fullscreen-btn');
  if(b)b.hidden=!!document.fullscreenElement;
}
async function enterExamFullscreen(){
  try{if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen()}catch{}
  syncExamFullscreenButton();
}
async function examFullscreenHandler(){
  if(!examMode)return;
  if(document.fullscreenElement){
    examFullscreenWasActive=true;
    if(examFullscreenExitStartedMs!=null){
      const started=examFullscreenExitStartedMs;
      const eventPromise=examFullscreenExitEventPromise;
      examFullscreenExitStartedMs=null;
      examFullscreenExitEventPromise=null;
      const returnedAt=new Date().toISOString();
      const durationMs=Math.max(0,Date.now()-started);
      try{
        const created=await eventPromise;
        if(created?.event_id && examSession?.attempt?.id){
          await api(`/api/exam-attempts/${examSession.attempt.id}/events/${created.event_id}`,{
            method:'PATCH',
            body:JSON.stringify({duration_ms:durationMs,returned_at:returnedAt})
          });
        }
      }catch{}
    }
  }else if(examFullscreenWasActive && examFullscreenExitStartedMs==null){
    examFullscreenExitStartedMs=Date.now();
    const leftAt=new Date(examFullscreenExitStartedMs).toISOString();
    examFullscreenExitEventPromise=examIntegrityEvent('fullscreen_exit',{left_at:leftAt});
  }
  syncExamFullscreenButton();
}
function examGlobalPasteHandler(e){
  if(!examMode)return;
  const target=e.target;
  if(target?.closest?.('.CodeMirror') || target?.closest?.('.student-translator')) return;
  const text=e.clipboardData?.getData('text/plain')||'';
  if(/\r?\n/.test(text)){
    examIntegrityEvent('copy_paste',{lines:text.split(/\r?\n/).length,chars:text.length,area:target?.id||target?.tagName||'unknown'});
  }
}
function bindExamIntegrity(){
  if(examIntegrityBound)return;
  examIntegrityBound=true;
  examFullscreenWasActive=!!document.fullscreenElement;
  examFullscreenExitStartedMs=null;
  examFullscreenExitEventPromise=null;
  document.addEventListener('visibilitychange',examVisibilityHandler);
  document.addEventListener('fullscreenchange',examFullscreenHandler);
  document.addEventListener('paste',examGlobalPasteHandler,true);
  window.addEventListener('beforeunload',examBeforeUnload);
}
async function examIntegrityEvent(type,meta={}){
  if(!examMode||!examSession?.attempt?.id)return null;
  try{
    return await api(`/api/exam-attempts/${examSession.attempt.id}/events`,{method:'POST',body:JSON.stringify({
      event_type:type,question_id:examSession.questions?.[examQuestionIndex]?.id??null,meta
    })});
  }catch{return null}
}
function examBlockedNetworkUse(code){
  const patterns=[
    {name:'js',re:/^\s*(?:from\s+js\s+import|import\s+js\b)/m},
    {name:'pyodide',re:/^\s*(?:from\s+pyodide(?:\.|\s)|import\s+pyodide\b)/m},
    {name:'micropip',re:/^\s*(?:from\s+micropip\s+import|import\s+micropip\b)/m},
    {name:'urllib.request',re:/^\s*(?:from\s+urllib(?:\.request)?\s+import|import\s+urllib\.request\b)/m},
    {name:'http.client',re:/^\s*(?:from\s+http\.client\s+import|import\s+http\.client\b)/m},
    {name:'socket',re:/^\s*(?:from\s+socket\s+import|import\s+socket\b)/m},
    {name:'requests',re:/^\s*(?:from\s+requests\s+import|import\s+requests\b)/m},
    {name:'aiohttp',re:/^\s*(?:from\s+aiohttp\s+import|import\s+aiohttp\b)/m},
    {name:'httpx',re:/^\s*(?:from\s+httpx\s+import|import\s+httpx\b)/m},
    {name:'webbrowser',re:/^\s*(?:from\s+webbrowser\s+import|import\s+webbrowser\b)/m},
    {name:'dynamic_import',re:/\b(?:__import__|importlib)\b/}
  ];
  return patterns.find(x=>x.re.test(String(code||'')))?.name||null;
}
async function runExamCode(){
  const code=codeEditor?.getValue()??'';
  const blocked=examBlockedNetworkUse(code);
  if(blocked){
    await examIntegrityEvent('network_attempt',{blocked});
    const out=$('#output');if(out)out.textContent='Aquest mòdul o recurs no està disponible en aquest entorn d’execució.';
    return;
  }
  return runCode();
}

async function openExam(id){
  try{
    const d=await api(`/api/exams/${id}/attempt`);
    examSession=d;
    examServerOffsetMs=d.server_now?Date.parse(d.server_now)-Date.now():0;
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
    if(examStatusInterval)clearInterval(examStatusInterval);
    examTimerInterval=setInterval(updateExamTimer,1000);
    examStatusInterval=setInterval(examHeartbeat,30000);
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
      <button id="exam-fullscreen-btn" class="secondary exam-fullscreen-btn" onclick="enterExamFullscreen()" ${document.fullscreenElement?'hidden':''}>⛶ Torna a pantalla completa</button>
      <div class="exam-question-nav">${s.questions.map((x,i)=>{
        const a=examAnswerFor(x),has=String(a.code||'').trim().length>0;
        return `<button class="${i===examQuestionIndex?'active':''} ${has?'has-work':''}" onclick="goExamQuestion(${i})"><b>${i+1}</b><span>${esc(x.title)}</span></button>`;
      }).join('')}</div>
      <button class="secondary exam-review-btn" onclick="examReview()">Revisa i lliura</button>
      <small class="exam-security-note">Desament automàtic actiu</small>
    </aside>
    <main class="exam-workspace">
      <div class="exam-question-head"><div><span class="pill">Exercici ${examQuestionIndex+1}/${total}</span><h1>${esc(q.title)}</h1></div><strong>${esc(q.max_score)} punts</strong></div>
      <div id="exam-statement" class="exam-statement">${esc(q.statement)}</div>
      ${studentTranslatorHtml()}
      <div class="editor-heading"><h2>Editor Python</h2><span id="exam-save-status" class="draft-status saved">✓ Desat</span></div>
      <textarea id="code" spellcheck="false">${esc(ans.code??q.starter_code??'')}</textarea>
      <div class="program-input-panel"><label for="stdin">⌨ Entrades del programa (<code>input()</code>)</label><p>Una resposta per línia, en l’ordre que les demana el programa.</p><textarea id="stdin" class="stdin" rows="3" spellcheck="false"></textarea></div>
      <div class="editor-actions exam-editor-actions">
        <button class="run-primary" onclick="runExamCode()">▶ Executa</button>
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
    const chars=Array.isArray(change.text)?change.text.join('\n').length:0;
    if(change.origin==='paste' && Array.isArray(change.text) && change.text.length>1 && !isStudentTranslatorPaste(change.text)){
      examIntegrityEvent('copy_paste',{lines:change.text.length,chars,area:'editor'});
    }else if(!['setValue','paste','undo','redo'].includes(change.origin) && chars>=120){
      examIntegrityEvent('large_insert',{chars,origin:change.origin||'unknown'});
    }
  });
  const wrap=codeEditor.getWrapperElement();
  wrap.addEventListener('drop',e=>{
    const t=e.dataTransfer?.getData('text/plain')||'';
    if(/\r?\n/.test(t)){
      examIntegrityEvent('drop_multiline',{lines:t.split(/\r?\n/).length,chars:t.length});
    }
  });
  $('#stdin').addEventListener('input',scheduleExamSave);
  const statementEl=$('#exam-statement');
  if(statementEl)statementEl.addEventListener('copy',()=>{
    const selected=String(window.getSelection()?.toString()||'');
    if(selected.trim().length<20)return;
    examIntegrityEvent('statement_copy',{
      chars:selected.length,
      near_full_statement:selected.length>=String(q.statement||'').length*.8
    });
  });
  setTimeout(()=>codeEditor.refresh(),0);
  updateExamTimer();
}
function scheduleExamSave(){
  if(!examMode)return;
  const st=$('#exam-save-status');if(st){st.textContent='Canvis pendents…';st.className='draft-status pending-save'}
  if(examSaveTimer)clearTimeout(examSaveTimer);
  examSaveTimer=setTimeout(()=>examSaveCurrent(false),1000);
}
async function examSaveCurrent(manual=false){
  if(!examMode||!examSession?.attempt?.id||!examSession.questions?.length)return true;
  if(examSaveTimer){clearTimeout(examSaveTimer);examSaveTimer=null}
  if(examSaving){examDirty=true;return false}
  examSaving=true;examDirty=false;
  const q=examSession.questions[examQuestionIndex],code=codeEditor?.getValue()??'',stdin=$('#stdin')?.value||'';
  const st=$('#exam-save-status');if(st){st.textContent='Desant…';st.className='draft-status saving'}
  try{
    await api(`/api/exam-attempts/${examSession.attempt.id}/answers/${q.id}`,{method:'PUT',body:JSON.stringify({code,stdin})});
    examSession.answersMap.set(Number(q.id),{...(examAnswerFor(q)),question_id:q.id,code,stdin,updated_at:new Date().toISOString()});
    if(st){st.textContent='✓ Desat';st.className='draft-status saved'}
    return true;
  }catch(e){
    if(st){st.textContent='⚠ Error de desament';st.className='draft-status save-error';st.title=e.message}
    if(manual)alert(`No s’ha pogut desar: ${e.message}`);
    return false;
  }finally{
    examSaving=false;
    if(examDirty){examDirty=false;setTimeout(()=>examSaveCurrent(false),0)}
  }
}
async function goExamQuestion(index){
  if(index<0||index>=examSession.questions.length||index===examQuestionIndex)return;
  const ok=await examSaveCurrent(true);if(!ok)return;
  examQuestionIndex=index;renderExamQuestion();
}
async function examHeartbeat(){
  if(!examMode||!examSession?.attempt?.id)return;
  try{
    const st=await api(`/api/exam-attempts/${examSession.attempt.id}/status`);
    examServerOffsetMs=st.server_now?Date.parse(st.server_now)-Date.now():examServerOffsetMs;
    if(st.deadline) examSession.deadline=st.deadline;
    if(st.status!=='in_progress'){
      const examId=examSession.exam.id;
      examCleanup();
      const fresh=await api(`/api/exams/${examId}/attempt`);
      alert('L’examen s’ha tancat i la feina desada ha quedat lliurada.');
      renderSubmittedExam(fresh);
    }
  }catch{}
}
function updateExamTimer(){
  if(!examMode||!examSession)return;
  const el=$('#exam-timer'),deadline=examSession.deadline;
  if(!el)return;
  if(!deadline){el.textContent='Sense límit';return}
  const left=Date.parse(deadline)-(Date.now()+examServerOffsetMs);
  if(left<=0){
    el.textContent='00:00';el.classList.add('danger');
    if(!examAutoSubmitting) examAutoSubmit();
    return;
  }
  const sec=Math.floor(left/1000),h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),ss=sec%60;
  el.textContent=h?`${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`:`${m}:${String(ss).padStart(2,'0')}`;
  el.classList.toggle('danger',left<5*60*1000);
}
async function examAutoSubmit(){
  examAutoSubmitting=true;
  try{await examSaveCurrent(false)}catch{}
  try{await api(`/api/exam-attempts/${examSession.attempt.id}/submit`,{method:'POST',body:'{}'})}catch{}
  const examId=examSession.exam.id;
  examCleanup();
  alert('El temps de l’examen ha acabat. S’ha lliurat automàticament la feina desada.');
  try{await openExam(examId)}catch{dashboard()}
}
async function examReview(){
  const ok=await examSaveCurrent(true);if(!ok)return;
  try{
    const fresh=await api(`/api/exams/${examSession.exam.id}/attempt`);
    examSession=fresh;examServerOffsetMs=fresh.server_now?Date.parse(fresh.server_now)-Date.now():examServerOffsetMs;examSession.answersMap=new Map((fresh.answers||[]).map(x=>[Number(x.question_id),x]));
    if(fresh.attempt.status!=='in_progress'){
      examCleanup();
      renderSubmittedExam(fresh);
      return;
    }
    renderExamReview(false);
  }catch(e){alert(e.message)}
}
function renderExamReview(readOnly=false){
  const s=examSession;
  $('#app').innerHTML=`<div class="exam-review-page">
    <div class="exam-review-head"><div><span class="pill">${readOnly?'LLIURAT':'REVISIÓ FINAL'}</span><h1>${esc(s.exam.title)}</h1><p>${readOnly?'Aquesta és la còpia desada del teu lliurament.':'Revisa tots els exercicis abans de lliurar. Encara pots tornar enrere i editar.'}</p></div>${!readOnly?'<div id="exam-timer" class="exam-timer">--:--</div>':''}</div>
    <div class="exam-review-list">${s.questions.map((q,i)=>{
      const a=examAnswerFor(q),empty=!String(a.code||'').trim();
      return `<article class="card exam-review-item"><div class="exam-review-item-head"><h2>${i+1}. ${esc(q.title)}</h2><span class="${empty?'exam-empty':'exam-done'}">${empty?'Sense codi':'Desat'}</span></div><p>${esc(q.statement)}</p><pre>${esc(a.code||'')}</pre>${a.stdin?`<details><summary>Entrades de prova</summary><pre>${esc(a.stdin)}</pre></details>`:''}${readOnly&&a.score!=null?`<div class="exam-answer-grade"><strong>${esc(a.score)}/${esc(q.max_score)}</strong>${a.feedback?`<p>${esc(a.feedback)}</p>`:''}</div>`:''}</article>`;
    }).join('')}</div>
    ${readOnly
      ? `<div class="card exam-final-result">${s.attempt.status==='graded'?`<h2>Nota: ${esc(s.attempt.final_score??'—')}/10</h2>${s.attempt.teacher_comment?`<p>${esc(s.attempt.teacher_comment)}</p>`:''}`:'<h2>Examen lliurat</h2><p>Pendent de correcció del professor.</p>'}<button onclick="dashboard()">← Torna al curs</button></div>`
      : `<div class="card exam-submit-box"><label class="exam-confirm-check"><input id="exam-confirm-check" type="checkbox" onchange="$('#exam-final-submit').disabled=!this.checked"> He revisat les respostes i sé que, un cop lliurat, no podré modificar l’examen.</label><div><button class="secondary" onclick="renderExamQuestion()">← Continua editant</button><button id="exam-final-submit" onclick="submitExamFinal()" disabled>Lliura definitivament</button></div></div>`}
  </div>`;
  if(!readOnly){updateExamTimer()}
}
async function submitExamFinal(){
  if(!$('#exam-confirm-check')?.checked)return;
  if(!confirm('Segona confirmació:\n\nVols lliurar DEFINITIVAMENT l’examen? Després no podràs editar cap resposta.'))return;
  try{
    await api(`/api/exam-attempts/${examSession.attempt.id}/submit`,{method:'POST',body:'{}'});
    const id=examSession.exam.id;
    examCleanup();
    if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
    await openExam(id);
  }catch(e){alert(e.message)}
}
function renderSubmittedExam(d){
  examSession=d;examSession.answersMap=new Map((d.answers||[]).map(x=>[Number(x.question_id),x]));
  renderExamReview(true);
}

