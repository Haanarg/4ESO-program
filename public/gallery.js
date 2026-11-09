// 11.5: una galeria de programes 11.4 ja validats pel professor.
async function openAdventureGallery(){
 if(typeof PythonConsole!=='undefined')PythonConsole.stop();
 if(typeof examMode!=='undefined'&&examMode)return;
 const app=$('#app');
 app.innerHTML='<section class="card"><h1>11.5 · Galeria d’aventures</h1><p>Carregant projectes…</p></section>';
 try{
  const data=await api('/api/adventures');
  const cards=Array.isArray(data.adventures)?data.adventures:[];
  const canPublish=!!data.can_publish&&user?.role==='student'&&!studentPreview;
  const authorsPublish=cards.find(x=>Number(x.user_id)===Number(user?.id));
  const ownOrTeacher=entry=>Number(entry.user_id)===Number(user?.id)||user?.role==='teacher';
  app.innerHTML=
   '<div class="teacher-head"><div><span class="pill">PROJECTES DEL GRUP</span><h1>11.5 · Galeria d’aventures</h1>'+
   '<p>Juga a les aventures de text creades pels companys. Només es poden publicar programes de l’11.4 validats pel professor.</p></div>'+
   '<div class="teacher-actions"><button class="secondary" onclick="dashboard()">← Curs</button><button class="secondary" onclick="openAdventureGallery()">↻ Actualitza</button></div></div>'+
   (canPublish?'<section class="card gallery-publish"><h2>Publica la teva aventura</h2>'+
     '<p>La publicació utilitza exactament el <strong>codi de l’11.4 validat pel professor</strong>. No pots pujar un programa nou sense validació; si el professor ha validat una versió posterior, aquesta serà la publicada.</p>'+
     '<form onsubmit="publishMyAdventure(event)"><label>Títol del joc <input id="gallery-game-title" maxlength="80" required minlength="2" placeholder="Un títol original" value="'+esc(authorsPublish?.title||'')+'"></label>'+
     '<label>Presentació (opcional) <textarea id="gallery-game-description" maxlength="350" rows="3" placeholder="Explica de què va, sense revelar el final">'+esc(authorsPublish?.description||'')+'</textarea></label>'+
     '<div class="gallery-publish-actions"><button type="submit">'+(authorsPublish?'Actualitza la publicació':'Publica el projecte aprovat')+'</button><span id="gallery-publish-status" aria-live="polite"></span></div></form></section>':
     (user?.role==='student'&&!studentPreview?'<p class="gallery-locked">🔒 Per publicar aquí, primer has d’entregar l’11.4 i aconseguir que el professor el validi. Mentrestant, pots jugar a les aventures publicades.</p>':''))+
   '<section class="gallery-catalog"><h2>Jocs publicats ('+cards.length+')</h2><div class="gallery-grid">'+
   (cards.length?cards.map(game=>
     '<article class="card gallery-card"><span class="pill">AVENTURA DE TEXT</span><h3>'+esc(game.title)+'</h3>'+
     '<p class="gallery-author">Creat per '+esc(game.author||'un alumne')+'</p>'+
     '<p>'+esc(game.description||'Una aventura per descobrir.')+'</p>'+
     '<div class="gallery-actions"><button onclick="playPublishedAdventure('+Number(game.id)+')">▶ Juga</button>'+
     (ownOrTeacher(game)?'<button class="secondary" onclick="removePublishedAdventure('+Number(game.id)+')">Retira</button>':'')+
     '</div></article>').join(''):'<div class="card gallery-empty"><p>Encara no s’ha publicat cap aventura. Quan hi hagi un 11.4 validat, l’autor podrà compartir-la aquí.</p></div>')+
    '</div></section>';
 }catch(error){
  app.innerHTML='<div class="card"><h1>11.5 · Galeria d’aventures</h1><p class="error">'+esc(error.message)+'</p><button class="secondary" onclick="dashboard()">← Curs</button></div>';
 }
}
async function publishMyAdventure(event){
 event?.preventDefault();
 const status=$('#gallery-publish-status');
 if(status)status.textContent='Publicant…';
 try{
  await api('/api/adventures',{method:'POST',body:JSON.stringify({
   title:$('#gallery-game-title')?.value||'',
   description:$('#gallery-game-description')?.value||''
  })});
  await openAdventureGallery();
 }catch(error){if(status){status.textContent=error.message;status.className='error'}}
}
async function removePublishedAdventure(id){
 if(!confirm('Vols retirar aquesta aventura de la galeria? No s’eliminarà la feina ni la nota de l’11.4.'))return;
 try{await api('/api/adventures/'+Number(id),{method:'DELETE'});await openAdventureGallery()}
 catch(error){alert(error.message)}
}
async function playPublishedAdventure(id){
 if(typeof PythonConsole!=='undefined')PythonConsole.stop();
 const app=$('#app');
 app.innerHTML='<section class="card"><h1>Preparant l’aventura…</h1></section>';
 try{
  const d=await api('/api/adventures/'+Number(id)),game=d.adventure;
  if(!game)throw Error('Aventura no disponible.');
  app.innerHTML='<div class="teacher-head gallery-play-head"><div><span class="pill">GALERIA · 11.5</span><h1>'+esc(game.title)+'</h1>'+
   '<p>Creat per '+esc(game.author||'un alumne')+'</p><p>'+esc(game.description||'')+'</p></div>'+
   '<div class="teacher-actions"><button class="secondary" onclick="openAdventureGallery()">← Galeria</button>'+
   '<button class="secondary" onclick="playPublishedAdventure('+Number(id)+')">↻ Torna a començar</button></div></div>'+
   '<section class="card gallery-play"><p class="muted">Escriu les respostes directament a la consola. El codi s’executa en un entorn aïllat; pots aturar-lo amb el botó ■.</p><div id="gallery-terminal" class="output gallery-terminal"></div></section>';
  PythonConsole.run(String(game.code||''),$('#gallery-terminal'));
 }catch(error){
  app.innerHTML='<section class="card"><h1>Galeria d’aventures</h1><p class="error">'+esc(error.message)+'</p><button onclick="openAdventureGallery()">← Torna</button></section>';
 }
}
