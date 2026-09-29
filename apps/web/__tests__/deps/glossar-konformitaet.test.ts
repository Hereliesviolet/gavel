import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCT_DOMAINS } from "@/lib/product-domains";
import { SICHTBARE_SCORES } from "@/lib/investor-signals";
import { ANTI_SIGNALS, antiSignalPostgresPattern } from "@/lib/investor-risk";

/**
 * Doku-Wächter. Die Vitest-Suite prüfte bisher rund 30 Verhaltensfälle, aber
 * keine einzige Dokumentationsaussage — deshalb konnten Glossar und Code
 * auseinanderlaufen, ohne dass irgendetwas rot wurde. Diese Datei schließt die
 * Lücke: sie vergleicht Aussagen der Doku mit dem, was der Code tatsächlich tut.
 */

const REPO = join(__dirname, "..", "..", "..", "..");
const WEB = join(REPO, "apps", "web");
const GLOSSAR = readFileSync(join(REPO, "docs", "METRICS_GLOSSARY.md"), "utf8");

function sammleQuelltext(): string {
  const verzeichnisse = [
    join(WEB, "lib"),
    join(WEB, "drizzle", "schema"),
    join(WEB, "components", "investor"),
  ];
  const teile: string[] = [];
  // Rekursiv, seit die Geldrechnung als Paket unter lib/underwriting liegt.
  const einlesen = (verzeichnis: string) => {
    for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
      const pfad = join(verzeichnis, eintrag.name);
      if (eintrag.isDirectory()) {
        einlesen(pfad);
      } else if (eintrag.name.endsWith(".ts") || eintrag.name.endsWith(".tsx")) {
        teile.push(readFileSync(pfad, "utf8"));
      }
    }
  };
  verzeichnisse.forEach(einlesen);
  return teile.join("\n");
}

const QUELLTEXT = sammleQuelltext();

/** Alle in Backticks gesetzten Metrikschlüssel aus den `###`-Überschriften. */
function glossarSchluessel(): string[] {
  const schluessel: string[] = [];
  for (const zeile of GLOSSAR.split("\n")) {
    if (!zeile.startsWith("### ")) continue;
    for (const treffer of zeile.matchAll(/`([^`]+)`/g)) {
      schluessel.push(treffer[1]);
    }
  }
  return schluessel;
}

function produktgrenzenAusGlossar() {
  const zeilen = GLOSSAR.split("\n");
  const start = zeilen.findIndex((zeile) => zeile.startsWith("| Domain |"));
  expect(start, "Produktgrenzen-Tabelle fehlt im Glossar").toBeGreaterThan(-1);

  const eintraege: Record<string, { investor: boolean; alerts: boolean; favorites: boolean }> = {};
  for (const zeile of zeilen.slice(start + 2)) {
    if (!zeile.startsWith("|")) break;
    const spalten = zeile
      .split("|")
      .slice(1, -1)
      .map((s) => s.trim());
    const [label, tabellen, investor, alerts, favoriten] = spalten;
    eintraege[`${label}|${tabellen.replaceAll("`", "")}`] = {
      investor: investor === "ja",
      alerts: alerts === "ja",
      favorites: favoriten === "ja",
    };
  }
  return eintraege;
}

describe("Doku-Wächter: Glossar gegen Code", () => {
  it("führt jeden nutzersichtbaren Score im Glossar", () => {
    const schluessel = glossarSchluessel();
    for (const score of SICHTBARE_SCORES) {
      expect(schluessel, `${score} fehlt als Glossareintrag`).toContain(score);
    }
  });

  it("hält jeden nutzersichtbaren Score auch im Code auffindbar", () => {
    for (const score of SICHTBARE_SCORES) {
      const treffer = new RegExp(`\\b${score}\\b`, "i").test(QUELLTEXT);
      expect(treffer, `${score} steht im Glossar, existiert aber nicht im Code`).toBe(true);
    }
  });

  it("löst jeden Glossarschlüssel auf ein Symbol oder eine Spalte im Code auf", () => {
    const unaufloesbar = glossarSchluessel().filter((schluessel) => {
      // Enum-Werte und Prosa in Backticks sind keine Metrikschlüssel.
      if (!/^[a-z][A-Za-z0-9_]*$/.test(schluessel)) return false;
      return !new RegExp(`\\b${schluessel}\\b`, "i").test(QUELLTEXT);
    });
    expect(unaufloesbar).toEqual([]);
  });

  // Der Glossareintrag zum Maximalgebot zeigte nach dem Umzug der Geldrechnung
  // wochenlang auf ein gelöschtes Modul, ohne dass etwas rot wurde.
  it("verweist in jeder Quellenzeile auf eine existierende Datei", () => {
    const fehlend: string[] = [];
    for (const zeile of GLOSSAR.split("\n")) {
      if (!zeile.startsWith("| **Source**")) continue;
      for (const treffer of zeile.matchAll(/`([^`]+)`/g)) {
        const verweis = treffer[1];
        // Tabellen und Sichten leben in der Datenbank, nicht im Dateisystem.
        if (verweis.includes("_")) continue;
        const relativ = verweis.startsWith("lib/") ? verweis : join("lib", verweis);
        const kandidaten = [relativ, `${relativ}.ts`, join(relativ, "index.ts")];
        if (!kandidaten.some((pfad) => existsSync(join(WEB, pfad)))) {
          fehlend.push(verweis);
        }
      }
    }
    expect(fehlend).toEqual([]);
  });

  it("bildet die Produktgrenzen-Tabelle deckungsgleich zur Konstante ab", () => {
    const ausGlossar = produktgrenzenAusGlossar();
    const ausCode = Object.fromEntries(
      Object.values(PRODUCT_DOMAINS).map((domain) => [
        `${domain.label}|${domain.tablePrefix}`,
        {
          investor: domain.investor,
          alerts: domain.alerts,
          favorites: domain.favorites,
        },
      ]),
    );
    expect(ausGlossar).toEqual(ausCode);
  });
});

describe("Doku-Wächter: das tote Stufenmodell bleibt tot", () => {
  it("kennt die unerreichbare Reifestufe nirgends mehr", () => {
    const treffer = execSync(
      `rg -l --hidden -g '!.git' -g '!**/__tests__/**' -e 'bid${"_"}ready' '${REPO}' || true`,
      { encoding: "utf8" },
    ).trim();
    expect(treffer).toBe("");
  });
});

describe("Doku-Wächter: eine einzige Anti-Signal-Definition", () => {
  it("generiert das SQL-Muster aus derselben Liste wie die TS-Prädikate", () => {
    const muster = antiSignalPostgresPattern();
    for (const definition of ANTI_SIGNALS) {
      expect(muster).toContain(definition.muster.replaceAll(String.raw`\b`, String.raw`\y`));
    }
    // In Postgres-ARE bedeutet \b das Backspace-Zeichen — es darf nicht durchrutschen.
    expect(muster).not.toContain(String.raw`\b`);
  });

  it("kennt keine zweite Risikoliste in den Investor-Modulen", () => {
    const verdaechtig = [
      "HARD_RISK_PATTERNS",
      "HARD_RISK_SQL",
      "CRITICAL_RISK_PATTERNS",
      "MATERIAL_RISK_PATTERNS",
    ];
    for (const name of verdaechtig) {
      const deklaration = new RegExp(`(?:const|let|var)\\s+${name}\\b`);
      expect(deklaration.test(QUELLTEXT), `${name} lebt wieder als eigene Liste`).toBe(false);
    }
  });
});
