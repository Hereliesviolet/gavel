"""
Analyse-Schema-Marker in `model_used`.

Daily schreibt `basic-v1`. Die User-Vollanalyse schreibt `full-v1`.
Custom-URL und ältere ZVG-Läufe behalten `investment-v2`.
"""

ANALYSIS_SCHEMA_VERSION = "investment-v2"
BASIC_SCHEMA_VERSION = "basic-v1"
FULL_SCHEMA_VERSION = "full-v1"


def schema_marker_for_tier(tier: str | None) -> str:
    if tier == "basic":
        return BASIC_SCHEMA_VERSION
    if tier == "full":
        return FULL_SCHEMA_VERSION
    return ANALYSIS_SCHEMA_VERSION


def with_schema_version(model_used: str | None, tier: str | None = None) -> str:
    marker = schema_marker_for_tier(tier)
    base = model_used or ""
    if marker in base:
        return base
    if not base:
        return marker
    return f"{base}+{marker}"
