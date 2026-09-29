const MAX_AKTIVE = 1_000_000;
const MAX_ALTER_MINUTEN = 10_000_000;
const MAX_SCHWELLE_STUNDEN = 168;
const MAX_ZEITPUNKT_CHARS = 80;

export type DataFreshnessAlert = {
  aktiveObjekte: number;
  letzterSchreibzeitpunkt: string | null;
  alterMinuten: number | null;
  schwelleStunden: number;
};

function finiteInt(raw: unknown, min: number, max: number): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    return null;
  }
  if (raw < min || raw > max) return null;
  return raw;
}

export function parseDataFreshnessAlert(raw: unknown): DataFreshnessAlert | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;

  const aktiveObjekte = finiteInt(body.aktiveObjekte, 0, MAX_AKTIVE);
  const schwelleStunden = finiteInt(body.schwelleStunden, 1, MAX_SCHWELLE_STUNDEN);
  if (aktiveObjekte == null || schwelleStunden == null) return null;

  let letzterSchreibzeitpunkt: string | null = null;
  if (body.letzterSchreibzeitpunkt != null) {
    if (typeof body.letzterSchreibzeitpunkt !== "string") return null;
    const clipped = body.letzterSchreibzeitpunkt.trim().slice(0, MAX_ZEITPUNKT_CHARS);
    letzterSchreibzeitpunkt = clipped || null;
  }

  let alterMinuten: number | null = null;
  if (body.alterMinuten != null) {
    alterMinuten = finiteInt(body.alterMinuten, 0, MAX_ALTER_MINUTEN);
    if (alterMinuten == null) return null;
  }

  return {
    aktiveObjekte,
    letzterSchreibzeitpunkt,
    alterMinuten,
    schwelleStunden,
  };
}
