# Prototip roguelike 2D per a Programació 4ESO

## Estat actual: fase 1 · demostració independent

- Ruta de proves: `/roguelike.html` (també disponible des del botó del panell docent).
- `public/roguelike-prototype.py`: joc real en Python, mapa 20×14, torns, parets, monstres, combat, clau, porta, pocions, vida i victòria/derrota.
- `public/roguelike-worker.js`: executa Pyodide en un Web Worker persistent. El codi Python **no es torna a executar des del principi** després de cada fletxa; la partida conserva l'estat. Es poden reiniciar les partides sense tornar a descarregar Python.
- `public/roguelike.js`: dibuixa els tiles i sprites provisionals en Canvas, capta fletxes/WASD i controls tàctils.
- `public/roguelike.html` i `public/roguelike.css`: pàgina i estil independents.
- `tests/test_roguelike.py`: proves de mapa, moviment, col·lisions, combat, clau, porta i reinici.

Aquest prototip **només executa codi Python de confiança del repositori**.
No accepta encara codi lliure dels alumnes: per fer-ho cal executar-lo en un sandbox equivalent al de la consola del curs i limitar-ne els recursos. No modificar ni substituir la consola d'exercicis que ja funciona.

## Com provar-lo

1. Obre el panell del professor i prem «🧪 Prova el roguelike». Alternativament obre `/roguelike.html` dins el domini del curs.
2. Espera la primera càrrega de Pyodide. Si el CDN principal no respon, l'aplicació provarà un servidor alternatiu.
3. Mou el personatge amb fletxes/WASD (o botons tàctils).
4. Comprova que les parets aturen el moviment, els enemics ataquen i les pocions recuperen vida.
5. Troba la clau i arriba a la porta per guanyar.
6. Prem «Nova partida» i confirma que comença una partida nova sense tornar a descarregar el motor.
7. Proves Python en entorn de desenvolupament: `python -m unittest discover -s tests -p 'test_roguelike.py'`.

## Properes fases

1. Fase 2: IA i objectes extensibles, diversos tipus de monstres, inventari i animacions.
2. Fase 3: generació de mapes en Python, llavors aleatòries, múltiples nivells i dificultat progressiva.
3. Fase 4: nou capítol 13 amb exercicis guiats, codi modificable, guardat i execució **amb sandbox separat**. API de nivell alumne (`inicia()`, `torn(direccio)`) amb errors entenedors i límits per torn.
4. Fase 5: galeria de roguelikes lliurats i validats pel professor, amb previsualització segura, separada de la galeria d'aventures de text 11.5.

## Gràfics i llicències

Fase 1 dibuixa sprites originals senzills en Canvas, **sense descarregar imatges externes**. Per a la següent fase, investigar:

- [Free Game Assets — Fantasy RPG Icons](https://www.freegameassets.com/fantasy-rpg-icons): HUD, inventaris, monstres, pocions i armes.
- [Free Game Assets — Pixel Fantasy Textures](https://www.freegameassets.com/pixel-fantasy-textures): pedra, murs, sòl i fusta.
- [Free Game Assets — Sprites](https://www.freegameassets.com/category/sprites): directori de fonts externes com Kenney, OpenGameArt o CraftPix.

El lloc presenta la biblioteca pròpia com a CC0, però **cal verificar la llicència de cada element i de cada paquet extern**, conservar-ne la procedència i l'atribució si és obligatòria. Evitar dependències remotes d'imatges a les sessions d'alumnes: incloure només fitxers autoritzats i optimitzats al repositori.

## Límits coneguts

- No hi ha encara edició de mapes ni del codi de joc per a l'alumnat.
- Gràfics pixel-art provisionals, sense sons ni sprites externs.
- Joc per torns; no es pretén simular Pygame ni un bucle de 60 FPS.
- La primera càrrega de Pyodide requereix connexió; ambdues rutes CDN poden quedar bloquejades per una xarxa escolar.
- El prototip encara requereix una comprovació visual i una partida completa en el desplegament real.
