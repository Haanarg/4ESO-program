let user=null, exercises=[], current=null, py=null, studentPreview=false, codeEditor=null, draftTimer=null, draftSaving=false, passwordResetCode=null, exerciseIntegrityPending=[];
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

const STUDENT_TRANSLATOR_LANGS=[
 ['ca','Català'],['es','Castellà'],['en','Anglès'],['fr','Francès'],['de','Alemany'],['it','Italià'],['pt','Portuguès'],
 ['ar','Àrab'],['ro','Romanès'],['uk','Ucraïnès'],['ru','Rus'],['zh','Xinès'],['ur','Urdú'],['hi','Hindi'],['bn','Bengalí'],['pa','Panjabi']
];
let studentTranslatorLastOutput='';

function studentTranslatorLanguageOptions(selected){
 return STUDENT_TRANSLATOR_LANGS.map(([code,name])=>`<option value="${code}" ${code===selected?'selected':''}>${esc(name)}</option>`).join('');
}
function studentTranslatorHtml(){
 return `<details class="student-translator" data-integrity-exempt="true">
  <summary>🌐 Traductor <span>opcional</span></summary>
  <div class="student-translator-body">
   <div class="student-translator-langs">
    <label>Idioma d’entrada<select id="translator-source">${studentTranslatorLanguageOptions('ca')}</select></label>
    <button class="secondary translator-swap" type="button" onclick="swapStudentTranslator()" title="Intercanvia idiomes">⇄</button>
    <label>Idioma de sortida<select id="translator-target">${studentTranslatorLanguageOptions('es')}</select></label>
   </div>
   <div class="student-translator-actions">
    <button class="secondary" type="button" onclick="loadStatementIntoTranslator()">Carrega l’enunciat</button>
    <button type="button" onclick="translateStudentText()">Tradueix</button>
   </div>
   <label>Text d’entrada<textarea id="translator-input" rows="4" spellcheck="true"></textarea></label>
   <label>Traducció<textarea id="translator-output" rows="4" readonly></textarea></label>
   <div class="student-translator-footer"><span id="translator-status"></span><button class="secondary mini-btn" type="button" onclick="copyStudentTranslation()">⧉ Copia traducció</button></div>
  </div>
 </details>`;
}
function currentStatementForTranslator(){
 if(typeof examMode!=='undefined' && examMode && examSession?.questions?.length){
  return String(examSession.questions[examQuestionIndex]?.statement||'');
 }
 return String(current?.statement||'');
}
function loadStatementIntoTranslator(){
 const input=$('#translator-input'),status=$('#translator-status');
 if(!input)return;
 input.value=currentStatementForTranslator();
 if(status){status.textContent='Enunciat carregat';status.className='muted'}
}
function normalizeTranslatorText(v){return String(v||'').replace(/\r\n?/g,'\n').replace(/\n$/,'')}
function translatorOutputLooksLikeCode(text){
 const lines=normalizeTranslatorText(text).split('\n').filter(x=>x.trim());
 if(lines.length<=1)return false;
 const commentsOnly=lines.every(x=>/^\s*#/.test(x));
 if(commentsOnly)return false;
 return lines.some(x=>/^\s*(?:def\b|class\b|if\b|elif\b|else\s*:|for\b|while\b|try\s*:|except\b|import\b|from\b|return\b|print\s*\(|input\s*\(|[A-Za-z_]\w*\s*=)/.test(x));
}
function isStudentTranslatorPaste(lines){
 const pasted=normalizeTranslatorText(Array.isArray(lines)?lines.join('\n'):lines);
 return !!studentTranslatorLastOutput
  && pasted===normalizeTranslatorText(studentTranslatorLastOutput)
  && !translatorOutputLooksLikeCode(pasted);
}
async function translateStudentText(){
 const input=$('#translator-input'),output=$('#translator-output'),status=$('#translator-status');
 if(!input||!output||!status)return;
 const text=input.value,source=$('#translator-source')?.value,target=$('#translator-target')?.value;
 if(!text.trim()){status.textContent='Escriu o carrega un text.';status.className='error';return}
 status.textContent='Traduint…';status.className='muted';
 try{
  const d=await api('/api/translate',{method:'POST',body:JSON.stringify({text,source_lang:source,target_lang:target})});
  studentTranslatorLastOutput=String(d.translated_text||'');
  output.value=studentTranslatorLastOutput;
  status.textContent='✓ Traducció preparada';status.className='reset-success';
 }catch(e){status.textContent=e.message;status.className='error'}
}
function swapStudentTranslator(){
 const source=$('#translator-source'),target=$('#translator-target'),input=$('#translator-input'),output=$('#translator-output');
 if(!source||!target)return;
 const lang=source.value;source.value=target.value;target.value=lang;
 if(input&&output&&output.value){
  const txt=input.value;input.value=output.value;output.value=txt;
  studentTranslatorLastOutput=output.value;
 }
}
async function copyStudentTranslation(){
 const output=$('#translator-output'),status=$('#translator-status');
 if(!output?.value)return;
 try{
  await navigator.clipboard.writeText(output.value);
  studentTranslatorLastOutput=output.value;
  if(status){status.textContent='✓ Traducció copiada';status.className='reset-success'}
 }catch{
  output.focus();output.select();
  document.execCommand?.('copy');
  studentTranslatorLastOutput=output.value;
  if(status){status.textContent='✓ Traducció copiada';status.className='reset-success'}
 }
}

function nav(){
  if(typeof examMode!=='undefined' && examMode && user){
    $('#nav').innerHTML=`<span class="exam-nav-lock">🔒 Mode examen · ${esc(user.name)}</span>`;
    return;
  }
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

function recoveryCodePage(){
  passwordResetCode=null;
  $('#app').innerHTML=`<div class="card auth reset-auth"><h1>Programació 4ESO</h1><h2>Recupera la contrasenya</h2><p>Demana al professor un codi temporal de recuperació i escriu-lo aquí.</p><label>Codi de recuperació<input id="recovery-code" class="recovery-code-input" autocomplete="one-time-code" maxlength="12" placeholder="ABCDE-FGHIJ"></label><button id="recovery-check" onclick="validateRecoveryCode()">Continua</button> <button class="secondary" onclick="login()">← Torna</button><p id="recovery-msg"></p></div>`;
  setTimeout(()=>$('#recovery-code')?.focus(),0);
}

async function validateRecoveryCode(){
  const input=$('#recovery-code'),msg=$('#recovery-msg'),btn=$('#recovery-check');
  const code=String(input?.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(code.length!==10){msg.textContent='El codi ha de tenir 10 caràcters.';msg.className='error';return}
  btn.disabled=true;btn.textContent='Comprovant…';msg.textContent='';
  try{
    const d=await api('/api/password-reset/validate-code',{method:'POST',body:JSON.stringify({code})});
    passwordResetCode=code;
    $('#app').innerHTML=`<div class="card auth reset-auth"><h1>Programació 4ESO</h1><h2>Nova contrasenya</h2><p>El codi correspon al compte de <strong>${esc(d.name||'alumne')}</strong>.</p><label>Nova contrasenya<input id="reset-pw" type="password" minlength="6" autocomplete="new-password" placeholder="Mínim 6 caràcters"></label><label>Repeteix la contrasenya<input id="reset-pw2" type="password" minlength="6" autocomplete="new-password" placeholder="Repeteix-la"></label><button id="reset-submit" onclick="completePasswordReset()">Canvia la contrasenya</button> <button class="secondary" onclick="recoveryCodePage()">← Canvia de codi</button><p id="reset-msg"></p></div>`;
    setTimeout(()=>$('#reset-pw')?.focus(),0);
  }catch(e){msg.textContent=e.message;msg.className='error';btn.disabled=false;btn.textContent='Continua'}
}

async function completePasswordReset(){
  const pw=$('#reset-pw')?.value||'',pw2=$('#reset-pw2')?.value||'',msg=$('#reset-msg'),btn=$('#reset-submit');
  if(!passwordResetCode){recoveryCodePage();return}
  if(pw.length<6){msg.textContent='La contrasenya ha de tenir com a mínim 6 caràcters.';msg.className='error';return}
  if(pw!==pw2){msg.textContent='Les dues contrasenyes no coincideixen.';msg.className='error';return}
  btn.disabled=true;btn.textContent='Actualitzant…';msg.textContent='';
  try{
    await api('/api/password-reset/complete-code',{method:'POST',body:JSON.stringify({code:passwordResetCode,password:pw})});
    passwordResetCode=null;
    $('#app').innerHTML='<div class="card auth reset-auth"><h1>Programació 4ESO</h1><h2>Contrasenya actualitzada</h2><p class="reset-success">✓ Ja pots iniciar sessió amb la nova contrasenya. El codi de recuperació ja no es pot tornar a utilitzar.</p><button onclick="login()">Inicia sessió</button></div>';
  }catch(e){msg.textContent=e.message;msg.className='error';btn.disabled=false;btn.textContent='Canvia la contrasenya'}
}

function login(){
  $('#app').innerHTML=`<div class="card auth"><h1>Programació 4ESO</h1><h2>Inicia sessió</h2><input id="email" type="email" placeholder="Correu electrònic"><input id="pw" type="password" placeholder="Contrasenya"><button onclick="doLogin()">Entrar</button> <button class="secondary" onclick="register()">Crear compte</button><button class="secondary recovery-login-btn" onclick="recoveryCodePage()">🔑 Tinc un codi de recuperació</button><p id="msg"></p></div>`;
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



function closeResetCodeModal(){
  document.querySelector('.reset-code-overlay')?.remove();
}

async function copyRecoveryCode(code){
  try{
    await navigator.clipboard.writeText(code);
    const b=$('#copy-reset-code');
    if(b){const old=b.textContent;b.textContent='✓ Copiat';setTimeout(()=>b.textContent=old,1400)}
  }catch{
    prompt('Copia aquest codi:',code);
  }
}

async function generatePasswordReset(id){
  const ok=confirm('Generar un codi temporal de recuperació per a aquest alumne?\n\nQualsevol codi anterior quedarà invalidat.');
  if(!ok)return;
  const btn=$(`#reset-pass-${id}`),old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Generant…'}
  try{
    const d=await api(`/api/teacher/students/${id}/password-reset`,{method:'POST',body:'{}'});
    const overlay=document.createElement('div');
    overlay.className='modal-overlay reset-code-overlay';
    overlay.innerHTML=`<div class="student-modal card reset-code-modal"><div class="modal-title"><div><h2>Codi de recuperació</h2><p class="muted">Per a <strong>${esc(d.name||'l’alumne')}</strong></p></div><button class="modal-close" aria-label="Tancar" onclick="closeResetCodeModal()">×</button></div><p>Dona aquest codi a l’alumne. Caduca en <strong>${Number(d.expires_minutes)||15} minuts</strong> i només es pot utilitzar una vegada.</p><div class="reset-code-display">${esc(d.code)}</div><div class="reset-code-warning">Generar un altre codi invalidarà aquest immediatament.</div><div class="modal-actions"><button id="copy-reset-code" onclick='copyRecoveryCode(${JSON.stringify(d.code)})'>⧉ Copia codi</button><button class="secondary" onclick="closeResetCodeModal()">Tanca</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.onclick=e=>{if(e.target===overlay)closeResetCodeModal()};
  }catch(e){
    alert(`No s'ha pogut generar el codi: ${e.message}`);
  }finally{
    if(btn){btn.disabled=false;btn.textContent=old||'🔑 Codi'}
  }
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


function teacherProgressCorrectionLink(submission,studentId,origin,label,cssClass,title){
  return '<button type="button" class="progress-correction-link '+cssClass+'" title="'+esc(title||'Obre la correcció')+'" onclick="teacherOpenSubmissionCorrection('+Number(submission.id)+','+Number(studentId)+',\''+origin+'\')">'+label+'</button>';
}
let teacherCorrectionReturn={studentId:null,origin:'progress'},teacherCorrectionProposal=null;
function teacherLeaveSubmissionCorrection(){
  if(teacherCorrectionReturn.origin==='detail'&&teacherCorrectionReturn.studentId!=null)
    return teacherStudentDetail(teacherCorrectionReturn.studentId);
  return teacherProgress();
}
function teacherSubmissionAiSummary(ai){
  if(!ai||typeof ai!=='object'||Object.keys(ai).length===0)return '<p class="muted">No hi ha cap proposta d’IA desada.</p>';
  const hasScore=ai.score!=null&&Number.isFinite(Number(ai.score));
  const criteria=Array.isArray(ai.criteria)?ai.criteria:[];
  return '<div class="teacher-regrade-ai">'+
    '<div class="teacher-regrade-ai-header"><strong>Proposta IA: '+(hasScore?esc(ai.score)+'/10':'—')+'</strong>'+
    (hasScore?'<button type="button" class="secondary" onclick="teacherApplyCorrectionProposal()">✓ Aplica la proposta</button>':'')+'</div>'+
    '<p>'+esc(ai.feedback||'Sense comentari')+'</p>'+
    (criteria.length?'<ul>'+criteria.map(c=>'<li><strong>'+esc(c.name)+': '+esc(c.score)+'/'+esc(c.max)+'</strong> — '+esc(c.reason||'')+'</li>').join('')+'</ul>':'')+
    (ai.teacher_feedback?'<p><strong>Informe per al professor:</strong> '+esc(ai.teacher_feedback)+'</p>':'')+
    (ai.teacher_warning?'<p class="ai-warning"><strong>⚠ Revisió recomanada:</strong> '+esc(ai.teacher_warning)+'</p>':'')+'</div>';
}
async function teacherOpenSubmissionCorrection(id,studentId=null,origin='progress'){
  if(!user||user.role!=='teacher')return;
  teacherCorrectionReturn={studentId:studentId==null?null:Number(studentId),origin:origin==='detail'?'detail':'progress'};
  try{
    const d=await api('/api/teacher/submissions/'+Number(id)),s=d.submission;
    if(!s)throw Error('Entrega no trobada.');
    let rubric=[],ai={};
    try{rubric=JSON.parse(s.rubric_json||'[]')}catch{}
    try{ai=JSON.parse(s.ai_result_json||'{}')}catch{}
    teacherCorrectionProposal=ai;
    const returned=s.status==='returned',validated=s.status==='validated',pending=!returned&&!validated;
    const note=returned?s.returned_score:s.final_score;
    const inputValue=note!=null?note:(pending&&ai.score!=null?ai.score:'');
    const integrity=Array.isArray(s.integrity_events)?s.integrity_events:[];
    $('#app').innerHTML='<div class="teacher-head teacher-regrade-header"><div>'+
      '<h1>Revisió de la correcció</h1><p>'+esc(s.student_name)+' · '+esc(s.exercise_code)+' · '+esc(s.title)+'</p>'+
      '<span class="status '+(returned?'returned':validated?'ok':'pending')+'">'+(returned?'↩ Retornada':validated?'✓ Validada':'Pendent')+'</span>'+
      '</div><div class="teacher-actions"><button class="secondary" onclick="teacherLeaveSubmissionCorrection()">← Torna al seguiment</button></div></div>'+
      '<div class="teacher-regrade-layout"><section class="card teacher-regrade-work">'+
      '<h2>Enunciat</h2><p class="teacher-regrade-statement">'+esc(s.statement||'')+'</p>'+
      (Array.isArray(rubric)&&rubric.length?'<details><summary>Rúbrica</summary><ul>'+rubric.map(x=>'<li>'+esc(x[0])+': '+esc(x[1])+' punts</li>').join('')+'</ul></details>':'')+
      (s.starter_code?'<details><summary>Codi inicial que rebia l’alumne</summary><pre>'+esc(s.starter_code)+'</pre></details>':'')+
      '<h2>Codi lliurat</h2><pre class="teacher-regrade-code">'+esc(s.student_code||'')+'</pre>'+
      (integrity.length?'<details class="normal-integrity-panel"><summary>⚠ Alertes d’integritat ('+integrity.length+')</summary><ul>'+integrity.map(ev=>'<li><strong>'+esc(exerciseIntegrityReason(ev))+'</strong> '+esc(exerciseIntegrityTime(ev))+'</li>').join('')+'</ul></details>':'')+
      '</section><section class="card teacher-regrade-side"><h2>Correcció</h2>'+
      '<p class="muted">Modifica la nota i els comentaris o demana una altra proposta a la IA. La nova anàlisi no canvia la nota del professor.</p>'+
      '<button id="teacher-regrade-ai-btn" class="secondary" onclick="teacherRepeatCorrectionAI('+Number(s.id)+')">✨ Torna a corregir amb IA</button>'+
      '<div id="teacher-regrade-ai-result">'+teacherSubmissionAiSummary(ai)+'</div>'+
      '<div class="teacher-regrade-fields"><label>Nota '+(returned?'de l’intent retornat':'')+' (/10)<input id="teacher-regrade-score" type="number" step="0.1" min="0" max="10" value="'+esc(inputValue)+'"></label>'+
      '<label>Comentari del professor<textarea id="teacher-regrade-comment" rows="6" maxlength="4000">'+esc(s.teacher_comment||'')+'</textarea></label></div>'+
      (returned?'<p class="teacher-regrade-notice">L’intent continuarà <strong>retornat</strong> encara que canviïs la nota. L’alumne podrà repetir l’exercici.</p>':
       pending?'<p class="teacher-regrade-notice">En desar, l’intent pendent quedarà validat.</p>':'')+
      '<div class="teacher-regrade-actions"><button id="teacher-regrade-save" onclick="teacherSaveCorrection('+Number(s.id)+')">💾 Desa '+(returned?'la revisió':'la nota')+'</button><button class="secondary" onclick="teacherLeaveSubmissionCorrection()">Cancel·la</button></div>'+
      '<p id="teacher-regrade-message" role="status"></p></section></div>';
  }catch(e){
    $('#app').innerHTML='<div class="card"><h1>Revisió de la correcció</h1><p class="error">'+esc(e.message)+'</p><button class="secondary" onclick="teacherLeaveSubmissionCorrection()">← Torna al seguiment</button></div>';
  }
}
function teacherApplyCorrectionProposal(){
  const ai=teacherCorrectionProposal;
  if(!ai||ai.score==null||!Number.isFinite(Number(ai.score)))return;
  const score=$('#teacher-regrade-score'),comment=$('#teacher-regrade-comment');
  if(!score||!comment)return;
  if((score.value.trim()!==''&&Number(score.value)!==Number(ai.score))||
     (comment.value.trim()&&comment.value.trim()!==String(ai.feedback||'').trim())){
    if(!confirm('Vols substituir la nota i el comentari dels camps per la proposta de la IA?'))return;
  }
  score.value=String(ai.score);comment.value=String(ai.feedback||'');
  const msg=$('#teacher-regrade-message');
  if(msg){msg.textContent='Proposta aplicada. Revisa-la i prem Desa per conservar els canvis.';msg.className='muted';}
}
async function teacherRepeatCorrectionAI(id){
  if(!confirm('Tornar a analitzar el codi amb Workers AI? Consumirà quota gratuïta, però no canviarà la nota del professor.'))return;
  const btn=$('#teacher-regrade-ai-btn'),msg=$('#teacher-regrade-message');
  if(!btn||!msg)return;
  btn.disabled=true;btn.textContent='Analitzant…';
  msg.textContent='Analitzant el codi lliurat…';msg.className='muted';
  try{
    const d=await api('/api/teacher/submissions/'+Number(id)+'/regrade-ai',{method:'POST',body:'{}'});
    teacherCorrectionProposal=d.ai;
    const panel=$('#teacher-regrade-ai-result');
    if(panel)panel.innerHTML=teacherSubmissionAiSummary(d.ai);
    msg.textContent='✓ Nova proposta preparada. La nota del professor no ha canviat.';msg.className='reset-success';
  }catch(e){msg.textContent=e.message;msg.className='error';}
  finally{btn.disabled=false;btn.textContent='✨ Torna a corregir amb IA';}
}
async function teacherSaveCorrection(id){
  const raw=String($('#teacher-regrade-score')?.value??'').trim(),comment=$('#teacher-regrade-comment')?.value||'';
  const result=$('#teacher-regrade-message'),btn=$('#teacher-regrade-save');
  if(!result||!btn)return;
  if(raw!==''&&(!Number.isFinite(Number(raw))||Number(raw)<0||Number(raw)>10)){
    result.textContent='La nota ha d’estar entre 0 i 10.';result.className='error';return;
  }
  btn.disabled=true;result.textContent='Desant…';result.className='muted';
  try{
    const d=await api('/api/teacher/submissions/'+Number(id),{method:'POST',body:JSON.stringify({action:'revise',score:raw===''?null:Number(raw),comment})});
    const back={...teacherCorrectionReturn};
    await teacherOpenSubmissionCorrection(id,back.studentId,back.origin);
    const message=$('#teacher-regrade-message');
    if(message){message.textContent=d.status==='returned'?'✓ Revisió desada. L’intent continua retornat.':'✓ Qualificació actualitzada.';message.className='reset-success';}
  }catch(e){result.textContent=e.message;result.className='error';btn.disabled=false;}
}
function filterProgressChapter(){const v=$('#progress-chapter')?.value||'all';document.querySelectorAll('.progress-table [data-chapter]').forEach(x=>x.style.display=(v==='all'||x.dataset.chapter===v)?'':'none')}
async function teacherStudentDetail(id){
 const d=await api(`/api/teacher/students/${id}/progress`),{student,exercises:exs,submissions:subs,drafts}=d,byEx={};for(const s of subs)(byEx[s.exercise_id]??=[]).push(s);
 const val=subs.filter(s=>s.status==='validated'&&s.final_score!=null),avg=val.length?(val.reduce((x,s)=>x+Number(s.final_score),0)/val.length).toFixed(1):'—',chs=[...new Set(exs.map(e=>e.chapter))];
 $('#app').innerHTML=`<section class="card student-detail"><div class="progress-toolbar"><div><h1>${esc(student.name)}</h1><p class="muted">${esc(student.email)}</p></div><div class="student-detail-actions"><button id="reset-pass-${student.id}" class="secondary" onclick="generatePasswordReset(${student.id})">🔑 Genera codi</button><button class="secondary" onclick="teacherProgress()">← Seguiment</button></div></div><div class="student-kpis"><div><strong>${val.length}/${exs.length}</strong><span>Tasques validades</span></div><div><strong>${avg}${avg!=='—'?'/10':''}</strong><span>Mitjana validada</span></div><div><strong>${drafts.length}</strong><span>Esborranys</span></div></div><div class="chapter-summary">${chs.map(ch=>{const ce=exs.filter(e=>e.chapter===ch),n=ce.filter(e=>(byEx[e.id]||[]).some(s=>s.status==='validated'&&s.final_score!=null)).length;return `<div><strong>Capítol ${ch}</strong><span>${n}/${ce.length}</span><div class="mini-progress"><i style="width:${ce.length?Math.round(n*100/ce.length):0}%"></i></div></div>`}).join('')}</div><h2>Historial d'entregues</h2>${exs.map(e=>{const arr=byEx[e.id]||[];return arr.length?`<div class="student-exercise-history"><h3>${esc(e.code)} · ${esc(e.title)}</h3>${arr.map((s,i)=>{const n=s.final_score??s.returned_score;return `<div class="history-line"><span>Intent ${i+1}</span><span>${esc(s.submitted_at)}</span><strong>${teacherProgressCorrectionLink(s,student.id,'detail',n!=null?esc(n)+'/10':'Corregir','history-correction-button',s.status==='returned'?'Reobre la correcció de l’intent retornat':'Reobre la correcció d’aquest intent')}</strong><span>${s.status==='validated'?'Validat':s.status==='returned'?'Retornat':'Pendent'}</span>${s.teacher_comment?`<p>💬 ${esc(s.teacher_comment)}</p>`:''}</div>`}).join('')}</div>`:''}).join('')||'<p>Encara no hi ha entregues.</p>'}</section>`;
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
      return teacherProgressCorrectionLink(s,student.id,'progress',esc(s.final_score),'progress-grade '+(n>=5?'pass':'fail'),'Reobre la correcció i modifica la nota');
    }
    if(s?.status==='pending') return teacherProgressCorrectionLink(s,student.id,'progress','Pendent','progress-state pending','Obre i valida aquesta entrega');
    if(s?.status==='returned'){
      const label=s.returned_score==null?'↩ Retorn':'↩ '+esc(s.returned_score);
      return teacherProgressCorrectionLink(s,student.id,'progress',label,'progress-state returned','Obre la correcció retornada i modifica la nota')+
        (dr?'<small class="progress-draft-indicator">Esborrany nou</small>':'');
    }
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
        <div><h1>Seguiment dels alumnes</h1><p class="muted">Darrera situació de cada tasca. Clica una nota (també una retornada) per reobrir-ne la correcció, o un alumne per veure'n l'historial.</p></div>
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
              <th class="student-col"><div class="student-identity"><div class="student-open" onclick="teacherStudentDetail(${st.id})"><strong>${esc(st.name)}</strong><small>${esc(st.email)}</small></div><div class="student-row-actions"><button class="mini-btn" title="Editar alumne" onclick='editStudent(${JSON.stringify(st)})'>✏ Edita</button><button id="reset-pass-${st.id}" class="mini-btn reset-password-btn" title="Genera un codi temporal per restablir la contrasenya" onclick="generatePasswordReset(${st.id})">🔑 Codi</button><button class="mini-btn delete-student-btn" title="Eliminar alumne" onclick='deleteStudent(${st.id},${JSON.stringify(st.name)})'>🗑</button></div></div></th>
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
 if(typeof examMode!=='undefined' && examMode){ if(typeof renderExamQuestion==='function' && examSession) renderExamQuestion(); return; }
 const names={1:'Sortida (output)',2:'Assignació de Variables',3:'Entrada (Input)',4:'Calcular',5:'Selecció IF ELSE',6:'Selecció ELIF',7:'Iteracions',8:'Llistes',9:'Subrutines',10:'Criptografia',11:'Input Loop Adventure Game',12:'Personal Database'};
 const md=COURSE_THEORY?.[chapter]||COURSE_THEORY?.[String(chapter)]||'';
 $('#app').innerHTML=`${studentPreview?`<div class="preview-banner compact"><strong>👁 Vista d'alumne</strong><button class="secondary" onclick="exitStudentPreview()">← Panell professor</button></div>`:''}<article class="card theory-page"><div class="theory-eyebrow">📖 Teoria · Capítol ${chapter}</div><div class="theory-content">${renderTheory(md)}</div><div class="theory-footer"><button class="secondary" onclick="dashboard()">← Índex del curs</button><button onclick="openFirstExercise(${chapter})">Comença els exercicis →</button></div></article>`;
 window.scrollTo({top:0,behavior:'smooth'});
}
function openFirstExercise(chapter){if(typeof examMode!=='undefined'&&examMode){if(typeof renderExamQuestion==='function'&&examSession)renderExamQuestion();return}const e=exercises.find(x=>x.chapter===chapter);if(e)openExercise(e.id);else dashboard()}
async function dashboard(){
 if(typeof examCleanup==='function' && typeof examMode!=='undefined' && examMode) examCleanup();
 let examItems=[];
 if(!studentPreview && user?.role==='student'){
   try{
     examItems=(await api('/api/exams/available')).exams||[];
     const activeAttempt=examItems.find(e=>e.attempt?.status==='in_progress');
     if(activeAttempt && typeof openExam==='function') return openExam(activeAttempt.id);
   }catch{}
 }
 const d=await api('/api/exercises'); exercises=d.exercises;
 const chapterNames={1:'Sortida (output)',2:'Assignació de Variables',3:'Entrada (Input)',4:'Calcular',5:'Selecció IF ELSE',6:'Selecció ELIF',7:'Iteracions',8:'Llistes',9:'Subrutines',10:'Criptografia',11:'Input Loop Adventure Game',12:'Personal Database'};
 const last={},drafts={};
 try{const x=await api('/api/my-submissions');for(const s of x.submissions)if(!last[s.exercise_id])last[s.exercise_id]=s;if(!studentPreview){const dr=await api('/api/my-drafts');for(const x of dr.drafts||[])drafts[x.exercise_id]=x}}catch{}
 const done=e=>last[e.id]?.status==='validated'&&last[e.id]?.final_score!=null;
 const n=exercises.filter(done).length,pct=exercises.length?Math.round(n*100/exercises.length):0;
 $('#app').innerHTML=`${studentPreview?"<div class=\"preview-banner\"><strong>👁 Vista d'alumne</strong><span>Estàs previsualitzant el curs. Pots executar exercicis, però no entregar-los.</span><button class=\"secondary\" onclick=\"exitStudentPreview()\">← Tornar al panell del professor</button></div>":''}${typeof studentExamCards==='function'?studentExamCards(examItems):''}<div class="course-heading"><div><h1>Programació 4ESO</h1><p>Recorregut de Python: dels primers print() fins als projectes finals.</p></div><strong>${n}/${exercises.length} tasques · ${pct}%</strong></div><div class="course-progress"><span style="width:${pct}%"></span></div><div id="list"></div>`;
 for(const chapter of Object.keys(chapterNames).map(Number)){
  const ce=exercises.filter(x=>x.chapter===chapter);if(!ce.length)continue;const cd=ce.filter(done).length,symbol=cd===ce.length?'✓':cd?'●':'○';
  $('#list').insertAdjacentHTML('beforeend',`<h2 class="chapter-title"><span>${symbol} Capítol ${chapter}: ${esc(chapterNames[chapter])}</span><small>${cd}/${ce.length}</small></h2>`);
  $('#list').insertAdjacentHTML('beforeend',`<div class="card theory-card" onclick="openTheory(${chapter})"><div class="theory-card-icon">📖</div><div><span class="pill theory-pill">TEORIA</span><h3>Teoria · ${esc(chapterNames[chapter])}</h3><p>Conceptes, explicacions i exemples del curs original abans de començar els exercicis.</p></div><span class="theory-arrow">→</span></div>`);
  ce.forEach(x=>{const sub=last[x.id];const status=sub?.status==='returned'?'<span class="status returned">↩ Retornada</span>':sub?.final_score!=null?`<span class="status ok">Nota validada: ${esc(sub.final_score)}/10</span>`:sub?.ai_result_json?'<span class="status pending">Pendent de validació</span>':drafts[x.id]?'<span class="status draft">💾 Esborrany desat</span>':'';const note=sub?.teacher_comment?`<div class="dashboard-teacher-note">💬 ${esc(sub.teacher_comment)}</div>`:'';$('#list').insertAdjacentHTML('beforeend',`<div class="card exercise" onclick="openExercise(${x.id})"><span class="pill">${esc(x.type)}</span><h3>${esc(x.code)} · ${esc(x.title)}</h3><p>${esc(x.statement.slice(0,220))}${x.statement.length>220?'…':''}</p>${status}${note}</div>`);});
 }
}
function exerciseIntegrityEvent(eventType,meta={}){
  if(studentPreview||!current?.id)return Promise.resolve();
  const p=api(`/api/exercises/${current.id}/integrity-event`,{
    method:'POST',
    body:JSON.stringify({event_type:eventType,meta})
  }).catch(()=>null);
  exerciseIntegrityPending.push(p);
  return p;
}
async function flushExerciseIntegrity(){
  const pending=exerciseIntegrityPending.splice(0);
  if(pending.length)await Promise.allSettled(pending);
}

async function openExercise(id){
 if(typeof examMode!=='undefined' && examMode){ if(typeof renderExamQuestion==='function' && examSession) renderExamQuestion(); return; }
 exerciseIntegrityPending=[];
 if(draftTimer){clearTimeout(draftTimer);draftTimer=null} current=await api(`/api/exercises/${id}`);
 let savedDraft=null,history=[];if(!studentPreview){try{savedDraft=(await api(`/api/exercises/${id}/draft`)).draft}catch{}try{history=(await api('/api/my-submissions')).submissions.filter(s=>s.exercise_id===id)}catch{}}
 let rubric=[];try{rubric=JSON.parse(current.rubric_json||'[]')}catch{}
 const attempts=history.map((s,i)=>{const n=s.final_score??s.returned_score,state=s.status==='validated'?'Validat':s.status==='returned'?'Retornat':'Pendent';return `<div class="attempt-row"><span>Intent ${history.length-i}</span><strong>${n!=null?esc(n)+'/10':'—'}</strong><span>${state}</span>${s.teacher_comment?`<p>💬 ${esc(s.teacher_comment)}</p>`:''}</div>`}).join('');
 const latestSubmission=history[0]||null;
 const isReturned=!studentPreview && latestSubmission?.status==='returned';
 const submissionLocked=!studentPreview && latestSubmission && !isReturned;
 const submitLabel=submissionLocked?'✓ Enviat':isReturned?'✓ Enviar nou intent':'✓ Entregar';
 // Ignore only the untouched, automatically saved legacy 9.4 solution.
 const legacySolved94=current.code==='9.4' && savedDraft?.code?.length===1068 && savedDraft.code.startsWith('#Define four functions - add, subtract, multiply, divide') && savedDraft.code.endsWith('print(outputNum)');
 const editorCode=isReturned ? latestSubmission.code : (legacySolved94?current.starter_code:(savedDraft?.code??current.starter_code));
 const returnedFeedback=isReturned?`<div class="returned-feedback"><div><span class="status returned">↩ Retornada</span><h3>Comentaris del professor</h3></div><p>${latestSubmission.teacher_comment?esc(latestSubmission.teacher_comment):'El professor ha retornat aquesta tasca perquè la puguis revisar i tornar a enviar.'}</p>${latestSubmission.returned_score!=null?`<small>Nota de l'intent retornat: ${esc(latestSubmission.returned_score)}/10</small>`:''}</div>`:'';
 $('#app').innerHTML=`${studentPreview?"<div class=\"preview-banner compact\"><strong>👁 Vista d'alumne</strong><button class=\"secondary\" onclick=\"exitStudentPreview()\">← Panell professor</button></div>":''}<div id="exercise-layout" class="grid ide-layout"><section id="statement-panel" class="card statement-panel"><div class="statement-head"><span class="pill">${esc(current.type)}</span><button class="collapse-statement secondary" onclick="toggleStatement()">◀ Amaga enunciat</button></div><h1>${esc(current.code)} · ${esc(current.title)}</h1><p id="exercise-statement" class="statement">${esc(current.statement)}</p>${studentTranslatorHtml()}<h3>Criteris</h3><ul>${rubric.map(x=>`<li>${esc(x[0])}: ${esc(x[1])} punts</li>`).join('')}</ul>${attempts?`<details class="attempt-history"><summary>Historial d'intents (${history.length})</summary>${attempts}</details>`:''}<button class="secondary" onclick="dashboard()">← Tornar</button></section><section class="card python-workspace">${returnedFeedback}<div class="editor-heading"><h2>Editor Python</h2>${studentPreview?'':`<span id="draft-status" class="draft-status">${isReturned?'↩ Codi de l’intent recuperat':savedDraft?'✓ Esborrany recuperat':'Desament automàtic actiu'}</span>`}</div><textarea id="code" spellcheck="false">${esc(editorCode)}</textarea><div class="program-input-panel"><label for="stdin">⌨ Entrades del programa (<code>input()</code>)</label><p>Escriu aquí les respostes <strong>abans de prémer Executar</strong>, una per línia i en el mateix ordre que les demana el programa.</p><textarea id="stdin" class="stdin" rows="3" spellcheck="false" placeholder="Exemple:&#10;Gaspar&#10;15"></textarea></div><div class="editor-actions"><button class="run-primary" onclick="runCode()">▶ Executar</button>${studentPreview?'':`<button class="save-subtle secondary" onclick="saveDraft(true)">💾 Desa ara</button>`}<button id="submit-btn" class="submit-final ${submissionLocked?'submitted-lock':''}" onclick="submitCode()" ${(studentPreview||submissionLocked)?'disabled':''} title="${submissionLocked?'Aquest exercici ja està enviat. Es reactivarà si el professor el retorna.':''}">${submitLabel}</button></div><div class="output-heading"><h3>Sortida</h3><small>La pots redimensionar verticalment</small></div><div id="output" class="output resizable-output"></div><div id="grade"></div></section></div>`;
 codeEditor=CodeMirror.fromTextArea($('#code'),{mode:{name:'python',version:3,singleLineStringErrors:false},lineNumbers:true,indentUnit:4,tabSize:4,indentWithTabs:false,lineWrapping:false,viewportMargin:Infinity,autofocus:true,extraKeys:{Tab:cm=>cm.replaceSelection('    ','end')}});
 codeEditor.setSize('100%','clamp(540px,70vh,860px)');
 if(!studentPreview){
  codeEditor.on('change',()=>{const st=$('#draft-status');if(st){st.textContent='Canvis pendents…';st.className='draft-status pending-save'}if(draftTimer)clearTimeout(draftTimer);draftTimer=setTimeout(()=>saveDraft(false),1800)});
  if(!submissionLocked){
   codeEditor.on('beforeChange',(cm,change)=>{
    if(change.origin==='paste' && Array.isArray(change.text) && change.text.length>1 && !isStudentTranslatorPaste(change.text)){
     exerciseIntegrityEvent('copy_paste',{lines:change.text.length,chars:change.text.join('\n').length,area:'editor'});
    }
   });
   const statement=$('#exercise-statement');
   if(statement)statement.addEventListener('copy',()=>{
    const selected=String(window.getSelection()?.toString()||'');
    if(selected.trim().length<20)return;
    exerciseIntegrityEvent('statement_copy',{
     chars:selected.length,
     near_full_statement:selected.length>=String(current.statement||'').length*.8
    });
   });
  }
 }
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

function inputValues(){ const v=$('#stdin')?.value||'';return v===''?[]:v.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n'); }

function pythonWrapper(code, inputs, showInput=false){
  return `import io, contextlib, builtins\n__out=io.StringIO()\n__values=iter(${JSON.stringify(inputs)})\n__show_input=${showInput?'True':'False'}\n__old_input=builtins.input\ndef __fake_input(prompt=''):\n try: val=next(__values)\n except StopIteration: raise EOFError('Falten entrades per a input(): escriu una resposta per línia al quadre Entrades del programa')\n if __show_input:\n  print(prompt+val)\n return val\nbuiltins.input=__fake_input\ntry:\n with contextlib.redirect_stdout(__out):\n  exec(${JSON.stringify(code)}, {})\n __err=''\nexcept Exception as e:\n __err=repr(e)\nfinally:\n builtins.input=__old_input\n(__out.getvalue(), __err)`;
}

async function runCode(){
  try{
    const p=await loadPy(); const code=codeEditor?codeEditor.getValue():$('#code').value;
    if(/matplotlib/.test(code)) { $('#output').textContent='Carregant matplotlib…'; await p.loadPackage('matplotlib'); }
    const out=await p.runPythonAsync(pythonWrapper(code,inputValues(),true));
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
    await flushExerciseIntegrity();
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
let teacherFilter='pending';

function filterTeacher(status,btn){
  teacherFilter=status;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.filter===status));
  document.querySelectorAll('#teacher-list .submission').forEach(card=>{
    card.hidden=status!=='all' && card.dataset.status!==status;
  });
  const visible=[...document.querySelectorAll('#teacher-list .submission')].filter(x=>!x.hidden).length;
  const empty=$('#teacher-filter-empty');
  if(empty) empty.hidden=visible!==0;
}

function toggleTeacherStatement(id){
  const box=$(`#statement-${id}`);
  if(box) box.hidden=!box.hidden;
}

function exerciseIntegrityReason(ev){
  const meta=ev?.meta||{};
  if(ev?.event_type==='statement_copy'){
    const detail=meta.near_full_statement?' · gairebé tot l’enunciat':'';
    return `Còpia directa de l’enunciat${detail}${meta.chars?` · ${meta.chars} caràcters`:''}`;
  }
  if(ev?.event_type==='copy_paste'){
    return `ALERTA DE COPY-PASTE · bloc de ${meta.lines||'?'} línies${meta.chars?` · ${meta.chars} caràcters`:''}`;
  }
  return String(ev?.event_type||'Alerta d’integritat');
}
function exerciseIntegrityTime(ev){
  if(!ev?.created_at)return '';
  const d=new Date(ev.created_at);
  return Number.isNaN(d.getTime())?'':d.toLocaleString('ca-ES',{dateStyle:'short',timeStyle:'short'});
}
function exerciseIntegrityClass(ev){
  return 'security-alert security-'+String(ev?.event_type||'other').replace(/[^a-z0-9_-]/gi,'');
}
function exerciseIntegrityChips(events){
  const counts=new Map();
  for(const ev of events||[])counts.set(ev.event_type,(counts.get(ev.event_type)||0)+1);
  return [...counts.entries()].map(([type,n])=>{
    const label=type==='copy_paste'?'ALERTA DE COPY-PASTE':type==='statement_copy'?'Còpia directa de l’enunciat':type;
    return `<span class="security-chip security-${String(type).replace(/[^a-z0-9_-]/gi,'')}" title="${esc(label)} · ${n}">⚠${n>1?' '+n:''}</span>`;
  }).join('');
}

async function teacherDashboard(){
  try{
    const d=await api('/api/teacher/submissions');
    const counts={all:d.submissions.length,pending:0,returned:0,validated:0};
    d.submissions.forEach(s=>counts[s.status==='returned'?'returned':s.status==='validated'?'validated':'pending']++);
    $('#app').innerHTML=`<div class="teacher-head"><div><h1>Panell del professor</h1><p>Revisa les entregues pendents. Quan les validis o retornis, desapareixeran d'aquesta vista.</p></div><div class="teacher-actions"><button class="secondary" onclick="enterStudentPreview()">👁 Veure com a alumne</button> <button class="secondary" onclick="teacherProgress()">📊 Seguiment alumnes</button><button class="secondary" onclick="teacherExams()">📝 Exàmens</button><button class="secondary" onclick="teacherDashboard()">↻ Actualitzar</button></div></div><div class="teacher-filters"><button class="filter-btn" data-filter="pending" onclick="filterTeacher('pending',this)">Pendents <b>${counts.pending}</b></button><button class="filter-btn" data-filter="returned" onclick="filterTeacher('returned',this)">Retornades <b>${counts.returned}</b></button><button class="filter-btn" data-filter="validated" onclick="filterTeacher('validated',this)">Validades <b>${counts.validated}</b></button><button class="filter-btn" data-filter="all" onclick="filterTeacher('all',this)">Totes <b>${counts.all}</b></button></div><div id="teacher-list"></div>`;
    if(!d.submissions.length){ $('#teacher-list').innerHTML='<div class="card compact-empty"><p>Encara no hi ha entregues.</p></div>'; return; }
    for(const s of d.submissions){
      let ai={}; try{ai=JSON.parse(s.ai_result_json||'{}')}catch{}
      const validated=s.status==='validated',returned=s.status==='returned';
      const status=returned?'returned':validated?'validated':'pending';
      const stateLabel=returned?'↩ Retornada':validated?'✓ Validada':'Pendent';
      const proposed=s.final_score!=null?s.final_score:(s.returned_score!=null?s.returned_score:(ai.score??''));
      const integrity=Array.isArray(s.integrity_events)?s.integrity_events:[];
      $('#teacher-list').insertAdjacentHTML('beforeend',`<article class="card submission compact-submission ${returned?'returned-submission':''}" data-status="${status}">
        <div class="compact-submission-main">
          <div class="compact-id"><span class="pill">${esc(s.exercise_code)}</span><span class="status ${returned?'returned':validated?'ok':'pending'}">${stateLabel}</span>${integrity.length?`<span class="security-chip-row">${exerciseIntegrityChips(integrity)}</span>`:''}</div>
          <div class="compact-student"><strong>${esc(s.name)}</strong><span>${esc(s.title)}</span></div>
          <small class="compact-date">${esc(s.submitted_at)}</small>
          <button class="statement-btn secondary" onclick="event.stopPropagation();toggleTeacherStatement(${s.id})">📋 Enunciat</button>
          <div class="score compact-score">${returned?'—':s.final_score!=null?esc(s.final_score):ai.score!=null?esc(Number(ai.score).toFixed(1)):'—'}<small>/10</small></div>
        </div>
        <div id="statement-${s.id}" class="teacher-statement-panel" hidden>
          <div class="teacher-statement-head"><strong>📋 ${esc(s.exercise_code)} · Enunciat i criteris</strong><button class="secondary mini-btn" onclick="toggleTeacherStatement(${s.id})">Tanca</button></div>
          <p>${esc(s.statement||'')}</p>
          ${(()=>{let r=[];try{r=JSON.parse(s.rubric_json||'[]')}catch{}return r.length?`<h4>Criteris d'avaluació</h4><ul>${r.map(x=>`<li>${esc(x[0])}: ${esc(x[1])} punts</li>`).join('')}</ul>`:''})()}
        </div>
        <details class="compact-review">
          <summary>Corregir</summary>
          ${integrity.length?`<div class="normal-integrity-panel"><div class="normal-integrity-title"><strong>⚠ Alertes d’integritat</strong><span>${integrity.length}</span></div><ul>${integrity.map(ev=>`<li class="${exerciseIntegrityClass(ev)}"><strong>${esc(exerciseIntegrityReason(ev))}</strong>${exerciseIntegrityTime(ev)?`<small>${esc(exerciseIntegrityTime(ev))}</small>`:''}</li>`).join('')}</ul></div>`:''}
          <div class="compact-review-grid">
            <div class="compact-code"><h4>Codi entregat</h4><pre>${esc(s.student_code)}</pre></div>
            <div class="compact-ai"><h4>Correcció IA</h4><p>${esc(ai.feedback||'Sense proposta IA')}</p>${Array.isArray(ai.criteria)&&ai.criteria.length?`<div class="teacher-criteria">${ai.criteria.map(c=>`<p><strong>${esc(c.name)}: ${esc(c.score)}/${esc(c.max)}</strong> — ${esc(c.reason||'')}</p>`).join('')}</div>`:''}${ai.teacher_feedback?`<h4>Informe per al professor</h4><p>${esc(ai.teacher_feedback)}</p>`:''}${ai.teacher_warning?`<div class="ai-warning"><strong>⚠ Revisió recomanada:</strong> ${esc(ai.teacher_warning)}</div>`:''}</div>
          </div>
          <div class="compact-correction-bar">
            <label class="compact-comment"><span>Comentari</span><textarea id="comment-${s.id}" placeholder="Comentari opcional per a l'alumne" ${returned?'disabled':''}>${esc(s.teacher_comment||'')}</textarea></label>
            <label class="compact-grade"><span>Nota</span><input id="score-${s.id}" type="number" min="0" max="10" step="0.1" value="${esc(proposed)}" ${validated||returned?'disabled':''}></label>
            <div class="compact-actions"><button onclick="validateSubmission(${s.id})" ${validated||returned?'disabled':''}>${validated?'✓ Validada':returned?'Retornada':'✓ Validar'}</button>${returned?'':`<button class="return-btn" onclick="returnSubmission(${s.id})">↩ Retornar</button><button class="danger delete-btn" onclick="deleteSubmission(${s.id})">🗑</button>`}</div>
          </div>
        </details>
      </article>`);
    }
    $('#teacher-list').insertAdjacentHTML('beforeend','<div id="teacher-filter-empty" class="card compact-empty" hidden><p>No hi ha entregues en aquesta vista.</p></div>');
    filterTeacher(teacherFilter,null);
  }catch(e){ $('#app').innerHTML=`<div class="card"><h1>Panell del professor</h1><p class="error">${esc(e.message)}</p></div>`; }
}

async function validateSubmission(id){
  const input=$(`#score-${id}`); const score=Number(input.value);
  if(!Number.isFinite(score)||score<0||score>10){ alert('La nota ha de ser entre 0 i 10.'); return; }
  const comment=$(`#comment-${id}`)?.value||''; try{ await api(`/api/teacher/submissions/${id}`,{method:'POST',body:JSON.stringify({score,comment})}); teacherFilter='pending'; await teacherDashboard(); }
  catch(e){ alert(e.message); }
}


async function deleteSubmission(id){
  if(!confirm("Vols eliminar definitivament aquesta entrega?\n\nAquesta acció esborrarà l'intent del panell i de l'historial de l'alumne i no es pot desfer.")) return;
  try{
    await api(`/api/teacher/submissions/${id}`,{method:'DELETE'});
    teacherFilter='pending'; await teacherDashboard();
  }catch(e){ alert(e.message); }
}

async function returnSubmission(id){
  const ok=confirm("Vols retornar aquesta entrega?\n\nL'intent es conservarà a l'historial i l'exercici tornarà a aparèixer com a no fet perquè l'alumne el pugui repetir.");
  if(!ok) return;
  try{
    const score=Number($(`#score-${id}`)?.value),comment=$(`#comment-${id}`)?.value||''; await api(`/api/teacher/submissions/${id}`,{method:'POST',body:JSON.stringify({action:'return',score:Number.isFinite(score)?score:null,comment})});
    teacherFilter='pending'; await teacherDashboard();
  }catch(e){ alert(e.message); }
}

start();
