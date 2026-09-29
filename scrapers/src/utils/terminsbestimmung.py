"""
Parser für die amtliche Terminsbestimmung.

Zwei Zahlen entscheiden darüber, ob ein Objekt überhaupt gebotsreif ist, und
beide standen bisher nirgends: das geringste Gebot und der kapitalisierte Wert
bestehenbleibender Rechte. Die Oberfläche hat das Mindestgebot deshalb mit
`verkehrswert * 0,75` geraten — eine Rechtstatsache war so nicht mehr von einer
Schätzung zu unterscheiden.

Bewusst regelbasiert und ohne LLM: die Bekanntmachung ist ein Formulartext mit
festen Wendungen ("Das geringste Gebot beträgt …"). Was nicht eindeutig
dasteht, bleibt None. Eine geratene Zahl wäre hier schlimmer als gar keine.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_BETRAG = r"([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{2})?)"

_GERINGSTES_GEBOT = re.compile(
    rf"geringste[sn]?\s+Gebot[^0-9€]{{0,80}}?{_BETRAG}\s*(?:€|EUR)",
    re.IGNORECASE | re.DOTALL,
)

# Bestehenbleibende Rechte werden im geringsten Gebot als Kapitalwert
# ausgewiesen ("bestehen bleiben … mit einem Wert von X €"). Die Endung ist
# offen, weil beide Numeri vorkommen ("bleiben", "bleibt").
_RECHTE_BETRAG = re.compile(
    rf"bestehen\s*bleib\w*[^0-9€]{{0,160}}?{_BETRAG}\s*(?:€|EUR)",
    re.IGNORECASE | re.DOTALL,
)

_RECHTE_SATZ = re.compile(
    r"([^\n]{0,200}bestehen\s*bleib\w*[^\n]{0,200})",
    re.IGNORECASE,
)

# "Rechte bleiben nicht bestehen" ist die häufigste Formulierung für den
# Normalfall und darf nicht als Betrag von 0 € verloren gehen.
_KEINE_RECHTE = re.compile(
    r"(?:bleib\w*\s+nicht\s+bestehen"
    r"|(?:keine|nicht)\s+(?:\w+\s+){0,3}bestehen\s*bleib\w*)",
    re.IGNORECASE,
)


@dataclass(slots=True)
class Terminsdaten:
    geringstes_gebot_eur: int | None = None
    bestehende_rechte_eur: int | None = None
    bestehende_rechte_text: str | None = None

    @property
    def brauchbar(self) -> bool:
        return self.geringstes_gebot_eur is not None or self.bestehende_rechte_eur is not None


def _zu_euro(roh: str) -> int | None:
    bereinigt = re.sub(r"[.\s]", "", roh).split(",")[0]
    if not bereinigt.isdigit():
        return None
    wert = int(bereinigt)
    return wert if 100 <= wert <= 50_000_000 else None


def parse_terminsbestimmung(text: str | None) -> Terminsdaten:
    if not text:
        return Terminsdaten()

    daten = Terminsdaten()

    treffer = _GERINGSTES_GEBOT.search(text)
    if treffer:
        daten.geringstes_gebot_eur = _zu_euro(treffer.group(1))

    satz = _RECHTE_SATZ.search(text)
    if satz:
        daten.bestehende_rechte_text = re.sub(r"\s+", " ", satz.group(1)).strip()

    if _KEINE_RECHTE.search(text):
        daten.bestehende_rechte_eur = 0
    else:
        rechte = _RECHTE_BETRAG.search(text)
        if rechte:
            daten.bestehende_rechte_eur = _zu_euro(rechte.group(1))

    return daten
