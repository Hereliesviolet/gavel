"""Abbruchbedingung für Scrape-Läufe, die nichts mehr speichern können.

Am 14.08.2026 referenzierte das Upsert-Statement zwei Platzhalter, die es nie
übergeben bekam. upsert_zvg_listing() fängt solche Fehler ab und gibt None
zurück, die Flows zählten das nur als "fehlgeschlagen" weiter und meldeten
trotzdem COMPLETED - drei Tage lang stand im Log "0 gespeichert, 109
fehlgeschlagen" und in Prefect grün. Ein Lauf, der seinen kompletten Ertrag
verliert, muss rot werden.
"""

from __future__ import annotations

# Anteil der Speicherversuche, der mindestens gelingen muss. Einzelne Objekte
# scheitern immer mal (kaputter Datensatz, Timeout) - unter der Hälfte kommt
# man dadurch nicht, dafür braucht es eine gemeinsame Ursache: fehlerhaftes
# Statement, Schemawechsel, tote Verbindung. Eine strengere Grenze (etwa 90 %)
# würde bei kleinen Läufen schon an zwei unglücklichen Datensätzen scheitern.
MINDEST_SPEICHERQUOTE = 0.5


class SpeicherquoteUnterschritten(RuntimeError):
    pass


def pruefe_speicherquote(quelle: str, gespeichert: int, fehlgeschlagen: int) -> None:
    """Wirft, wenn ein Lauf zwar Objekte speichern wollte, aber kaum eines ankam.

    Bezugsgröße sind die tatsächlichen Speicherversuche, nicht die Trefferzahl
    der Quelle: ein Lauf ohne gescrapte Objekte (Feiertag, leere Seite,
    ausschließlich aufgehobene Termine) ist legitim und darf nicht scheitern.

    Die Quote gilt je Quelle, nicht je Bundesland: der Fehlerfall ist immer
    systemisch, während ein einzelnes Bundesland mit zwei Objekten sonst schon
    bei einem Ausreißer rot würde.
    """
    versuche = gespeichert + fehlgeschlagen
    if versuche == 0:
        return

    quote = gespeichert / versuche
    if quote < MINDEST_SPEICHERQUOTE:
        raise SpeicherquoteUnterschritten(
            f"{quelle}: nur {gespeichert} von {versuche} gescrapten Objekten gespeichert "
            f"({fehlgeschlagen} fehlgeschlagen, Quote {quote:.0%} < "
            f"{MINDEST_SPEICHERQUOTE:.0%}). Lauf gilt als fehlgeschlagen, "
            f"damit der Bestand nicht still veraltet."
        )
