"""Statische Prüfung der asyncpg-Platzhalter in src/storage/.

Am 14.08.2026 wurden in upsert_zvg_listing die INSERT-Platzhalter umnummeriert,
die drei Parameter im ON-CONFLICT-Zweig aber nicht. Das Statement referenzierte
$42-$44 bei 42 übergebenen Werten; Postgres lehnte es schon beim Vorbereiten ab
("could not determine data type of parameter $40"). Der Fehler ist rein
textuell und deshalb ohne Datenbank auffindbar: die Platzhalter müssen lückenlos
von $1 bis $N laufen und N muss der Zahl der übergebenen Argumente entsprechen.
"""

import ast
import importlib
import inspect
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

MODULE = ["src.storage.postgres", "src.storage.market", "src.storage.real_estate"]

# executemany bleibt außen vor: dort ist das zweite Argument eine Sequenz von
# Parametersätzen, die Zählung wäre eine andere.
METHODEN = {"execute", "fetch", "fetchrow", "fetchval"}

PLATZHALTER = re.compile(r"\$(\d+)")


def _funktion_je_zeile(baum: ast.Module) -> dict[int, str]:
    zuordnung: dict[int, str] = {}
    for knoten in ast.walk(baum):
        if isinstance(knoten, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for zeile in range(knoten.lineno, (knoten.end_lineno or knoten.lineno) + 1):
                zuordnung[zeile] = knoten.name
    return zuordnung


def _argumentanzahl(aufruf: ast.Call, modul) -> int | None:
    """Zahl der Query-Argumente, oder None wenn sie nicht statisch feststeht."""
    anzahl = 0
    for argument in aufruf.args[1:]:
        if isinstance(argument, ast.Starred):
            if not isinstance(argument.value, ast.Name):
                return None
            wert = getattr(modul, argument.value.id, None)
            if not isinstance(wert, (tuple, list)):
                return None
            anzahl += len(wert)
        else:
            anzahl += 1
    return anzahl


def _sql_aufrufe() -> list:
    faelle = []
    for modulname in MODULE:
        modul = importlib.import_module(modulname)
        baum = ast.parse(inspect.getsource(modul))
        funktionen = _funktion_je_zeile(baum)

        for knoten in ast.walk(baum):
            if not isinstance(knoten, ast.Call):
                continue
            if not isinstance(knoten.func, ast.Attribute) or knoten.func.attr not in METHODEN:
                continue
            if not knoten.args:
                continue
            sql = knoten.args[0]
            # Dynamisch zusammengebaute Statements (f-String, join) haben keine
            # feste Platzhalterzahl und werden hier bewusst nicht geprüft.
            if not isinstance(sql, ast.Constant) or not isinstance(sql.value, str):
                continue
            if "$" not in sql.value:
                continue
            anzahl = _argumentanzahl(knoten, modul)
            if anzahl is None:
                continue

            name = funktionen.get(knoten.lineno, modulname)
            faelle.append(pytest.param(sql.value, anzahl, id=f"{name}:{knoten.lineno}"))
    return faelle


AUFRUFE = _sql_aufrufe()


def test_findet_ueberhaupt_statements():
    assert len(AUFRUFE) > 20


@pytest.mark.parametrize("sql,argumente", AUFRUFE)
def test_platzhalter_laufen_lueckenlos(sql: str, argumente: int):
    nummern = {int(n) for n in PLATZHALTER.findall(sql)}
    assert nummern == set(range(1, max(nummern) + 1))


@pytest.mark.parametrize("sql,argumente", AUFRUFE)
def test_hoechster_platzhalter_entspricht_argumentzahl(sql: str, argumente: int):
    hoechster = max(int(n) for n in PLATZHALTER.findall(sql))
    assert hoechster == argumente
