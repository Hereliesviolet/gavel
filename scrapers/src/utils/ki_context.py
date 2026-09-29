"""
Kontext-Aufbereitung für die KI-Analyse.

build_analysis_context() bereitet Beschreibung + Gutachten + Exposé auf:

  1. Boilerplate-Erkennung (Disclaimer, Kopf-/Fußzeilen).
  2. Dedup zwischen Gutachten und Exposé.
  3. Auswahl relevanter Kapitel/Absätze statt pauschaler 35k-Zeichen-Köpfe.
  4. Hartes Gesamtbudget je nach Analysetiefe (basic 8k / full 14k).
"""

import re
from typing import Literal

from loguru import logger

AnalysisTier = Literal["basic", "full"]

_BOILERPLATE_PATTERNS = [
    r"dieses gutachten (wurde|ist) .{0,40}(erstellt|urheberrechtlich)",
    r"haftung.{0,20}(ausschluss|übernommen|übernehmen)",
    r"nachdruck.{0,20}nur mit .{0,20}genehmigung",
    r"alle angaben (ohne gewähr|nach bestem wissen)",
    r"vervielfältigung.{0,30}(nur|ausschließlich)",
    r"©\s*\d{4}",
    r"^\s*seite\s+\d+\s*(von|/)\s*\d+\s*$",
    r"^\s*[-–—_=]{3,}\s*$",
]
_BOILERPLATE_RE = re.compile("|".join(_BOILERPLATE_PATTERNS), re.IGNORECASE | re.MULTILINE)

BASIC_CONTEXT_CHARS = 8000
FULL_CONTEXT_CHARS = 14000

_RELEVANT_HINTS = (
    "grundbuch",
    "flurstück",
    "flurstueck",
    "gemarkung",
    "blatt",
    "wohnfläche",
    "wohnflaeche",
    "nutzfläche",
    "nutzflaeche",
    "grundstück",
    "grundstueck",
    "baujahr",
    "zimmer",
    "heizung",
    "energie",
    "effizienz",
    "mangel",
    "mängel",
    "schaden",
    "feucht",
    "schimmel",
    "belastung",
    "baulast",
    "wegerecht",
    "wohnrecht",
    "modernisierung",
    "instandhaltung",
    "zustand",
    "lage",
    "verkehrswert",
    "bodenrichtwert",
    "ertrag",
    "miete",
    "rohertrag",
    "liegenschaft",
    "restnutzung",
    "denkmalschutz",
    "wertermittlung",
    "zusammenfassung",
    "ertragswert",
    "bodenwert",
    "sachwert",
)

_VALUE_HINTS = (
    "verkehrswert",
    "zusammenfassung",
    "wertermittlung",
    "ertragswert",
    "bodenwert",
    "sachwert",
    "bodenrichtwert",
)

_HEADING_RE = re.compile(
    r"^(?:\d+(?:\.\d+)*\.?\s+|[A-ZÄÖÜ][A-ZÄÖÜ\s/-]{8,}$)",
)


def context_budget(tier: AnalysisTier) -> int:
    return BASIC_CONTEXT_CHARS if tier == "basic" else FULL_CONTEXT_CHARS


def _split_paragraphs(text: str) -> list[str]:
    if not text:
        return []
    parts = re.split(r"\n\s*\n", text)
    return [p.strip() for p in parts if len(p.strip()) > 15]


def _normalize_paragraph(p: str) -> str:
    p = p.lower().strip()
    p = re.sub(r"\s+", " ", p)
    p = re.sub(r"[^\w\s]", "", p)
    return p


def _is_boilerplate(paragraph: str) -> bool:
    return bool(_BOILERPLATE_RE.search(paragraph))


def _dedupe_paragraphs(paragraphs: list[str], seen_normalized: set[str]) -> list[str]:
    kept = []
    for p in paragraphs:
        norm = _normalize_paragraph(p)
        if not norm:
            continue
        if norm in seen_normalized:
            continue
        if any(len(s) > 40 and (norm in s or s in norm) for s in seen_normalized):
            continue
        seen_normalized.add(norm)
        kept.append(p)
    return kept


def paragraph_relevance_score(paragraph: str) -> int:
    low = paragraph.lower()
    score = 0
    for hint in _RELEVANT_HINTS:
        if hint in low:
            score += 2
    for hint in _VALUE_HINTS:
        if hint in low:
            score += 3
    if _HEADING_RE.match(paragraph.strip()):
        score += 1
    return score


def _join_paragraphs(paragraphs: list[str]) -> str:
    return "\n\n".join(paragraphs)


def select_relevant_paragraphs(
    paragraphs: list[str],
    budget: int,
    keep_head: int = 2,
) -> list[str]:
    """Behält Objektkopf, Wert-/Zusammenfassung und relevante Kapitel im Budget."""
    if not paragraphs or budget <= 0:
        return []

    n = len(paragraphs)
    must: set[int] = set(range(min(keep_head, n)))
    for i in range(n - 1, max(-1, n - 8), -1):
        low = paragraphs[i].lower()
        if (
            any(hint in low for hint in _VALUE_HINTS)
            or paragraph_relevance_score(paragraphs[i]) >= 4
        ):
            must.add(i)

    ranked = sorted(
        ((i, paragraph_relevance_score(paragraphs[i])) for i in range(n) if i not in must),
        key=lambda item: (-item[1], item[0]),
    )
    selected = set(must)
    for i, score in ranked:
        if score <= 0:
            continue
        selected.add(i)
        if len(_join_paragraphs(paragraphs[j] for j in sorted(selected))) > budget:
            selected.remove(i)

    kept: list[str] = []
    used = 0
    for i in sorted(selected):
        paragraph = paragraphs[i]
        extra = len(paragraph) + (2 if kept else 0)
        if used + extra > budget:
            remain = budget - used - (2 if kept else 0)
            if remain > 80:
                kept.append(paragraph[:remain].rstrip() + "…")
            break
        kept.append(paragraph)
        used += extra
    return kept


def _prepare_paragraphs(text: str, seen_normalized: set[str]) -> list[str]:
    if not text:
        return []
    paragraphs = [p for p in _split_paragraphs(text) if not _is_boilerplate(p)]
    return _dedupe_paragraphs(paragraphs, seen_normalized)


def build_analysis_context(
    listing: dict,
    gutachten_text: str = "",
    expose_text: str = "",
    tier: AnalysisTier = "full",
) -> str:
    budget = context_budget(tier)
    seen_normalized: set[str] = set()
    sections: list[str] = []
    remaining = budget

    beschreibung = (listing.get("beschreibung") or "").strip()
    if len(beschreibung) > 50:
        desc_cap = 1500 if tier == "basic" else 2500
        desc = beschreibung[:desc_cap]
        block = f"BESCHREIBUNG:\n{desc}"
        sections.append(block)
        remaining -= len(block) + 7
        for p in _split_paragraphs(beschreibung):
            seen_normalized.add(_normalize_paragraph(p))

    expose_reserve = 0
    if expose_text and remaining > 0:
        expose_reserve = min(1500 if tier == "basic" else 2500, max(0, remaining // 4))

    gutachten_kept = select_relevant_paragraphs(
        _prepare_paragraphs(gutachten_text, seen_normalized),
        max(0, remaining - expose_reserve),
    )
    if gutachten_kept:
        block = "GUTACHTEN (aus PDF extrahiert):\n" + _join_paragraphs(gutachten_kept)
        sections.append(block)
        remaining = budget - sum(len(s) for s in sections) - 7 * (len(sections) - 1)

    expose_kept = select_relevant_paragraphs(
        _prepare_paragraphs(expose_text, seen_normalized),
        max(0, remaining),
    )
    if expose_kept:
        sections.append("--- EXPOSÉ / KURZBESCHREIBUNG ---\n" + _join_paragraphs(expose_kept))

    context = "\n\n---\n\n".join(sections)
    if len(context) > budget:
        context = context[:budget].rstrip() + "…"

    raw_total = len(beschreibung) + len(gutachten_text or "") + len(expose_text or "")
    final_total = len(context)
    if raw_total > 0:
        saved_pct = round(100 * (1 - final_total / raw_total), 1)
        logger.info(
            f"ki_context [{listing.get('aktenzeichen', '?')}] tier={tier} "
            f"roh={raw_total} Zeichen (~{raw_total // 4} Tokens) → "
            f"aufbereitet={final_total} Zeichen (~{final_total // 4} Tokens) "
            f"({saved_pct}% weniger Zeichen)"
        )

    return context
