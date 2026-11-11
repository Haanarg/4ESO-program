/* Eines del projecte 12.5: editor del curs + visor aïllat + sprites persistents. */
const GameLab=(()=>{
 const VERSION='20261111-actions-v1';
 const SLOTS=[['terra','Terra'],['paret','Paret'],['jugador','Personatge'],['enemic','Enemic'],['clau','Clau'],['porta','Porta'],['pocio','Poció'],['premi','Punts / premi']];
 let active=null,assets={},meta={},config=null,nonce=0,frameTimer=null;
 const get=id=>document.getElementById(id);
 const safeText=(node,value)=>{if(node)node.textContent=String(value??'')};
 const escSlot=s=>SLOTS.some(x=>x[0]===s)?s:null;
 function render(){
  return `<section class="card game-lab-card" id="game-lab" aria-label="Laboratori gràfic del projecte 12.5">
    <div class="game-lab-top"><div><span class="pill">PROJECTE FINAL · 12.5</span>
    <h2>🎮 Laboratori de videojocs 2D</h2>
    <p>Escriu les funcions <code>inicia()</code> i <code>torn(accio)</code> a l'editor de dalt. Aquí pots jugar al teu codi Python amb les fletxes o WASD, i definir altres tecles i accions al diccionari <code>controls</code> que retorna <code>pantalla()</code>.</p></div>
    <div class="game-lab-actions">
      <button type="button" id="game-lab-run" class="run-primary">▶ Prova el joc</button>
      <button type="button" id="game-lab-stop" class="secondary">■ Atura</button>
    </div></div>
    <div id="game-lab-status" class="game-lab-status" role="status">El visor està preparat. Prem «Prova el joc».</div>
    <div class="game-lab-window" id="game-lab-window"><p class="game-lab-placeholder">La masmorra, el laberint o el teu joc apareixeran aquí.</p></div>
    <details class="game-lab-assets" id="game-lab-assets">
      <summary>🎨 Sprites i recursos visuals (opcional)</summary>
      <p>Pots utilitzar els gràfics integrats sense descarregar res, o substituir-ne els elements per sprites PNG, JPEG o WebP. Els recursos es guarden amb l'exercici i se'n conserva una còpia quan l'entregues. Tria <strong>una imatge individual</strong> per element (no una spritesheet completa).</p>
      <p>Recursos recomanats: <a href="https://www.freegameassets.com/fantasy-rpg-icons" target="_blank" rel="noopener noreferrer">Free Game Assets · Fantasy RPG</a> · <a href="https://kenney.nl/assets/1-bit-pack" target="_blank" rel="noopener noreferrer">Kenney · 1-Bit Pack (CC0)</a> · <a href="https://opengameart.org/" target="_blank" rel="noopener noreferrer">OpenGameArt</a>. Comprova la llicència de cada recurs que importis.</p>
      <div class="game-lab-asset-grid">
       <label>Element gràfic <select id="game-lab-slot">${SLOTS.map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></label>
       <label>Imatge PNG/JPEG/WebP <input type="file" id="game-lab-file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"></label>
       <label>Procedència o autor <input type="text" id="game-lab-source" maxlength="300" placeholder="Ex. https://kenney.nl/assets/1-bit-pack"></label>
       <label>Llicència <select id="game-lab-license"><option value="propi">Dibuix propi</option><option value="CC0">CC0</option><option value="CC BY">CC BY (cal atribució)</option><option value="altra">Altra (consulta les condicions)</option></select></label>
      </div>
      <label class="game-lab-rights"><input type="checkbox" id="game-lab-rights"> Confirmo que soc l'autor o que tinc permís per utilitzar aquest recurs.</label>
      <div class="game-lab-actions"><button type="button" id="game-lab-save-asset">💾 Desa el sprite</button>
        <button type="button" class="secondary" id="game-lab-delete-asset">Treu el sprite seleccionat</button></div>
      <p class="game-lab-asset-status" id="game-lab-asset-status" role="status"></p>
      <ul class="game-lab-asset-list" id="game-lab-asset-list"></ul>
      <small>Les imatges es redueixen a 64 × 64 píxels abans de desar-les, per evitar alentiments. Els gràfics es poden canviar sense modificar la lògica Python.</small>
    </details>
    <p class="game-lab-hint">Les accions especials es configuren en Python; el teu codi decideix si consumeixen un torn. El codi Python controla el joc; el Canvas només dibuixa. Per evitar bloquejos, no utilitzis <code>input()</code> ni un bucle de joc infinit.</p>
  </section>`;
 }
 function stop(){
  nonce++;
  clearTimeout(frameTimer);frameTimer=null;
  if(active?.frame){
   try{active.frame.contentWindow?.postMessage({type:'stop'},'*')}catch{}
   try{active.frame.remove()}catch{}
  }
  active=null;
 }
 function status(message){safeText(get('game-lab-status'),message)}
 function assetInfo(){
  const list=get('game-lab-asset-list');if(!list)return;list.textContent='';
  for(const [slot,label] of SLOTS){
   const item=document.createElement('li'),m=meta[slot];
   item.textContent=(assets[slot]?'✓ ':'○ ')+label+(m?.license?' · '+m.license:'')+(m?.source?' · '+m.source.slice(0,80):'');
   list.appendChild(item);
  }
 }
 function sendAssets(){
  if(!active?.frame)return;
  try{active.frame.contentWindow?.postMessage({type:'assets',assets},'*')}catch{}
 }
 function parentMessage(event){
  const a=active;
  if(!a||event.source!==a.frame.contentWindow)return;
  const m=event.data||{};
  if(m.rogueLab!==true||m.version!==VERSION)return;
  if(m.type==='ready'){
   clearTimeout(frameTimer);frameTimer=null;
   a.frame.contentWindow.postMessage({type:'start',code:a.code,assets:a.assets},'*');
   status('Carregant el joc Python…');
  }else if(m.type==='state'){
   status(m.gameStatus==='jugant'?'✓ Joc actiu · '+m.turns+' torns':
     m.gameStatus==='victoria'?'★ Has guanyat!':'■ Partida acabada');
  }else if(m.type==='error'){
   status('⚠ '+String(m.message||'Error de Python').slice(0,400));
  }else if(m.type==='stopped'){
   status('■ Joc aturat.');
  }
 }
 window.addEventListener('message',parentMessage);
 function mount(host,source,providedAssets=assets){
  stop();
  if(!host)return;
  const frame=document.createElement('iframe');
  frame.className='game-lab-frame';
  frame.setAttribute('sandbox','allow-scripts');
  frame.setAttribute('referrerpolicy','no-referrer');
  frame.setAttribute('title','Joc Python per torns, executat en un entorn aïllat');
  frame.setAttribute('tabindex','0');
  frame.src='/roguelike-lab.html?v='+VERSION;
  host.replaceChildren(frame);
  const a={frame,code:String(source||'').slice(0,30000),assets:{...providedAssets}};
  active=a;
  status('Preparant el visor del joc…');
  frameTimer=setTimeout(()=>{
   if(active===a)status('⚠ No s’ha pogut iniciar el visor. Actualitza la pàgina i torna-ho a provar.');
  },12000);
  return a;
 }
 function run(){
  if(!config||typeof config.codeProvider!=='function')return;
  const code=String(config.codeProvider()||'');
  if(!code.trim()){status('Escriu codi Python abans de provar el joc.');return;}
  mount(get('game-lab-window'),code,assets);
 }
 function resizeImage(file){
  return new Promise((resolve,reject)=>{
   if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2_000_000){
    reject(Error('Tria un PNG, JPG o WebP de 2 MB com a màxim.'));return;
   }
   const src=URL.createObjectURL(file),image=new Image();
   image.onload=()=>{
    try{
     if(image.width>4096||image.height>4096)throw Error('La imatge és massa gran.');
     const c=document.createElement('canvas');c.width=64;c.height=64;
     const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,64,64);
     ctx.drawImage(image,0,0,64,64);
     const data=c.toDataURL('image/png');
     if(data.length>90000)throw Error('No s’ha pogut comprimir prou la imatge.');
     resolve(data);
    }catch(error){reject(error)}finally{URL.revokeObjectURL(src)}
   };
   image.onerror=()=>{URL.revokeObjectURL(src);reject(Error('No s’ha pogut llegir aquesta imatge.'))};
   image.src=src;
  });
 }
 async function loadAssets(id){
  if(!config||config.exerciseId!==id)return;
  try{
   if(config.preview){assets={};meta={};assetInfo();return;}
   const result=await api('/api/exercises/'+id+'/game-assets');
   if(!config||config.exerciseId!==id)return;
   assets={};meta={};
   for(const v of result.assets||[]){
    if(!escSlot(v.slot))continue;
    if(typeof v.image==='string')assets[v.slot]=v.image;
    meta[v.slot]={source:String(v.source||''),license:String(v.license||'')};
   }
   assetInfo();sendAssets();
  }catch(error){safeText(get('game-lab-asset-status'),'No s’han pogut carregar els sprites: '+error.message)}
 }
 async function upload(){
  if(!config||config.locked&&!config.preview)return;
  const slot=escSlot(get('game-lab-slot')?.value);
  const file=get('game-lab-file')?.files?.[0];
  const rights=get('game-lab-rights')?.checked;
  const license=get('game-lab-license')?.value;
  const source=get('game-lab-source')?.value?.trim()||'';
  const label=get('game-lab-asset-status');
  if(!slot||!file){safeText(label,'Selecciona un element i un fitxer d’imatge.');return;}
  if(!rights){safeText(label,'Cal confirmar que tens dret a utilitzar aquest recurs.');return;}
  safeText(label,'Preparant i desant la imatge…');
  try{
   const image=await resizeImage(file);
   if(!config)return;
   if(!config.preview)await api('/api/exercises/'+config.exerciseId+'/game-assets',
    {method:'PUT',body:JSON.stringify({slot,image,source,license,rights_confirmed:true})});
   assets[slot]=image;meta[slot]={source,license};
   assetInfo();sendAssets();safeText(label,config.preview?'Sprite carregat només per a aquesta prova.':'✓ Sprite desat amb el projecte.');
   get('game-lab-file').value='';
  }catch(error){safeText(label,'⚠ '+error.message)}
 }
 async function remove(){
  if(!config||config.locked&&!config.preview)return;
  const slot=escSlot(get('game-lab-slot')?.value);
  if(!slot)return;
  const label=get('game-lab-asset-status');
  try{
   if(!config.preview)await api('/api/exercises/'+config.exerciseId+'/game-assets',
    {method:'DELETE',body:JSON.stringify({slot})});
   delete assets[slot];delete meta[slot];assetInfo();sendAssets();safeText(label,'Sprite retirat. Tornen els gràfics integrats.');
  }catch(error){safeText(label,'⚠ '+error.message)}
 }
 function init(exerciseId,{preview=false,locked=false,codeProvider=null}={}){
  stop();assets={};meta={};
  config={exerciseId:Number(exerciseId),preview,locked,codeProvider};
  get('game-lab-run')?.addEventListener('click',run);
  get('game-lab-stop')?.addEventListener('click',()=>{stop();status('■ Joc aturat.');});
  get('game-lab-save-asset')?.addEventListener('click',upload);
  get('game-lab-delete-asset')?.addEventListener('click',remove);
  if(locked&&!preview){
   for(const id of ['game-lab-file','game-lab-save-asset','game-lab-delete-asset'])
    if(get(id))get(id).disabled=true;
   safeText(get('game-lab-asset-status'),'Aquest projecte ja està entregat: els recursos es conserven sense canvis.');
  }
  assetInfo();loadAssets(config.exerciseId);
 }
 async function previewSubmission(button){
  const panel=button?.closest('.teacher-run-panel');
  const source=panel?.querySelector('.teacher-run-source')?.textContent||'';
  const host=panel?.querySelector('.teacher-game-preview');
  const id=Number(button?.dataset?.submissionId);
  if(!host||!id)return;
  let values={};
  try{
   const result=await api('/api/teacher/submissions/'+id+'/game-assets');
   for(const v of result.assets||[])if(escSlot(v.slot)&&typeof v.image==='string')values[v.slot]=v.image;
  }catch(error){host.textContent='No s’han pogut recuperar els sprites del lliurament: '+error.message;return;}
  mount(host,source,values);
 }
 window.addEventListener('pagehide',stop);
 return {render,init,run,stop,previewSubmission};
})();
