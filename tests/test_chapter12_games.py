"""Proves offline del tema 12 i del projecte 12.5.

Execució: python -m unittest discover -s tests -p 'test_chapter12_games.py'
No necessita Pyodide, Cloudflare ni connexió a la xarxa.
"""
import contextlib
import io
import json
from pathlib import Path
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "src" / "chapter12.js"


def exercises():
    raw = SOURCE.read_text(encoding="utf-8")
    array = raw.split("export const chapter12Exercises=", 1)[1].rsplit(";", 1)[0]
    return {e["code"]: e for e in json.loads(array)}


def execute(source):
    namespace = {"__name__": "__main__"}
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(compile(source, "<curs>", "exec"), namespace)
    return namespace, output.getvalue().strip().splitlines()


class Chapter12Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.course = exercises()

    def test_five_exercises_in_the_right_order(self):
        self.assertEqual(list(self.course), ["12.1", "12.2", "12.3", "12.4", "12.5"])
        self.assertEqual([e["type"] for e in self.course.values()],
                         ["predict", "investigate", "modify", "build", "project"])

    def test_12_1_predictions(self):
        _, out = execute(self.course["12.1"]["starter"])
        self.assertEqual(out, [".", "K", "(2, 1)", "."])

    def test_12_2_investigation(self):
        _, out = execute(self.course["12.2"]["starter"])
        self.assertEqual(out, ["True", "False", "False", "3"])

    def test_12_3_solution_and_tests(self):
        _, out = execute(self.course["12.3"]["solution"])
        self.assertEqual(out, ["(2, 1)", "(2, 1)", "(1, 1)"])
        self.assertIn("TODO", self.course["12.3"]["starter"])

    def test_12_4_solution_and_tests(self):
        _, out = execute(self.course["12.4"]["solution"])
        self.assertEqual(out, ["victoria", "True", "8"])
        self.assertIn("TODO", self.course["12.4"]["starter"])

    def test_12_5_starter_renders_valid_initial_state(self):
        scope, _ = execute(self.course["12.5"]["starter"])
        initial = scope["inicia"]()
        self.assertEqual(initial["estat"], "jugant")
        self.assertEqual(initial["jugador"], [1, 1])
        self.assertIsInstance(initial["mapa"], list)
        self.assertTrue(all(len(row) == len(initial["mapa"][0]) for row in initial["mapa"]))
        self.assertEqual(initial["vida"], 5)

    def test_12_5_walk_key_and_escape(self):
        scope, _ = execute(self.course["12.5"]["starter"])
        scope["inicia"]()
        # (1,1) -> (6,1): la clau es recull al cinquè pas.
        state = None
        for _ in range(5):
            state = scope["torn"]("dreta")
        self.assertEqual(state["jugador"], [6, 1])
        self.assertTrue(state["te_clau"])
        self.assertEqual(state["puntuacio"], 10)
        for move in ["dreta", "dreta", "avall", "avall", "avall", "avall"]:
            state = scope["torn"](move)
        self.assertEqual(state["estat"], "victoria")
        self.assertEqual(state["torns"], 11)

    def test_12_5_blocked_wall_and_reset(self):
        scope, _ = execute(self.course["12.5"]["starter"])
        scope["inicia"]()
        blocked = scope["torn"]("esquerra")
        self.assertEqual(blocked["jugador"], [1, 1])
        self.assertEqual(blocked["torns"], 1)
        restart = scope["inicia"]()
        self.assertEqual(restart["jugador"], [1, 1])
        self.assertEqual(restart["torns"], 0)
        self.assertFalse(restart["te_clau"])

    def test_no_input_loop_in_12_5_starter(self):
        code = self.course["12.5"]["starter"]
        statements = "\n".join(line for line in code.splitlines() if not line.lstrip().startswith("#"))
        self.assertNotIn("input(", statements)
        self.assertNotIn("while True:", statements)


if __name__ == "__main__":
    unittest.main()
