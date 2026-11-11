"""Roguelike pilot: joc de masmorres programat en Python, no en JavaScript.

El navegador només dibuixa. Les col·lisions, els enemics i els torns
es calculen en Python. inicia() i torn(direccio) són l'API del prototip.
"""
import random
MAPA = [
    "####################",
    "#........#.........#",
    "#..##....#....##...#",
    "#.............##...#",
    "#.....##..........##",
    "#.............#....#",
    "#...####......#....#",
    "#.............#....#",
    "#...###............#",
    "#........##........#",
    "#......#...........#",
    "#......#...##......#",
    "#..................#",
    "####################",
]
MOVIMENTS = {
    "amunt": (0, -1), "avall": (0, 1),
    "esquerra": (-1, 0), "dreta": (1, 0),
}
CONTROLS = {
    "espai": {"accio": "esperar", "etiqueta": "⏳ Esperar"},
    "i": {"accio": "inventari", "etiqueta": "🎒 Inventari"},
}
AMPLADA = len(MAPA[0])
ALCADA = len(MAPA)
ESTAT = {}

def lliure(x, y):
    return 0 <= x < AMPLADA and 0 <= y < ALCADA and MAPA[y][x] != "#"

def distancia(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1])

def mostrar(missatge=""):
    return {
        "mapa": MAPA,
        "jugador": list(ESTAT["jugador"]),
        "enemics": [{"x": e["x"], "y": e["y"], "vida": e["vida"]} for e in ESTAT["enemics"]],
        "clau": None if ESTAT["te_clau"] else list(ESTAT["clau"]),
        "porta": list(ESTAT["porta"]),
        "pocions": [list(p) for p in ESTAT["pocions"]],
        "vida": ESTAT["vida"], "vida_max": 8,
        "te_clau": ESTAT["te_clau"],
        "torns": ESTAT["torns"], "estat": ESTAT["estat"],
        "missatge": missatge,
        "controls": CONTROLS,
    }

def inicia():
    """Crea una partida nova, sense recarregar Python."""
    global ESTAT
    ESTAT = {
        "jugador": (2, 1), "vida": 8,
        "enemics": [{"x": 9, "y": 3, "vida": 2}, {"x": 14, "y": 9, "vida": 2}],
        "clau": (17, 1), "porta": (18, 12),
        "pocions": [(3, 10), (11, 6)],
        "te_clau": False, "torns": 0, "estat": "jugant",
    }
    return mostrar("Troba la clau daurada i arriba a la porta. Vigila els monstres!")

def torn(direccio):
    """El personatge actua primer; després es mouen els monstres."""
    if not ESTAT:
        return inicia()
    if ESTAT["estat"] != "jugant":
        return mostrar("La partida ha acabat. Prem Nova partida.")
    if direccio == "inventari":
        contingut = "clau" if ESTAT["te_clau"] else "buit"
        return mostrar("Inventari: " + contingut)
    if direccio not in MOVIMENTS and direccio != "esperar":
        return mostrar("Acció no implementada.")

    ESTAT["torns"] += 1
    px, py = ESTAT["jugador"]
    dx, dy = MOVIMENTS.get(direccio, (0, 0))
    nx, ny = px + dx, py + dy
    missatge = "Has esperat un torn." if direccio == "esperar" else ""
    if not lliure(nx, ny):
        missatge = "Una paret et barra el pas."
    elif (nx, ny) == ESTAT["porta"] and not ESTAT["te_clau"]:
        missatge = "La porta està tancada. Necessites la clau."
    else:
        monstre = next((e for e in ESTAT["enemics"] if (e["x"], e["y"]) == (nx, ny)), None)
        if monstre:
            monstre["vida"] -= 1
            missatge = "Ataques el monstre!"
            if monstre["vida"] <= 0:
                ESTAT["enemics"].remove(monstre)
                missatge = "Has derrotat un monstre!"
        else:
            ESTAT["jugador"] = (nx, ny)
            if (nx, ny) == ESTAT["clau"] and not ESTAT["te_clau"]:
                ESTAT["te_clau"] = True
                missatge = "Has trobat la clau! Ara busca la porta."
            elif (nx, ny) in ESTAT["pocions"]:
                ESTAT["pocions"].remove((nx, ny))
                ESTAT["vida"] = min(8, ESTAT["vida"] + 3)
                missatge = "Has begut una poció i recuperes vida."
            elif (nx, ny) == ESTAT["porta"]:
                ESTAT["estat"] = "victoria"
                missatge = "Has escapat de la masmorra!"

    if ESTAT["estat"] != "jugant":
        return mostrar(missatge)

    # Intel·ligència artificial simple: persecució a cinc caselles.
    ocupats = {(e["x"], e["y"]) for e in ESTAT["enemics"]}
    for enemic in ESTAT["enemics"]:
        antic = (enemic["x"], enemic["y"])
        if distancia(antic, ESTAT["jugador"]) == 1:
            ESTAT["vida"] -= 1
            missatge += " Un monstre t'ha fet 1 punt de mal!"
            continue
        if distancia(antic, ESTAT["jugador"]) > 5:
            continue
        tx, ty = ESTAT["jugador"]
        opcions = []
        if tx != antic[0]:
            opcions.append((1 if tx > antic[0] else -1, 0))
        if ty != antic[1]:
            opcions.append((0, 1 if ty > antic[1] else -1))
        random.shuffle(opcions)
        for mx, my in opcions:
            nou = (antic[0] + mx, antic[1] + my)
            if lliure(*nou) and nou not in ocupats and nou != ESTAT["jugador"] and nou != ESTAT["porta"]:
                enemic["x"], enemic["y"] = nou
                ocupats.remove(antic)
                ocupats.add(nou)
                break

    if ESTAT["vida"] <= 0:
        ESTAT["vida"] = 0
        ESTAT["estat"] = "derrota"
        missatge = "Has perdut tota la vida. La masmorra t'ha vençut."
    return mostrar(missatge or "Continua explorant la masmorra.")
