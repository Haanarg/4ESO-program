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
  document.addEventList