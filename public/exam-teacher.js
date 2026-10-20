async function teacherExams(){
  try{
    const d=await api('/api/teacher/exams'),items=d.exams||[];
    $('#app').innerHTML=`<div class="teacher-head"><div><h1>Exàmens de programació</h1><p>Crea, programa, obre, tanca i corregeix exàmens des d’un sol lloc.</p></div><div class="teacher-actions"><button onclick="teacherNewExam()">＋ Nou examen</button><button class="secondary" onclick="teacherDashboard()">← Panell professor</button></div></div>
      <div class="exam-admin-grid">${items.map(e=>`<article class="card exam-admin-card"><div class="exam-admin-card-head"><span class="status ${e.effective_state==='active'?'exam-live':e.effective_state==='closed'?'returned':'draft'}">${esc(examStateLabel(e.effective_state))}</span><small>${esc(e.question_count)} exercicis</small></div><h2>${esc(e.title)}</h2><p>${esc(e.description||'')}</p><div class="exam-meta"><small>Inici: ${esc(fmtDateTime(e.start_at))}</small><small>Final: ${esc(fmtDateTime(e.end_at))}</small><small>${e.duration_minutes?esc(e.duration_minutes)+' min':'Sense límit individual'}</small><small>${esc(e.attempt_count)} intents · ${esc(e.submitted_count)} lliurats · ${esc(e.graded_count)} corregits</small></div><div class="exam-admin-actions"><button onclick="teacherEditExam(${e.id})">Configura</button><button class="secondary" onclick="teacherExamResults(${e.id})">Lliuraments</button></div></article>`).join('')||'<div class="card compact-empty"><p>Encara no hi ha exàmens.</p></div>'}</div>`;
  }catch(e){$('#app').innerHTML=`<div class="card"><h1>Exàmens</h1><p class="error">${esc(e.message)}</p><button onclick="teacherDashboard()">← Torna</button></div>`}
}
function teacherNewExam(){
  $('#app').innerHTML=`<section class="card exam-form-card"><h1>Nou examen</h1><label>Títol<input id="exam-title" maxlength="160" placeholder="Examen Python · Unitat 1"></label><label>Descripció<textarea id="exam-description" rows="3" placeholder="Indicacions generals per als alumnes"></textarea></label><div class="exam-settings-grid"><label>Inici programat<input id="exam-start" type="datetime-local"></label><label>Final programat<input id="exam-end" type="datetime-local"></label><label>Temps individual (minuts)<input id="exam-duration" type="number" min="1" max="480" placeholder="60"></label></div><div class="modal-actions"><button class="secondary" onclick="teacherExams()">Cancel·la</button><button onclick="teacherCreateExam()">Crea l’examen</button></div><p id="exam-form-msg"></p></section>`;
}
async function teacherCreateExam(){
  const msg=$('#exam-form-msg');
  try{
    const d=await api('/api/teacher/exams',{method:'POST',body:JSON.stringify({
      title:$('#exam-title').value,description:$('#exam-description').value,
      start_at:fromLocalInput($('#exam-start').value),end_at:fromLocalInput($('#exam-end').value),
      duration_minutes:$('#exam-duration').value||null
    })});
    await teacherEditExam(d.exam.id);
  }catch(e){msg.textContent=e.message;msg.className='error'}
}
async function teacherEditExam(id){
  try{
    const d=await api(`/api/teacher/exams/${id}`),e=d.exam,qs=d.questions||[],locked=Number(e.attempt_count||0)>0;
    $('#app').innerHTML=`<div class="teacher-head"><div><span class="status ${e.effective_state==='active'?'exam-live':e.effective_state==='closed'?'returned':'draft'}">${esc(examStateLabel(e.effective_state))}</span><h1>${esc(e.title)}</h1><p>${locked?'L’examen ja té intents: els exercicis queden bloquejats per preservar els lliuraments.':'Configura l’examen i els seus exercicis.'}</p></div><div class="teacher-actions"><button class="secondary" onclick="teacherExamResults(${e.id})">📋 Lliuraments</button><button class="secondary" onclick="teacherExams()">← Exàmens</button></div></div>
      <section class="card exam-form-card"><h2>Configuració</h2><label>Títol<input id="exam-title" value="${esc(e.title)}"></label><label>Descripció<textarea id="exam-description" rows="3">${esc(e.description||'')}</textarea></label><div class="exam-settings-grid"><label>Inici<input id="exam-start" type="datetime-local" value="${esc(toLocalInput(e.start_at))}"></label><label>Final<input id="exam-end" type="datetime-local" value="${esc(toLocalInput(e.end_at))}"></label><label>Temps individual (min)<input id="exam-duration" type="number" min="1" max="480" value="${esc(e.duration_minutes??'')}"></label></div><div class="exam-lifecycle-actions"><button onclick="saveExamSettings(${e.id})">💾 Desa configuració</button><button class="secondary" onclick="setExamStatus(${e.id},'scheduled')">🗓 Programa</button><button class="secondary" onclick="setExamStatus(${e.id},'open')">▶ Obre ara</button><button class="return-btn" onclick="setExamStatus(${e.id},'closed')">■ Tanca</button>${!locked?`<button class="delete-btn" onclick="deleteExam(${e.id})">🗑 Elimina</button>`:''}</div><p id="exam-settings-msg"></p></section>
      <section class="exam-question-admin"><div class="exam-section-head"><div><h2>Exercicis</h2><p>${qs.length} exercicis · ${qs.reduce((n,q)=>n+Number(q.max_score||0),0)} punts totals</p></div></div>
      ${qs.map(q=>`<details class="card exam-question-edit"><summary><strong>${esc(q.position)}. ${esc(q.title)}</strong><span>${esc(q.max_score)} punts</span></summary><div class="exam-question-edit-body"><div class="exam-settings-grid"><label>Posició<input id="q-pos-${q.id}" type="number" min="1" value="${esc(q.position)}" ${locked?'disabled':''}></label><label>Punts<input id="q-score-${q.id}" type="number" min="0.1" step="0.1" value="${esc(q.max_score)}" ${locked?'disabled':''}></label><label>Títol<input id="q-title-${q.id}" value="${esc(q.title)}" ${locked?'disabled':''}></label></div><label>Enunciat<textarea id="q-statement-${q.id}" rows="5" ${locked?'disabled':''}>${esc(q.statement)}</textarea></label><label>Codi inicial<textarea id="q-starter-${q.id}" rows="7" ${locked?'disabled':''}>${esc(q.starter_code||'')}</textarea></label>${locked?'':`<div class="modal-actions"><button onclick="saveExamQuestion(${e.id},${q.id})">Desa exercici</button><button class="delete-btn" onclick="deleteExamQuestion(${e.id},${q.id})">Elimina</button></div>`}</div></details>`).join('')}
      ${locked?'':`<div class="card exam-new-question"><h3>＋ Afegeix exercici</h3><div class="exam-settings-grid"><label>Títol<input id="new-q-title"></label><label>Punts<input id="new-q-score" type="number" min="0.1" step="0.1" value="10"></label></div><label>Enunciat<textarea id="new-q-statement" rows="5"></textarea></label><label>Codi inicial (opcional)<textarea id="new-q-starter" rows="7"></textarea></label><button onclick="addExamQuestion(${e.id})">Afegeix l’exercici</button><p id="new-q-msg"></p></div>`}
      </section>`;
  }catch(e){alert(e.message);teacherExams()}
}
async function saveExamSettings(id){
  const msg=$('#exam-settings-msg');
  try{
    await api(`/api/teacher/exams/${id}`,{method:'PUT',body:JSON.stringify({
      title:$('#exam-title').value,description:$('#exam-description').value,
      start_at:fromLocalInput($('#exam-start').value),end_at:fromLocalInput($('#exam-end').value),
      duration_minutes:$('#exam-duration').value||null
    })});
    msg.textContent='✓ Configuració desada';msg.className='reset-success';
  }catch(e){msg.textContent=e.message;msg.className='error'}
}
async function setExamStatus(id,status){
  if(status==='closed'&&!confirm('Tancar l’examen? Els intents en curs quedaran lliurats quan es tornin a sincronitzar.'))return;
  try{
    await saveExamSettings(id);
    await api(`/api/teacher/exams/${id}/status`,{method:'POST',body:JSON.stringify({status})});
    await teacherEditExam(id);
  }catch(e){alert(e.message)}
}
async function deleteExam(id){
  if(!confirm('Eliminar definitivament aquest examen i els seus exercicis?'))return;
  try{await api(`/api/teacher/exams/${id}`,{method:'DELETE'});teacherExams()}catch(e){alert(e.message)}
}
async function addExamQuestion(examId){
  const msg=$('#new-q-msg');
  try{
    await api(`/api/teacher/exams/${examId}/questions`,{method:'POST',body:JSON.stringify({
      title:$('#new-q-title').value,statement:$('#new-q-statement').value,
      starter_code:$('#new-q-starter').value,max_score:$('#new-q-score').value
    })});
    await teacherEditExam(examId);
  }catch(e){msg.textContent=e.message;msg.className='error'}
}
async function saveExamQuestion(examId,qid){
  try{
    await api(`/api/teacher/exam-questions/${qid}`,{method:'PUT',body:JSON.stringify({
      position:$('#q-pos-'+qid).value,title:$('#q-title-'+qid).value,
      statement:$('#q-statement-'+qid).value,starter_code:$('#q-starter-'+qid).value,
      max_score:$('#q-score-'+qid).value
    })});
    await teacherEditExam(examId);
  }catch(e){alert(e.message)}
}
async function deleteExamQuestion(examId,qid){
  if(!confirm('Eliminar aquest exercici de l’examen?'))return;
  try{await api(`/api/teacher/exam-questions/${qid}`,{method:'DELETE'});teacherEditExam(examId)}catch(e){alert(e.message)}
}
function examAlertTotal(a){
  return Number(a.copy_paste_count||0)+Number(a.tab_hidden_count||0)+Number(a.fullscreen_exit_count||0)+Number(a.drop_multiline_count||0)+Number(a.network_attempt_count||0)+Number(a.large_insert_count||0);
}
async function teacherExamResults(examId){
  try{
    const d=await api(`/api/teacher/exams/${examId}/results`),e=d.exam,ats=d.attempts||[];
    $('#app').innerHTML=`<div class="teacher-head"><div><h1>${esc(e.title)} · Lliuraments</h1><p>${ats.length} intents registrats.</p></div><div class="teacher-actions"><button class="secondary" onclick="teacherEditExam(${e.id})">⚙ Configura</button><button class="secondary" onclick="teacherExams()">← Exàmens</button></div></div>
      <div class="exam-results-table-wrap"><table class="exam-results-table"><thead><tr><th>Alumne</th><th>Estat</th><th>Inici</th><th>Lliurament</th><th>Alertes</th><th>Nota</th><th></th></tr></thead><tbody>${ats.map(a=>{const alerts=examAlertTotal(a);return `<tr><td><strong>${esc(a.name)}</strong><small>${esc(a.email)}</small></td><td>${a.status==='graded'?'Corregit':a.status==='submitted'?'Lliurat':'En curs'}</td><td>${esc(fmtDateTime(a.started_at))}</td><td>${esc(fmtDateTime(a.submitted_at))}</td><td><span class="${alerts?'integrity-badge alert':'integrity-badge'}">${alerts}</span></td><td>${a.final_score==null?'—':esc(a.final_score)+'/10'}</td><td><button class="secondary" onclick="teacherGradeExamAttempt(${a.id})">${a.status==='in_progress'?'Veure':'Corregir'}</button></td></tr>`}).join('')||'<tr><td colspan="7">Encara no hi ha intents.</td></tr>'}</tbody></table></div>`;
  }catch(e){alert(e.message);teacherExams()}
}
function integrityEventLabel(type){
  return ({copy_paste:'ALERTA DE COPY-PASTE',tab_hidden:'Canvi de pestanya/finestra',fullscreen_exit:'Sortida de pantalla completa',drop_multiline:'Bloc multilínia arrossegat',network_attempt:'Intent d’accés extern bloquejat',large_insert:'Inserció massiva de text'})[type]||type;
}
async function teacherGradeExamAttempt(id){
  try{
    const d=await api(`/api/teacher/exam-attempts/${id}`),a=d.attempt,answers=new Map((d.answers||[]).map(x=>[Number(x.question_id),x])),editable=a.status!=='in_progress';
    const events=d.events||[];
    $('#app').innerHTML=`<div class="teacher-head"><div><h1>${esc(a.name)} · ${esc(a.exam_title)}</h1><p>${a.status==='graded'?'Examen corregit':a.status==='submitted'?'Examen lliurat':'Examen encara en curs'}</p></div><div class="teacher-actions"><button class="secondary" onclick="teacherExamResults(${a.exam_id})">← Lliuraments</button></div></div>
      ${events.length?`<section class="card integrity-panel"><h2>⚠ Registre d’integritat · ${events.length} alertes</h2><p>Aquest registre és un indicador per revisar; no prova per si sol l’ús d’IA.</p><div class="integrity-events">${events.map(ev=>{let meta={};try{meta=JSON.parse(ev.meta_json||'{}')}catch{}return `<div><strong>${esc(integrityEventLabel(ev.event_type))}</strong><span>${esc(fmtDateTime(ev.created_at))}${ev.question_id?' · exercici '+esc(ev.question_id):''}</span>${Object.keys(meta).length?`<small>${esc(JSON.stringify(meta))}</small>`:''}</div>`}).join('')}</div></section>`:'<div class="card integrity-clean">✓ No s’han registrat alertes d’integritat.</div>'}
      <div class="exam-grade-list">${d.questions.map((q,i)=>{const ans=answers.get(Number(q.id))||{};return `<article class="card exam-grade-question" data-question-id="${q.id}"><div class="exam-question-head"><div><span class="pill">Exercici ${i+1}</span><h2>${esc(q.title)}</h2></div><strong>${esc(q.max_score)} punts</strong></div><p>${esc(q.statement)}</p><h4>Codi lliurat</h4><pre>${esc(ans.code||'')}</pre>${ans.stdin?`<details><summary>Entrades de prova</summary><pre>${esc(ans.stdin)}</pre></details>`:''}<div class="exam-grade-controls"><label>Nota / ${esc(q.max_score)}<input class="exam-q-score" type="number" min="0" max="${esc(q.max_score)}" step="0.1" value="${esc(ans.score??'')}" ${editable?'':'disabled'}></label><label>Comentari<textarea class="exam-q-feedback" rows="3" ${editable?'':'disabled'}>${esc(ans.feedback||'')}</textarea></label></div></article>`}).join('')}</div>
      <section class="card exam-final-correction"><label>Comentari general<textarea id="exam-teacher-comment" rows="4" ${editable?'':'disabled'}>${esc(a.teacher_comment||'')}</textarea></label><div class="modal-actions">${editable?`<button onclick="saveExamGrade(${a.id})">✓ Desa la correcció</button>`:'<button disabled>Encara en curs</button>'}</div></section>`;
  }catch(e){alert(e.message)}
}
async function saveExamGrade(attemptId){
  const scores=[...document.querySelectorAll('.exam-grade-question')].map(card=>({
    question_id:Number(card.dataset.questionId),
    score:card.querySelector('.exam-q-score').value,
    feedback:card.querySelector('.exam-q-feedback').value
  }));
  try{
    const d=await api(`/api/teacher/exam-attempts/${attemptId}/grade`,{method:'POST',body:JSON.stringify({scores,teacher_comment:$('#exam-teacher-comment').value})});
    alert(`Correcció desada. Nota final: ${d.final_score}/10`);
    await teacherGradeExamAttempt(attemptId);
  }catch(e){alert(e.message)}
}
