"""Seitenweises Auslesen von PDFs ohne Textebene.

Rund drei Viertel der ZVG-Gutachten sind Scans: pdfplumber liefert dort nur
Deckblatt-Fragmente, obwohl das Dokument 50 Seiten hat. Fuer diese Faelle
werden Seiten gerendert und dem Vision-Modell vorgelegt.
"""

import base64
import io
import time
from typing import Optional

import pypdfium2 as pdfium
from loguru import logger

STANDARD_DPI = 110
STANDARD_QUALITAET = 60


def seiten_anzahl(pdf_bytes: bytes) -> int:
    return len(pdfium.PdfDocument(pdf_bytes))


def rendere_seiten(
    pdf_bytes: bytes,
    von: int,
    bis: int,
    dpi: int = STANDARD_DPI,
    qualitaet: int = STANDARD_QUALITAET,
) -> list[str]:
    """Rendert die Seiten [von, bis) als base64-JPEG."""
    pdf = pdfium.PdfDocument(pdf_bytes)
    bilder = []
    for index in range(von, min(bis, len(pdf))):
        seite = pdf[index].render(scale=dpi / 72).to_pil().convert("RGB")
        puffer = io.BytesIO()
        seite.save(puffer, "JPEG", quality=qualitaet)
        bilder.append(base64.b64encode(puffer.getvalue()).decode())
    return bilder


def frage_an_seiten(
    client,
    model: str,
    bilder: list[str],
    frage: str,
    max_tokens: int = 300,
    versuche: int = 3,
) -> Optional[str]:
    """Stellt eine Frage zu gerenderten Seiten. Der Langdock-Endpunkt
    antwortet sporadisch mit 500, deshalb Wiederholung mit Backoff."""
    if not bilder:
        return None
    inhalt = [
        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": bild}}
        for bild in bilder
    ]
    inhalt.append({"type": "text", "text": frage})

    for versuch in range(versuche):
        try:
            antwort = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": inhalt}],
            )
            return antwort.content[0].text
        except Exception as exc:
            if versuch == versuche - 1:
                logger.warning(f"Vision-Abfrage endgueltig fehlgeschlagen: {exc}")
                return None
            time.sleep(2 * (versuch + 1))
    return None
