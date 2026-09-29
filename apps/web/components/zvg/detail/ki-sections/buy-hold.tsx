"use client";

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { KiSection } from "@/components/zvg/detail/ki-section";
import { cn, berechneErwerbskosten, hatDeutscheGrunderwerbsteuer } from "@/lib/utils";
import { berechneBuyHoldProjektion } from "@/lib/underwriting";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Buy & Hold – Finanzierung & Cashflow-Projektion (geteilte Komponente für
 * ZVG- UND Custom-URL-Detailseiten, analog zu InvestmentFixFlipSection im
 * selben Ordner). Komplett client-seitig/reaktiv, KEIN Server-Roundtrip -
 * die eigentliche Rechenlogik steckt in lib/buy-hold-calc.ts.
 *
 * ALLE Props sind optional und robust gegen fehlende Werte (alte Analysen
 * ohne moegliche_kaltmiete/hausgeld o.ä. dürfen nicht crashen) - fehlende
 * Werte führen lediglich zu leeren/generischen Default-Eingabefeldern, die
 * der Nutzer selbst befüllen kann.
 */
export interface BuyHoldCardProps {
  kaufpreisEur?: number | string | null;
  /** Verkehrswert für ZVG-Verzinsung; fehlt er, gilt der Kaufpreis. */
  verkehrswertEur?: number | string | null;
  /** Woher der voreingestellte Kaufpreis kommt, z. B. "Referenzgebot 70 %". */
  kaufpreisLabel?: string | null;
  kiMieteSchaetzungEur?: number | string | null;
  /** Aus geernteten Angebotsmieten im Mikromarkt; schlägt die KI-Schätzung. */
  marktmieteEur?: number | null;
  hausgeldEur?: number | string | null;
  wohnflaecheM2?: number | string | null;
  bundesland?: string | null;
}

function toNumber(v: number | string | null | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

function formatEur(v: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}

export function BuyHoldCard({
  kaufpreisEur,
  verkehrswertEur,
  kaufpreisLabel,
  kiMieteSchaetzungEur,
  marktmieteEur,
  hausgeldEur,
  wohnflaecheM2,
  bundesland,
}: BuyHoldCardProps) {
  const kaufpreisInitial = toNumber(kaufpreisEur) ?? 0;
  const verkehrswertInitial = toNumber(verkehrswertEur);
  const hausgeldInitial = toNumber(hausgeldEur);
  const wohnflaecheInitial = toNumber(wohnflaecheM2);

  const erwerbsnebenkostenInitial =
    kaufpreisInitial && hatDeutscheGrunderwerbsteuer(bundesland)
      ? berechneErwerbskosten(verkehrswertInitial ?? kaufpreisInitial, kaufpreisInitial, bundesland)
          .gesamt
      : 0;

  const [kaufpreis, setKaufpreis] = useState(kaufpreisInitial);
  const [kaltmiete, setKaltmiete] = useState<number | "">(
    marktmieteEur ?? toNumber(kiMieteSchaetzungEur) ?? "",
  );
  const mietHerkunft =
    marktmieteEur != null
      ? "Aus geernteten Angebotsmieten im Mikromarkt."
      : "KI-Schätzung aus dem Gutachten, keine Marktbeobachtung — bitte prüfen.";
  const [eigenkapital, setEigenkapital] = useState(
    Math.round((kaufpreisInitial + erwerbsnebenkostenInitial) * 0.2),
  );
  // Zinssatz-Default 3,8 % p.a. - grobe Annahme (Stand 2026), im Einzelfall
  // beim eigenen Finanzierer erfragen. KEINE Finanzierungsberatung.
  const [zinssatz, setZinssatz] = useState(3.8);
  const [tilgungssatz, setTilgungssatz] = useState(2.0);
  const [zinsbindung, setZinsbindung] = useState(10);
  const [anschlusszinssatz, setAnschlusszinssatz] = useState(4.8);
  const [nichtUmlagefaehig, setNichtUmlagefaehig] = useState(() => {
    if (hausgeldInitial) return Math.round(hausgeldInitial * 0.3);
    if (wohnflaecheInitial) return Math.round(wohnflaecheInitial * 1);
    return 50;
  });
  const [verwaltung, setVerwaltung] = useState(25);
  const [mietausfallwagnis, setMietausfallwagnis] = useState(2);
  const [mietsteigerung, setMietsteigerung] = useState(1.5);
  // Persönlicher Grenzsteuersatz - dient hier NUR der Ableitung der
  // AfA-Steuerersparnis, keine Steuerberatung.
  const [grenzsteuersatz, setGrenzsteuersatz] = useState(42);
  const [projektionsjahre, setProjektionsjahre] = useState(15);

  const erwerbsnebenkosten =
    kaufpreis && hatDeutscheGrunderwerbsteuer(bundesland)
      ? berechneErwerbskosten(verkehrswertInitial ?? kaufpreis, kaufpreis, bundesland).gesamt
      : 0;

  const ergebnis = useMemo(
    () =>
      berechneBuyHoldProjektion({
        kaufpreisEur: kaufpreis,
        erwerbsnebenkostenEur: erwerbsnebenkosten,
        eigenkapitalEur: eigenkapital,
        zinssatzPct: zinssatz,
        tilgungssatzPct: tilgungssatz,
        zinsbindungJahre: zinsbindung,
        anschlusszinssatzPct: anschlusszinssatz,
        kaltmieteMonatlich: kaltmiete === "" ? 0 : kaltmiete,
        mietsteigerungPct: mietsteigerung,
        nichtUmlagefaehigeKostenMonatlich: nichtUmlagefaehig,
        verwaltungMonatlich: verwaltung,
        mietausfallwagnisPct: mietausfallwagnis,
        grenzsteuersatzPct: grenzsteuersatz,
        projektionsjahre,
      }),
    [
      kaufpreis,
      erwerbsnebenkosten,
      eigenkapital,
      zinssatz,
      tilgungssatz,
      zinsbindung,
      anschlusszinssatz,
      kaltmiete,
      mietsteigerung,
      nichtUmlagefaehig,
      verwaltung,
      mietausfallwagnis,
      grenzsteuersatz,
      projektionsjahre,
    ],
  );

  const breakEvenLabel = (jahr: number | null) =>
    jahr == null ? "nicht erreicht" : `Jahr ${jahr + 1}`;

  const summary = `BE vor Steuer: ${breakEvenLabel(ergebnis.breakEvenJahrVorSteuer)}`;

  return (
    <KiSection
      num="11"
      title="Buy & Hold – Finanzierung & Cashflow"
      severity="info"
      summary={summary}
    >
      <p className="text-xs text-muted-foreground mb-3">
        Projizierter Cashflow und Break-even (Detail-Modell mit Annahmen) — nicht identisch mit der
        einfachen Mietrendite im KI-Investor.
      </p>
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 flex-wrap">
          <StatusBox
            label="Break-even (vor Steuer)"
            value={breakEvenLabel(ergebnis.breakEvenJahrVorSteuer)}
          />
          <StatusBox
            label="Break-even (nach Steuer)"
            value={breakEvenLabel(ergebnis.breakEvenJahrNachSteuer)}
          />
        </div>

        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2">Eingaben</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field
              label="Kaufpreis (€)"
              hint={
                kaufpreisLabel ? `Vorbelegt: ${kaufpreisLabel}. Frei überschreibbar.` : undefined
              }
            >
              <Input
                type="number"
                value={kaufpreis}
                onChange={(e) => setKaufpreis(Number(e.target.value) || 0)}
              />
            </Field>

            <Field label="Kaltmiete (€/Monat)" hint={mietHerkunft}>
              <Input
                type="number"
                value={kaltmiete}
                placeholder="selbst schätzen"
                onChange={(e) => setKaltmiete(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </Field>

            <Field label="Eigenkapital (€)">
              <Input
                type="number"
                value={eigenkapital}
                onChange={(e) => setEigenkapital(Number(e.target.value) || 0)}
              />
            </Field>

            <Field label="Zinssatz p.a. (%)">
              <Input
                type="number"
                step="0.1"
                value={zinssatz}
                onChange={(e) => setZinssatz(Number(e.target.value) || 0)}
              />
            </Field>

            <Field label="Tilgungssatz p.a. (%)">
              <Input
                type="number"
                step="0.1"
                value={tilgungssatz}
                onChange={(e) => setTilgungssatz(Number(e.target.value) || 0)}
              />
            </Field>

            <Field label="Zinsbindung (Jahre)">
              <Input
                type="number"
                value={zinsbindung}
                onChange={(e) => setZinsbindung(Number(e.target.value) || 0)}
              />
            </Field>

            <Field
              label="Anschlusszins p.a. (%)"
              hint="Wird nach Ende der Zinsbindung auf die verbleibende Restschuld angewendet."
            >
              <Input
                type="number"
                step="0.1"
                value={anschlusszinssatz}
                onChange={(e) => setAnschlusszinssatz(Number(e.target.value) || 0)}
              />
            </Field>

            <Field label="Nicht umlagef. Hausgeld/Rücklage (€/Monat)">
              <Input
                type="number"
                value={nichtUmlagefaehig}
                onChange={(e) => setNichtUmlagefaehig(Number(e.target.value) || 0)}
              />
            </Field>

            <Field label="Verwaltung (€/Monat)">
              <Input
                type="number"
                value={verwaltung}
                onChange={(e) => setVerwaltung(Number(e.target.value) || 0)}
              />
            </Field>

            <Field label="Mietausfallwagnis (%)">
              <Input
                type="number"
                step="0.1"
                value={mietausfallwagnis}
                onChange={(e) => setMietausfallwagnis(Number(e.target.value) || 0)}
              />
            </Field>

            <Field label="Mietsteigerung p.a. (%)">
              <Input
                type="number"
                step="0.1"
                value={mietsteigerung}
                onChange={(e) => setMietsteigerung(Number(e.target.value) || 0)}
              />
            </Field>

            <Field
              label="Grenzsteuersatz (%)"
              hint="Für die AfA-Steuerersparnis, keine Steuerberatung."
            >
              <Input
                type="number"
                step="1"
                value={grenzsteuersatz}
                onChange={(e) => setGrenzsteuersatz(Number(e.target.value) || 0)}
              />
            </Field>

            <Field label="Projektionszeitraum (Jahre)">
              <Input
                type="number"
                min={5}
                max={30}
                value={projektionsjahre}
                onChange={(e) =>
                  setProjektionsjahre(Math.min(30, Math.max(5, Number(e.target.value) || 5)))
                }
              />
            </Field>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2">
            Cashflow-Projektion ({formatEur(ergebnis.darlehenssummeEur)} Darlehen ·{" "}
            {formatEur(ergebnis.monatlicheRateEur)}/Monat Rate
            {ergebnis.anschlussMonatlicheRateEur != null
              ? ` · danach ${formatEur(ergebnis.anschlussMonatlicheRateEur)}/Monat`
              : ""}
            )
          </h4>
          <div className="border rounded-[4px] overflow-hidden">
            <div className="max-h-72 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-[var(--surface-toolbar)]">
                  <TableRow>
                    <TableHead>Jahr</TableHead>
                    <TableHead>Miete p.a.</TableHead>
                    <TableHead>Zins</TableHead>
                    <TableHead>Tilgung</TableHead>
                    <TableHead>Bewirtsch.</TableHead>
                    <TableHead>CF vor Steuer</TableHead>
                    <TableHead>CF nach Steuer</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ergebnis.jahre.map((j) => (
                    <TableRow key={j.jahr}>
                      <TableCell className="font-mono text-xs">{j.jahr + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{formatEur(j.miete)}</TableCell>
                      <TableCell className="font-mono text-xs">{formatEur(j.zinsanteil)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatEur(j.tilgungsanteil)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatEur(j.bewirtschaftungskosten)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "font-mono text-xs font-semibold",
                          j.cashflowVorSteuer >= 0
                            ? "text-[var(--success)]"
                            : "text-[var(--destructive)]",
                        )}
                      >
                        {formatEur(j.cashflowVorSteuer)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "font-mono text-xs font-semibold",
                          j.cashflowNachSteuer >= 0
                            ? "text-[var(--success)]"
                            : "text-[var(--destructive)]",
                        )}
                      >
                        {formatEur(j.cashflowNachSteuer)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Schätzung auf Basis vereinfachter Annahmen (Anschlusszins nach Zinsbindung, lineare AfA,
          keine Sonderabschreibung/Denkmalschutz-Sonderfälle berücksichtigt). Keine Finanzierungs-
          oder Steuerberatung.
        </p>
      </div>
    </KiSection>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground font-normal">
        {label}
        {hint && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger className="inline-flex">
                <Info className="size-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>{hint}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </Label>
      {children}
    </div>
  );
}

function StatusBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-[4px] p-3 text-center shrink-0 w-44 bg-muted/50 border-border">
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
