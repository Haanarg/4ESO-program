// Tema 12: contingut didàctic únic i versionat. No inclou cap dada personal.
export const CHAPTER12_VERSION='roguelike-20261111-v1';
export const chapter12Exercises=[
  {
    "chapter": 12,
    "code": "12.1",
    "title": "Predir i executar",
    "type": "predict",
    "statement": "Abans de prémer Executar, escriu en comentaris les quatre línies que creus que mostrarà el programa, en ordre. Després comprova-ho i explica: a) per què les caselles es consulten amb mapa[y][x], b) què representen les coordenades (x, y), c) què significa el símbol '#' i d) quina informació guarda el diccionari moviments. Afegeix només comentaris: no canviïs el codi executable.",
    "starter": "# TEMA 12 · MAPES 2D\n# La meva predicció ABANS d'executar:\n# Línia 1:\n# Línia 2:\n# Línia 3:\n# Línia 4:\n\nmapa = [\n    \"#######\",\n    \"#..K..#\",\n    \"#.#...#\",\n    \"#...S.#\",\n    \"#######\"\n]\n\nposicio = (1, 1)\nx, y = posicio\nprint(mapa[y][x])\nprint(mapa[1][3])\n\nmoviments = {\"dreta\": (1, 0), \"avall\": (0, 1)}\ndx, dy = moviments[\"dreta\"]\ndesti = (x + dx, y + dy)\nprint(desti)\nprint(mapa[desti[1]][desti[0]])\n\n# DESPRÉS d'executar: explica amb comentaris:\n# Per què consultem mapa[y][x]?\n# Què són (x, y), '#' i moviments?\n",
    "solution": "# Sortida: . / K / (2, 1) / .\n# x correspon a la columna i y a la fila; primer s'indexa la fila.\n# '#' indica paret; '.' terra; K clau; S sortida.\n# Les tuples indiquen posició o desplaçament (dx,dy).\n# moviments és un diccionari que associa cada ordre a un desplaçament.",
    "rubric": [
      [
        "Predicció abans d'executar",
        4
      ],
      [
        "Coordenades, mapes i índexs",
        4
      ],
      [
        "Comentaris i explicació",
        2
      ]
    ],
    "tests": []
  },
  {
    "chapter": 12,
    "code": "12.2",
    "title": "Investigar",
    "type": "investigate",
    "statement": "Investiga aquest fragment d'un motor de masmorres. Executa'l i contesta totes les preguntes als comentaris: dimensions del mapa, coordenades, parets, comprovació de límits, què passa si llegim una casella inexistent i quin paper té el diccionari d'estat. No has de modificar la funció: has de comprendre-la i justificar les respostes.",
    "starter": "# INVESTIGA: caselles, obstacles i estat del jugador\nmapa = [\n    \"#######\",\n    \"#.....#\",\n    \"#.###.#\",\n    \"#..K..#\",\n    \"#######\"\n]\nestat = {\"x\": 1, \"y\": 1, \"vida\": 3, \"te_clau\": False}\n\ndef es_transitable(x, y):\n    dins = 0 <= y < len(mapa) and 0 <= x < len(mapa[0])\n    if not dins:\n        return False\n    return mapa[y][x] != \"#\"\n\nprint(es_transitable(2, 1))\nprint(es_transitable(2, 2))\nprint(es_transitable(10, 1))\nprint(estat[\"vida\"])\n\n# INVESTIGACIÓ: escriu les respostes com a comentaris.\n# 1. Quantes files i columnes té el mapa?\n# Resposta:\n# 2. Quina coordenada correspon a la fila? I a la columna?\n# Resposta:\n# 3. Per què (2,1) i (2,2) donen resultats diferents?\n# Resposta:\n# 4. Per què comprovem els límits abans de llegir mapa[y][x]?\n# Resposta:\n# 5. Què passaria si consultéssim mapa[1][10] directament?\n# Resposta:\n# 6. Quines dades conserva el diccionari estat?\n# Resposta:\n# 7. Quina diferència hi ha entre llegir una casella i canviar l'estat?\n# Resposta:\n",
    "solution": "# 1. 5 files i 7 columnes.\n# 2. y indica fila, x indica columna.\n# 3. (2,1) és terra i (2,2) és paret.\n# 4. Per no sortir de les files i columnes existents.\n# 5. IndexError.\n# 6. Posició, vida i possessió de la clau.\n# 7. Llegir no modifica les dades; canviar estat modifica el joc.\n# Sortida: True, False, False, 3.",
    "rubric": [
      [
        "Comprensió de mapes i coordenades",
        4
      ],
      [
        "Límits, col·lisions i raonament",
        4
      ],
      [
        "Respostes justificades",
        2
      ]
    ],
    "tests": []
  },
  {
    "chapter": 12,
    "code": "12.3",
    "title": "Modificar",
    "type": "modify",
    "statement": "Completa la funció moure perquè calculi una nova posició (x, y) si la casella és accessible. Si la destinació és una paret ('#') o surt dels límits del mapa, conserva la posició anterior. El diccionari de direccions i el càlcul de nx, ny ja estan fets. Completa la comprovació i els return; no modifiquis les tres proves. La sortida correcta és: (2, 1), (2, 1) i (1, 1), en línies separades. Ampliació: prova les quatre cantonades.",
    "starter": "# MOVIMENT I COL·LISIONS\nmapa = [\n    \"#######\",\n    \"#.....#\",\n    \"#.###.#\",\n    \"#.....#\",\n    \"#######\"\n]\nmoviments = {\n    \"amunt\": (0, -1),\n    \"avall\": (0, 1),\n    \"esquerra\": (-1, 0),\n    \"dreta\": (1, 0)\n}\n\ndef moure(posicio, direccio):\n    x, y = posicio\n    dx, dy = moviments[direccio]\n    nx, ny = x + dx, y + dy\n\n    # TODO: comprova que nx i ny estiguin dins del mapa.\n    # TODO: comprova que mapa[ny][nx] no sigui una paret.\n    # TODO: retorna la nova posició si s'hi pot passar.\n    # En cas contrari, conserva la posició original.\n    return posicio\n\n# Proves ja preparades: no cal canviar-les.\nprint(moure((1, 1), \"dreta\"))\nprint(moure((2, 1), \"avall\"))\nprint(moure((1, 1), \"esquerra\"))\n",
    "solution": "mapa=[\"#######\",\"#.....#\",\"#.###.#\",\"#.....#\",\"#######\"]\nmoviments={\"amunt\":(0,-1),\"avall\":(0,1),\"esquerra\":(-1,0),\"dreta\":(1,0)}\ndef moure(posicio,direccio):\n    x,y=posicio\n    dx,dy=moviments[direccio]\n    nx,ny=x+dx,y+dy\n    if 0 <= ny < len(mapa) and 0 <= nx < len(mapa[0]):\n        if mapa[ny][nx] != \"#\":\n            return (nx,ny)\n    return posicio\nprint(moure((1,1),\"dreta\"))\nprint(moure((2,1),\"avall\"))\nprint(moure((1,1),\"esquerra\"))",
    "rubric": [
      [
        "Moviment sobre terra",
        3
      ],
      [
        "Bloqueig de parets i límits",
        4
      ],
      [
        "Return, claredat i qualitat del codi",
        3
      ]
    ],
    "tests": [
      {
        "kind": "syntax",
        "points": 2
      },
      {
        "kind": "has",
        "pattern": "if ",
        "points": 1
      },
      {
        "kind": "stdout_equals",
        "expected": "(2, 1)\n(2, 1)\n(1, 1)",
        "points": 5
      }
    ]
  },
  {
    "chapter": 12,
    "code": "12.4",
    "title": "Construir",
    "type": "build",
    "statement": "Construeix la funció torn(estat, direccio) d'un petit videojoc per torns. Rebràs un mapa fix, un diccionari de direccions i l'estat inicial. Cada ordre durant una partida activa suma un torn. Calcula la destinació, respecta les parets i els límits, recull la clau K i no permetis travessar la porta S sense clau. Amb clau, entrar a S ha de posar l'estat a 'victoria'. Retorna el diccionari d'estat actualitzat. NO modifiquis les ordres de prova: el resultat correcte és exactament 'victoria', 'True' i '8' en línies separades. Ampliació opcional: afegeix vida o enemics sense modificar les comprovacions finals.",
    "starter": "# MINI-ROGUELIKE: SISTEMA DE TORNS\nmapa = [\n    \"#########\",\n    \"#..K....#\",\n    \"#.###...#\",\n    \"#......S#\",\n    \"#########\"\n]\nmoviments = {\n    \"amunt\": (0, -1),\n    \"avall\": (0, 1),\n    \"esquerra\": (-1, 0),\n    \"dreta\": (1, 0)\n}\nestat = {\"x\": 1, \"y\": 1, \"te_clau\": False,\n         \"torns\": 0, \"estat\": \"jugant\"}\n\ndef torn(estat, direccio):\n    # TODO 1: si la partida ha acabat, retorna l'estat.\n    # TODO 2: incrementa el comptador de torns.\n    # TODO 3: calcula nx i ny amb moviments[direccio].\n    # TODO 4: evita les parets i els límits del mapa.\n    # TODO 5: si la casella és K, recull la clau.\n    # TODO 6: si la casella és S, cal tenir la clau.\n    #         Si hi entres amb clau, activa \"victoria\".\n    # TODO 7: actualitza x i y quan es pugui avançar.\n    return estat\n\n# Prova automàtica de la partida: NO la modifiquis.\nordres = [\n    \"dreta\", \"dreta\", \"dreta\", \"dreta\",\n    \"dreta\", \"dreta\", \"avall\", \"avall\"\n]\nfor ordre in ordres:\n    estat = torn(estat, ordre)\nprint(estat[\"estat\"])\nprint(estat[\"te_clau\"])\nprint(estat[\"torns\"])\n",
    "solution": "mapa=[\"#########\",\"#..K....#\",\"#.###...#\",\"#......S#\",\"#########\"]\nmoviments={\"amunt\":(0,-1),\"avall\":(0,1),\"esquerra\":(-1,0),\"dreta\":(1,0)}\nestat={\"x\":1,\"y\":1,\"te_clau\":False,\"torns\":0,\"estat\":\"jugant\"}\ndef torn(estat,direccio):\n    if estat[\"estat\"] != \"jugant\":\n        return estat\n    estat[\"torns\"] += 1\n    dx,dy=moviments[direccio]\n    nx=estat[\"x\"]+dx\n    ny=estat[\"y\"]+dy\n    if not (0 <= ny < len(mapa) and 0 <= nx < len(mapa[0])):\n        return estat\n    casella=mapa[ny][nx]\n    if casella == \"#\":\n        return estat\n    if casella == \"S\" and not estat[\"te_clau\"]:\n        return estat\n    estat[\"x\"]=nx\n    estat[\"y\"]=ny\n    if casella==\"K\":\n        estat[\"te_clau\"]=True\n    elif casella==\"S\":\n        estat[\"estat\"]=\"victoria\"\n    return estat\nordres=[\"dreta\",\"dreta\",\"dreta\",\"dreta\",\"dreta\",\"dreta\",\"avall\",\"avall\"]\nfor ordre in ordres:\n    estat=torn(estat,ordre)\nprint(estat[\"estat\"])\nprint(estat[\"te_clau\"])\nprint(estat[\"torns\"])",
    "rubric": [
      [
        "Moviment i col·lisions",
        3
      ],
      [
        "Clau, porta i estat de victòria",
        4
      ],
      [
        "Comptador de torns i funció",
        2
      ],
      [
        "Claredat",
        1
      ]
    ],
    "tests": [
      {
        "kind": "syntax",
        "points": 2
      },
      {
        "kind": "has",
        "pattern": "if ",
        "points": 1
      },
      {
        "kind": "stdout_equals",
        "expected": "victoria\nTrue\n8",
        "points": 5
      }
    ]
  }
];
