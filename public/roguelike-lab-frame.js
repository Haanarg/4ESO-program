/* 12.5 · Joc 2D aïllat: només pinta estats JSON i envia ordres a un Worker. */
(function(){
 'use strict';
 const VERSION='20261111-lab1',TILE=28,MAX_CODE=30000;
 const get=id=>document.getElementById(id);
 const canvas=get('lab-canvas'),ctx=canvas.getContext('2d',{alpha:false});
 const labels={status:get('lab-status'),message:get('lab-message'),error:get('error'),
  life:get('lab-life'),turn:get('lab-turn'),key:get('lab-key'),score:get('lab-score')};
 const directions={ArrowUp:'amunt',ArrowDown:'avall',ArrowLeft:'esquerra',ArrowRight:'dreta',
  w:'amunt',W:'amunt',s:'avall',S:'avall',a:'esquerra',A:'esquerra',d:'dreta',D:'dreta'};
 const assetSlots=['terra','paret','jugador','enemic','clau','porta','pocio','premi'];
 let worker=null,workerUrl=null,timer=null,ready=false,busy=false,world=null,code='',cdn=0,attempt=0,assets={};
 const send=(type,data={})=>parent.postMessage({rogueLab:true,version:VERSION,type,...data},'*');
 function clearTimer(){if(timer){clearTimeout(timer);timer=null}}
 function terminate(){
  clearTimer();if(worker){worker.terminate();worker=null;}
  if(workerUrl){URL.revokeObjectURL(workerUrl);workerUrl=null;}
  ready=false;busy=false;
 }
 function status(s){labels.status.textContent=String(s||'')}
 function error(reason){
  terminate();labels.error.hidden=false;labels.error.textContent=String(reason||'Error desconegut').slice(0,1500);
  status('⚠ Error');send('error',{message:labels.error.textContent});
 }
 function asCoord(p,name,cols,rows){
  if(!Array.isArray(p)||p.length!==2||!p.every(Number.isInteger)
   ||p[0]<0||p[1]<0||p[0]>=cols||p[1]>=rows)
   throw Error('Coordenades incorrectes de '+name+'. Han de ser [x, y] dins el mapa.');
  return p;
 }
 function check(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('inicia() o torn() ha de retornar un diccionari.');
  const map=raw.mapa;
  if(!Array.isArray(map)||map.length<3||map.length>30||!map.every(v=>typeof v==='string'&&v.length>=3&&v.length<=40&&v.length===map[0].length))
   throw Error('El mapa ha de ser una llista de 3–30 files, totes de la mateixa amplada (3–40 caselles).');
  const rows=map.length,cols=map[0].length;
  const player=asCoord(raw.jugador,'jugador',cols,rows);
  const enemies=(raw.enemics??[]);
  if(!Array.isArray(enemies)||enemies.length>100)throw Error('La llista enemics no és vàlida (màxim 100).');
  const safeEnemies=enemies.map((e,i)=>{
   if(!e||typeof e!=='object'||!Number.isInteger(e.x)||!Number.isInteger(e.y))throw Error('Enemic '+(i+1)+': cal especificar x i y.');
   asCoord([e.x,e.y],'enemic',cols,rows);return {x:e.x,y:e.y,vida:Number(e.vida??1)};
  });
  const coordOrNull=(p,n)=>p==null?null:asCoord(p,n,cols,rows);
  const potions=raw.pocions??[];
  if(!Array.isArray(potions)||potions.length>100)throw Error('La llista pocions és incorrecta.');
  const extras=raw.objectes??[];
  if(!Array.isArray(extras)||extras.length>100)throw Error('La llista objectes és incorrecta.');
  return {
   mapa:map,jugador:player,enemics:safeEnemies,clau:coordOrNull(raw.clau,'clau'),
   porta:coordOrNull(raw.porta,'porta'),
   pocions:potions.map((p,i)=>asCoord(p,'poció '+i,cols,rows)),
   objectes:extras.map((p,i)=>{
    if(!p||typeof p!=='object')throw Error('Objecte '+i+' incorrecte.');
    asCoord([p.x,p.y],'objecte '+i,cols,rows);
    return{x:p.x,y:p.y,tipus:assetSlots.includes(p.tipus)?p.tipus:'premi'};
   }),
   vida:Math.max(0,Math.min(999,Number(raw.vida??0)||0)),
   vida_max:Math.max(1,Math.min(999,Number(raw.vida_max??10)||10)),
   te_clau:raw.te_clau===true,torns:Math.max(0,Math.min(999999,Number(raw.torns)||0)),
   puntuacio:Math.max(0,Math.min(99999999,Number(raw.puntuacio)||0)),
   estat:['jugant','victoria','derrota'].includes(raw.estat)?raw.estat:'jugant',
   missatge:String(raw.missatge??'').slice(0,600)
  };
 }
 function fill(x,y,color){ctx.fillStyle=color;ctx.fillRect(x*TILE,y*TILE,TILE,TILE)}
 function drawSprite(slot,x,y,glyph,color){
  const img=assets[slot];
  if(img?.complete&&img.naturalWidth){ctx.drawImage(img,x*TILE,y*TILE,TILE,TILE);return;}
  const cx=x*TILE,cy=y*TILE;
  ctx.fillStyle='rgba(0,0,0,.3)';ctx.fillRect(cx+5,cy+23,18,3);
  ctx.fillStyle=color;ctx.fillRect(cx+6,cy+7,16,17);
  ctx.fillStyle='#071021';ctx.font='bold 15px monospace';ctx.textAlign='center';
  ctx.fillText(glyph,cx+14,cy+21);
 }
 function draw(){
  const s=world;if(!s)return;
  const rows=s.mapa.length,cols=s.mapa[0].length;
  if(canvas.width!==cols*TILE||canvas.height!==rows*TILE){
   canvas.width=cols*TILE;canvas.height=rows*TILE;ctx.imageSmoothingEnabled=false;
  }
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
   const tile=s.mapa[y][x],wall=tile==='#',img=assets[wall?'paret':'terra'];
   if(img?.complete&&img.naturalWidth)ctx.drawImage(img,x*TILE,y*TILE,TILE,TILE);
   else {
    fill(x,y,wall?'#44546a':(x+y)%2?'#192736':'#203044');
    if(wall){ctx.fillStyle='#64748b';ctx.fillRect(x*TILE,y*TILE,TILE,3);}
    else {ctx.fillStyle='#263848';ctx.fillRect(x*TILE+4,y*TILE+11,4,2);}
   }
   if(tile==='S')drawSprite('porta',x,y,'▣','#b17f47');
   if(tile==='K'&&!s.te_clau)drawSprite('clau',x,y,'⚷','#e4bf56');
   if(tile==='o')drawSprite('premi',x,y,'·','#dabf72');
   if(tile==='P')drawSprite('premi',x,y,'★','#be8be9');
  }
  if(s.porta)drawSprite('porta',s.porta[0],s.porta[1],'▣','#b17f47');
  if(s.clau&&!s.te_clau)drawSprite('clau',s.clau[0],s.clau[1],'⚷','#e4bf56');
  for(const p of s.pocions)drawSprite('pocio',p[0],p[1],'+','#ea668a');
  for(const p of s.objectes)drawSprite(p.tipus,p.x,p.y,'✦','#e3bf52');
  for(const enemy of s.enemics)drawSprite('enemic',enemy.x,enemy.y,'✕','#bf5277');
  drawSprite('jugador',s.jugador[0],s.jugador[1],'@','#4ba9bb');
  if(s.estat!=='jugant'){
   ctx.fillStyle='rgba(5,10,19,.78)';ctx.fillRect(0,0,canvas.width,canvas.height);
   ctx.fillStyle=s.estat==='victoria'?'#f3d382':'#fbb1b1';
   ctx.textAlign='center';ctx.font='bold 23px system-ui';
   ctx.fillText(s.estat==='victoria'?'VICTÒRIA!':'DERROTA',canvas.width/2,canvas.height/2);
  }
 }
 function updateState(raw){
  try{world=check(raw)}catch(e){error('Estat retornat per Python incorrecte: '+e.message);return;}
  clearTimer();busy=false;ready=true;draw();
  labels.life.textContent='♥ '+world.vida+'/'+world.vida_max;
  labels.turn.textContent='Torns: '+world.torns;
  labels.key.textContent=world.te_clau?'🗝 Clau':'🗝 —';
  labels.score.textContent='★ '+world.puntuacio;
  labels.message.textContent=world.missatge;
  status(world.estat==='jugant'?'● Jugant':world.estat==='victoria'?'★ Victòria':'✖ Derrota');
  send('state',{turns:world.torns,gameStatus:world.estat});
 }
 function applyAssets(data){
  for(const k of assetSlots){
   const v=data?.[k];
   if(typeof v!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(v)||v.length>90000){delete assets[k];continue;}
   const img=new Image();img.onload=draw;img.onerror=()=>{delete assets[k];draw()};img.src=v;assets[k]=img;
  }
  draw();
 }
 function start(source,index=0){
  terminate();world=null;code=String(source||'').slice(0,MAX_CODE);cdn=index;attempt++;
  labels.error.hidden=true;labels.error.textContent='';labels.message.textContent='Preparant motor Python…';
  status(index?'Provant servidor alternatiu…':'Carregant Python…');
  const id=attempt;
  try{
   const workerCode=JSON.parse(get('rogue-lab-worker-source').textContent);
   workerUrl=URL.createObjectURL(new Blob([workerCode],{type:'text/javascript'}));
   worker=new Worker(workerUrl);busy=true;
  }catch(e){error('No es pot crear el motor aïllat: '+e.message);return;}
  const w=worker;
  w.onmessage=e=>{
   if(w!==worker||id!==attempt)return;
   const msg=e.data||{};
   if(msg.type==='loading'){status(String(msg.message||'Carregant…'));return;}
   if(msg.type==='state'){updateState(msg.state);return;}
   if(msg.type==='error'){
    if(msg.stage==='loading'&&index===0){start(code,1);return;}
    error(String(msg.message||'Error de Python'));
   }
  };
  w.onerror=e=>{
   e.preventDefault?.();
   if(w!==worker||id!==attempt)return;
   if(index===0)start(code,1);else error('No s’ha pogut iniciar Python. Revisa si la xarxa bloqueja la descàrrega.');
  };
  w.postMessage({type:'start',code,cdnIndex:index});
  timer=setTimeout(()=>{
   if(w!==worker||id!==attempt)return;
   if(index===0)start(code,1);
   else error('Python no ha respost. Revisa el codi o prova una altra connexió.');
  },index===0?55000:85000);
 }
 function turn(direction){
  if(!worker||!ready||busy||world?.estat!=='jugant')return;
  busy=true;const w=worker;w.postMessage({type:'move',direction});
  timer=setTimeout(()=>{if(w===worker)error('Aquest torn ha superat 6 segons: revisa si tens un bucle infinit.');},6000);
 }
 document.addEventListener('keydown',e=>{
  if(e.altKey||e.ctrlKey||e.metaKey||e.target?.matches?.('input,textarea,[contenteditable]'))return;
  const d=directions[e.key];if(d){e.preventDefault();turn(d);}
 });
 document.querySelectorAll('[data-direction]').forEach(b=>{
  b.addEventListener('click',()=>{turn(b.dataset.direction);document.body.focus();});
 });
 get('lab-new').addEventListener('click',()=>{
  if(!worker||!ready){if(code)start(code,cdn);return;}
  const w=worker;busy=true;w.postMessage({type:'new'});
  timer=setTimeout(()=>{if(w===worker)error('El reinici ha superat 6 segons.');},6000);
 });
 get('lab-stop').addEventListener('click',()=>{terminate();status('■ Aturat');labels.message.textContent='El joc està aturat. Prem «Prova el joc» per començar una altra vegada.';send('stopped');});
 window.addEventListener('message',e=>{
  if(e.source!==parent)return;
  const m=e.data||{};
  if(m.type==='start'&&typeof m.code==='string'){
   applyAssets(m.assets);
   start(m.code,m.cdnIndex===1?1:0);
   document.body.focus();return;
  }
  if(m.type==='assets'){applyAssets(m.assets);return;}
  if(m.type==='stop'){terminate();return;}
 });
 window.addEventListener('pagehide',terminate);
 status('Esperant codi del professor o alumne…');
 send('ready');
})();
