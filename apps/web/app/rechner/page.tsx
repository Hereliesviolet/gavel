"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Calculator } from "lucide-react";
import {
  BUNDESLAENDER,
  GRUNDERWERBSTEUER,
  formatCurrency,
  berechneErwerbskosten,
  parseEuroSearchParam,
} from "@/lib/utils";
import { findBundesland } from "@/lib/bundesland";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

function firstEuroParam(sp: URLSearchParams, keys: string[]): number | null {
  for (const key of keys) {
    const value = parseEuroSearchParam(sp.get(key));
    if (value != null) return value;
  }
  return null;
}

function RechnerContent() {
  const sp = useSearchParams();
  const vwExplicit = firstEuroParam(sp, ["verkehrswert", "kaufpreis", "preis"]);
  const vsExplicit = firstEuroParam(sp, ["versteigerungswert", "zwangsversteigerung"]);
  const vwFromUrl = vwExplicit ?? 250000;
  const vsFromUrl = vsExplicit ?? vwExplicit ?? 200000;
  const blFromUrl = findBundesland(sp.get("bundesland"))?.slug ?? "hamburg";
  const [verkehrswert, setVerkehrswert] = useState(vwFromUrl);
  const [versteigerungswert, setVersteigerungswert] = useState(vsFromUrl);
  const [bundesland, setBundesland] = useState(blFromUrl);

  useEffect(() => {
    setVerkehrswert(vwFromUrl);
    setVersteigerungswert(vsFromUrl);
    setBundesland(blFromUrl);
  }, [vwFromUrl, vsFromUrl, blFromUrl]);

  const erwerb = berechneErwerbskosten(verkehrswert, versteigerungswert, bundesland);

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center gap-3 mb-8">
        <Calculator className="text-primary size-6" />
        <h1 className="text-2xl font-bold text-foreground">Erwerbskostenrechner</h1>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Eingaben</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="bundesland">Bundesland</Label>
              <Select value={bundesland} onValueChange={(v) => v && setBundesland(v)}>
                <SelectTrigger id="bundesland">
                  <SelectValue placeholder="Bundesland wählen" />
                </SelectTrigger>
                <SelectContent>
                  {BUNDESLAENDER.map((bl) => (
                    <SelectItem key={bl.slug} value={bl.slug}>
                      {bl.name} ({((GRUNDERWERBSTEUER[bl.slug] ?? 0.05) * 100).toFixed(1)}
                      %)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="verkehrswert">Verkehrswert (€)</Label>
              <Input
                id="verkehrswert"
                type="number"
                value={verkehrswert}
                onChange={(e) => setVerkehrswert(parseInt(e.target.value) || 0)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="bietpreis">Zuschlagswert / Bietpreis (€)</Label>
              <Input
                id="bietpreis"
                type="number"
                value={versteigerungswert}
                onChange={(e) => setVersteigerungswert(parseInt(e.target.value) || 0)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Kostenaufstellung</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3">
              <CostRow
                label={`Grunderwerbsteuer (${(erwerb.grunderwerbsteuerRate * 100).toFixed(1)} %)`}
                value={formatCurrency(erwerb.grunderwerbsteuer)}
              />
              <CostRow
                label="Grundbucheintrag (ca. 0,5 %)"
                value={formatCurrency(erwerb.grundbucheintrag)}
              />
              <CostRow
                label="Zuschlagsgebühr (ca. 0,5 %)"
                value={formatCurrency(erwerb.zuschlagsgebuehr)}
              />
              <CostRow
                label={`Verzinsung (32 Tage, Differenz ${formatCurrency(erwerb.verzinsterBetrag)})`}
                value={formatCurrency(erwerb.verzinsung)}
                sub
              />

              <Separator />

              <div className="flex justify-between items-center">
                <dt className="font-bold text-foreground text-lg">Gesamt Nebenkosten</dt>
                <dd className="font-bold text-primary text-2xl">{formatCurrency(erwerb.gesamt)}</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-sm text-muted-foreground">Gesamtkosten inkl. Bietpreis</dt>
                <dd className="text-sm font-semibold text-foreground">
                  {formatCurrency(versteigerungswert + erwerb.gesamt)}
                </dd>
              </div>
            </dl>

            <p className="text-xs text-muted-foreground italic mt-4">
              Alle Angaben ohne Gewähr. Tatsächliche Kosten können abweichen.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function RechnerPage() {
  return (
    <Suspense
      fallback={<div className="max-w-2xl mx-auto px-4 py-8 text-muted-foreground">Lädt...</div>}
    >
      <RechnerContent />
    </Suspense>
  );
}

function CostRow({ label, value, sub = false }: { label: string; value: string; sub?: boolean }) {
  return (
    <div className="flex justify-between items-start">
      <dt className={`text-sm ${sub ? "text-muted-foreground pl-4" : "text-foreground"}`}>
        {label}
      </dt>
      <dd className={`text-sm font-medium ${sub ? "text-muted-foreground" : "text-foreground"}`}>
        {value}
      </dd>
    </div>
  );
}
