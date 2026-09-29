export const PEER_MIN_SAMPLE_SIZE = 5;
export const PEER_RELIABLE_SAMPLE_SIZE = 10;
export const PEER_HIGH_CONFIDENCE_SAMPLE_SIZE = 20;

export type BenchmarkScope = "category_state" | "category_national" | "global" | "none";

export type BenchmarkConfidence = "high" | "medium" | "low" | "insufficient";

export interface PeerBenchmark {
  medianEurM2: number | null;
  p25EurM2: number | null;
  p75EurM2: number | null;
  sampleSize: number;
  scope: BenchmarkScope;
  confidence: BenchmarkConfidence;
  sufficient: boolean;
  reliable: boolean;
}

export interface PeerBenchmarkInput {
  medianEurM2?: number | string | null;
  p25EurM2?: number | string | null;
  p75EurM2?: number | string | null;
  sampleSize?: number | string | null;
  scope?: BenchmarkScope;
}

function finiteNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildPeerBenchmark(input: PeerBenchmarkInput): PeerBenchmark {
  const medianEurM2 = finiteNumber(input.medianEurM2);
  const p25EurM2 = finiteNumber(input.p25EurM2);
  const p75EurM2 = finiteNumber(input.p75EurM2);
  const sampleSize = Math.max(0, Math.floor(finiteNumber(input.sampleSize) ?? 0));
  const hasValidMedian = medianEurM2 != null && medianEurM2 > 0;
  const sufficient = hasValidMedian && sampleSize >= PEER_MIN_SAMPLE_SIZE;
  const reliable = hasValidMedian && sampleSize >= PEER_RELIABLE_SAMPLE_SIZE;

  let confidence: BenchmarkConfidence = "insufficient";
  if (hasValidMedian && sampleSize >= PEER_HIGH_CONFIDENCE_SAMPLE_SIZE) {
    confidence = "high";
  } else if (reliable) {
    confidence = "medium";
  } else if (sufficient) {
    confidence = "low";
  }

  return {
    medianEurM2,
    p25EurM2,
    p75EurM2,
    sampleSize,
    scope: input.scope ?? (hasValidMedian ? "category_state" : "none"),
    confidence,
    sufficient,
    reliable,
  };
}

export function computeBenchmarkDiscountPct(
  priceEurM2: number | null | undefined,
  benchmark: PeerBenchmark | null | undefined,
): number | null {
  if (
    priceEurM2 == null ||
    !Number.isFinite(priceEurM2) ||
    priceEurM2 <= 0 ||
    !benchmark?.sufficient ||
    benchmark.medianEurM2 == null ||
    benchmark.medianEurM2 <= 0
  ) {
    return null;
  }

  return (1 - priceEurM2 / benchmark.medianEurM2) * 100;
}

export function benchmarkLabel(benchmark: PeerBenchmark | null | undefined): string {
  if (!benchmark?.sufficient) return "Keine belastbare Vergleichsgruppe";
  if (benchmark.reliable) {
    return `ZVG-Peer-Median · n=${benchmark.sampleSize}`;
  }
  return `Schwache ZVG-Indikation · n=${benchmark.sampleSize}`;
}
