"""Proves del prototip roguelike, sense dependències externes.

Executa: python -m unittest discover -s tests -p 'test_roguelike.py'
"""
from collections import deque
from pathlib import Path
import runpy
import unittest

GAME = Path(__file__).resolve().parents[1] / "public" / "roguelike-prototype.py"

class RoguelikePrototypeTests(unittest.TestCase):
    def setUp(self):
        self.module = runpy.run_path(str(GAME))
        self.start = self.module["inicia"]
        self.turn = self.module["torn"]
        self.state = self.turn.__globals__["ESTAT"]
        self.start()
        self.state = self.turn.__globals__["ESTAT"]

    def test_map_is_rectangular_and_exits_are_reachable(self):
        board = self.module["MAPA"]
        self.assertEqual(len(set(map(len, board))), 1)
        self.assertTrue(all("".join(set(row)) or row for row in board))
        def reachable(origin):
            seen={origin}
            todo=deque([origin])
            while todo:
                x,y=todo.popleft()
                for dx,dy in ((0,1),(1,0),(0,-1),(-1,0)):
                    p=(x+dx,y+dy)
                    if p not in seen and 0<=p[1]<len(board) and 0<=p[0]<len(board[0]) and board[p[1]][p[0]]==".":
                        seen.add(p)
                        todo.append(p)
            return seen
        self.assertIn(self.state["clau"],reachable(self.state["jugador"]))
        self.assertIn(self.state["porta"],reachable(self.state["clau"]))

    def test_wall_blocks_movement_and_counts_turn(self):
        first=self.start()
        result=self.turn("amunt")
        self.assertEqual(first["jugador"],result["jugador"])
        self.assertEqual(result["torns"],1)

    def test_key_can_be_collected(self):
        self.state["jugador"]=(16,1)
        result=self.turn("dreta")
        self.assertTrue(result["te_clau"])
        self.assertIsNone(result["clau"])

    def test_locked_door_and_victory(self):
        self.state["jugador"]=(17,12)
        self.assertEqual(self.turn("dreta")["estat"],"jugant")
        self.state["te_clau"]=True
        result=self.turn("dreta")
        self.assertEqual(result["estat"],"victoria")

    def test_combat_damages_enemy_without_moving(self):
        self.state["enemics"]=[{"x":3,"y":1,"vida":2}]
        result=self.turn("dreta")
        self.assertEqual(result["jugador"],[2,1])
        self.assertEqual(result["enemics"][0]["vida"],1)

    def test_potion_heals_with_cap(self):
        self.state["jugador"]=(2,10)
        self.state["vida"]=7
        self.state["enemics"]=[]
        result=self.turn("dreta")
        self.assertEqual(result["vida"],8)
        self.assertNotIn([3,10],result["pocions"])

    def test_invalid_direction_does_not_consume_a_turn(self):
        result=self.turn("ir a la lluna")
        self.assertEqual(result["torns"],0)

    def test_configured_wait_spends_turn_inventory_does_not(self):
        initial = self.start()
        self.assertEqual(initial["controls"]["espai"]["accio"], "esperar")
        self.assertEqual(initial["controls"]["i"]["accio"], "inventari")
        inventory = self.turn("inventari")
        self.assertEqual(inventory["torns"], 0)
        self.assertIn("Inventari", inventory["missatge"])
        waiting = self.turn("esperar")
        self.assertEqual(waiting["torns"], 1)
        self.assertEqual(waiting["jugador"], initial["jugador"])

    def test_restart_resets_state(self):
        self.turn("dreta")
        self.assertEqual(self.start()["torns"],0)

if __name__ == "__main__":
    unittest.main()
