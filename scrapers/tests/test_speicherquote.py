import pytest

from src.utils.speicherquote import SpeicherquoteUnterschritten, pruefe_speicherquote


def test_lauf_ohne_gescrapte_objekte_ist_kein_fehler():
    pruefe_speicherquote("zvg.com", gespeichert=0, fehlgeschlagen=0)


def test_vollstaendiger_speicherausfall_scheitert():
    # Der Vorfall vom 14.08.2026: 109 Objekte gescrapt, keines gespeichert.
    with pytest.raises(SpeicherquoteUnterschritten) as fehler:
        pruefe_speicherquote("justizportal", gespeichert=0, fehlgeschlagen=109)
    assert "109" in str(fehler.value)


def test_einzelne_fehlschlaege_sind_erlaubt():
    pruefe_speicherquote("hanmark.de", gespeichert=95, fehlgeschlagen=5)


def test_mehrheitlicher_ausfall_scheitert():
    with pytest.raises(SpeicherquoteUnterschritten):
        pruefe_speicherquote("hanmark.de", gespeichert=40, fehlgeschlagen=60)
