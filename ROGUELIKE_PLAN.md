# Prototip roguelike 2D per a Programació 4ESO

## Estat actual: fase 1 · demostració independent + projecte 12.5 integrat

- Ruta de proves: `/roguelike.html` (també disponible des del botó del panell docent).
- `public/roguelike-prototype.py`: joc real en Python, mapa 20×14, torns, parets, monstres, combat, clau, porta, pocions, vida i victòria/derrota.
- `public/roguelike-worker.js`: executa Pyodide en un Web Worker persistent. El codi Python **no es torna a executar des del principi** després de cada fletxa; la partida conserva l'estat. Es poden reiniciar les partides sense tornar a descarregar Python.
- `public/roguelike.js`: dibuixa els tiles i sprites provisionals en Canvas, capta fletxes/WASD i controls tàctils.
- `public/roguelike.html` i `public/roguelike.css`: pàgina i estil independents.
- `tests/test_roguelike.py`: proves de mapa, moviment, col·lisions, combat, clau, porta i reinici.

La demostració **/roguelike.html** només executa el codi Python de confiança del repositori.
**El nou 12.5 és diferent:** el codi lliure dels alumnes s'executa en un Worker dins d'un iframe `sandbox="allow-scripts"` sense same-origin, amb temporitzadors per interrompre bucles infinits.

### Projecte final 12.5
- `src/chapter12.js`: cinc exercicis 12.1–12.5 (12.5 és el projecte creatiu).
- `public/theory.js`: introducció a Rogue, Gauntlet/Pac-Man per torns, Jupiter Hell i Shattered Pixel Dungeon, amb exemples de mecàniques i informació sobre llicències.
- `public/roguelike-lab-ui.js`: interfície del laboratori integrada al costat de l'editor; envia el codi actual a la previsualització; permet importar sprites propis o CC0 i desar-los a D1.
- `public/roguelike-lab.html`, `roguelike-lab-frame.js` i `roguelike-lab-worker.js`: visor Canvas i Python persistent aïllats.
- `src/worker.js`: taules `roguelike_assets` i `roguelike_submission_assets`. Els recursos d'una entrega es copien al moment de lliurar, per facilitar la revisió posterior del professor. Els comptes eliminats també eliminen els assets.
- En 12.5, `inicia()` i `torn(direccio)` retornen un diccionari JSON amb el mapa i l'estat. Les tecles i el dibuix es gestionen fora de Python.

Els alumnes poden treballar amb sprites integrats o importar imatges ràster petites (PNG, JPEG o WebP), indicant-ne la llicència i confirmant-ne els drets d'ús. Les imatges es normalitzen a 64 × 64 píxels abans de desar-les.

## Com provar-lo

1. Obre el panell del professor i prem «🧪 Prova el roguelike». Alternativament obre `/roguelike.html` dins el domini del curs.
2. Espera la primera càrrega de Pyodide. Si el CDN principal no respon, l'aplicació provarà un servidor alternatiu.
3. Mou el personatge amb fletxes/WASD (o botons tàctils).
4. Comprova que les parets aturen el moviment, els enemics ataquen i les pocions recuperen vida.
5. Troba la clau i arriba a la porta per guanyar.
6. Prem «Nova partida» i confirma que comença una partida nova sense tornar a descarregar el motor.
7. Proves Python en entorn de desenvolupament: `python -m unittest discover -s tests -p 'test_roguelike.py'`.

## Properes fases

1. Diversos tipus d'enemics, comportaments, inventari ampliat, animacions i sons opcionals.
2. Generació procedural de mapes i progressió entre nivells.
3. Galeria pública de videojocs gràfics lliurats i validats pel professor, separada de l'11.5.
4. Revisions del rendiment i la compatibilitat a ordinadors de l'institut i navegadors mòbils.

## Gràfics i llicències

El joc de demostració i el 12.5 dibuixen sprites provisionals en Canvas, **sense descarregar imatges externes**. Al 12.5 els alumnes poden importar i desar els sprites que descarreguin legalment de:

- [Free Game Assets — Fantasy RPG Icons](https://www.freegameassets.com/fantasy-rpg-icons): HUD, inventaris, monstres, pocions i armes.
- [Free Game Assets — Pixel Fantasy Textures](https://www.freegameassets.com/pixel-fantasy-textures): pedra, murs, sòl i fusta.
- [Free Game Assets — Sprites](https://www.freegameassets.com/category/sprites): directori de fonts externes com Kenney, OpenGameArt o CraftPix.

El lloc presenta la biblioteca pròpia com a CC0, però **cal verificar la llicència de cada element i de cada paquet extern**, conservar-ne la procedència i l'atribució si és obligatòria. Evitar dependències remotes d'imatges a les sessions d'alumnes: incloure només fitxers autoritzats i optimitzats al repositori.

## Límits coneguts

- Al 12.5 el codi Python i els mapes són editables. Els sprites són personalitzables amb imatges individuals, però encara no hi ha editor visual de mapes ni biblioteca de recursos externs integrada.
- Gràfics provisionals; sense animació en temps real ni sons. Els enllaços a bancs de recursos no descarreguen automàticament imatges de tercers.
- Joc per torns; no es pretén simular Pygame ni un bucle de 60 FPS.
- La primera càrrega de Pyodide requereix connexió; ambdues rutes CDN poden quedar bloquejades per una xarxa escolar.
- El prototip encara requereix una comprovació visual i una partida completa en el desplegament real.
