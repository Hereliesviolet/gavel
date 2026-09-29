"""
Gavel Prefect Deployment-Registrierung

Registriert und served folgende Deployments:
  • daily-pipeline         → täglich 07:00 Uhr
                             (Justizportal → zvg.com → hanmark.de → Geocoding → KI-Analyse;
                             eine Schedule pro Quelle, keine zusätzlichen Portal-/Hanmark-Crons)
  • daily-pipeline-resume  → 11:00 und 17:00 (nimmt fehlende Daily-Schritte nach)
  • ki-analysis-backup     → täglich 14:00 Uhr (KI-Analyse als Backup-/Auffang-Lauf)
  • geocoding-backup       → täglich 15:00 Uhr (Geocoding-Backup/Backlog-Abbau,
                             nach dem Portal-Scrape, nicht parallel dazu)
  • market-harvest         → täglich 02:30 Uhr (Vergleichsangebote je Mikromarkt)
  • market-recheck         → montags 03:30 Uhr (Preis- und Standzeitprüfung)
  • reanalyze-investment-enrichment → manuell, ohne Zeitplan (sicherer Dry-Run
                                      mit Limit 50 als Deployment-Standard)

Starten:
    cd scrapers
    PREFECT_API_URL=http://localhost:4200/api .venv/bin/python deploy_flows.py

Der Prozess läuft als dauerhafter Worker und nimmt geplante Runs an.
Für Produktion: in docker-compose.yml als Service oder systemd-Unit eintragen.
"""

import os
import sys

from prefect import serve

# Sicherstellen dass src-Paket gefunden wird
sys.path.insert(0, os.path.dirname(__file__))

from src.flows.daily_pipeline import daily_pipeline_flow
from src.flows.ki_analysis import ki_analysis_flow
from src.flows.geocoding import geocode_missing_listings_flow
from src.flows.data_quality import data_quality_flow
from src.flows.reanalyze_investment import reanalyze_investment_flow
from src.flows.market_harvest import market_harvest_flow
from src.flows.market_recheck import market_recheck_flow
from src.utils.ki_limits import ki_backup_limit, ki_daily_limit


def build_deployments():
    """Erstellt die RunnerDeployment-Objekte für alle geplanten Flows."""

    # Deployment 1: Tägliche Gesamt-Pipeline 07:00 Uhr
    daily_pipeline_deployment = daily_pipeline_flow.to_deployment(
        name="daily-pipeline-deployment",
        cron="0 7 * * *",
        description=(
            "Tägliche Gavel-Pipeline: "
            f"Justizportal → zvg.com → hanmark.de → 5 min Pause → KI-Analyse (limit={ki_daily_limit()})"
        ),
        tags=["daily", "scraping", "ki-analyse"],
    )

    daily_pipeline_resume_noon = daily_pipeline_flow.to_deployment(
        name="daily-pipeline-resume-noon-deployment",
        cron="0 11 * * *",
        description=(
            "Daily-Resume 11:00 — setzt nach einem Kill/OOM bei den "
            "heute noch fehlenden scrape_jobs-Schritten auf"
        ),
        tags=["daily", "resume"],
    )
    daily_pipeline_resume_evening = daily_pipeline_flow.to_deployment(
        name="daily-pipeline-resume-evening-deployment",
        cron="0 17 * * *",
        description=("Daily-Resume 17:00 — zweiter Auffanglauf für fehlende Tages-Schritte"),
        tags=["daily", "resume"],
    )

    # Deployment 4: KI-Analyse 14:00 Uhr als Backup-/Auffanglauf
    ki_analysis_backup_deployment = ki_analysis_flow.to_deployment(
        name="ki-analysis-backup-deployment",
        cron="0 14 * * *",
        description=(
            "KI-Analyse Backup täglich 14:00 — analysiert weitere Listings "
            "nach dem 07:00-Lauf, bewusst nach dem Portal-Scrape"
        ),
        tags=["daily", "ki-analyse", "backup"],
        parameters={"limit": ki_backup_limit(), "occupy_worker": True},
    )

    # Deployment 5: Geocoding-Backup 15:00 Uhr — Backlog-Abbau/Auffanglauf
    geocoding_backup_deployment = geocode_missing_listings_flow.to_deployment(
        name="geocoding-backup-deployment",
        cron="0 15 * * *",
        description=(
            "Geocoding-Backup täglich 09:00 — geocodiert weitere Listings ohne "
            "Koordinaten (Backlog-Abbau), falls der 07:00-Lauf ausfällt oder "
            "das Tages-Limit nicht für den gesamten Backlog reicht"
        ),
        tags=["daily", "geocoding", "backup"],
        parameters={"limit": 250},
    )

    # Deployment 6: Datenqualitätsprüfung 15:30 Uhr — Backup-/Auffanglauf
    # (der reguläre Lauf ist bereits Schritt 7 der daily-pipeline; dieses
    # Standalone-Deployment stellt sicher, dass die Prüfung auch dann läuft,
    # wenn die Gesamt-Pipeline vorher abbricht, und erlaubt einen manuellen
    # Trigger unabhängig vom kompletten Scraping-Lauf).
    data_quality_backup_deployment = data_quality_flow.to_deployment(
        name="data-quality-backup-deployment",
        cron="30 15 * * *",
        description=(
            "Datenqualitätsprüfung Backup täglich 15:30 — prüft alle aktiven "
            "Listings auf Plausibilität + erzeugt Tagesreport, falls die "
            "Gesamt-Pipeline vorher abgebrochen ist"
        ),
        tags=["daily", "data-quality", "backup"],
        parameters={"batch_size": 500},
    )

    # Deployment 7: Marktreferenz-Ernte, täglich 02:30 Uhr. Bewusst täglich in
    # kleinen Portionen statt monatlich als Vollauffrischung: das verteilt die
    # Last, hält die Anzeigen aktuell und liefert nebenbei die Preis- und
    # Standzeitbeobachtung, aus der sich Verhandlungsspielraum ablesen lässt.
    market_harvest_deployment = market_harvest_flow.to_deployment(
        name="market-harvest-deployment",
        cron="30 2 * * *",
        description=(
            "Erntet Vergleichsangebote (Kauf und Miete) für die Mikromärkte mit "
            "aktiven ZVG-Objekten, priorisiert nach kleinster und ältester Stichprobe"
        ),
        tags=["daily", "scraping", "marktreferenz"],
        parameters={"maerkte": 25},
    )

    # Deployment 8: Nachpruefung analysierter Marktobjekte, montags 03:30 Uhr.
    # Woechentlich statt taeglich, weil Angebotspreise sich selten aendern und
    # jede Anfrage gegen dasselbe Domain-Budget laeuft wie die Ernte.
    market_recheck_deployment = market_recheck_flow.to_deployment(
        name="market-recheck-deployment",
        cron="30 3 * * 1",
        description=(
            "Prueft analysierte Marktobjekte auf Preisaenderung und Verschwinden; "
            "liefert Standzeit und Verhandlungsspielraum als market_listing_events"
        ),
        tags=["weekly", "scraping", "marktreferenz"],
        parameters={"objekte": 40},
    )

    reanalyze_investment_deployment = reanalyze_investment_flow.to_deployment(
        name="reanalyze-investment-enrichment-deployment",
        description=(
            "Manuelle Investment-Re-Analyse bestehender ZVG- oder Custom-URL-Listings; "
            "ohne Zeitplan und standardmäßig als Dry-Run mit Limit 50"
        ),
        tags=["manual", "ki-analyse", "backfill"],
        parameters={"limit": 50, "dry_run": True},
    )

    return (
        daily_pipeline_deployment,
        daily_pipeline_resume_noon,
        daily_pipeline_resume_evening,
        ki_analysis_backup_deployment,
        geocoding_backup_deployment,
        data_quality_backup_deployment,
        market_harvest_deployment,
        market_recheck_deployment,
        reanalyze_investment_deployment,
    )


def main():
    prefect_url = os.environ.get("PREFECT_API_URL", "http://localhost:4200/api")
    print(f"Verbinde mit Prefect API: {prefect_url}")
    print()
    print("Registrierte Deployments:")
    print("  • daily-pipeline-deployment      — täglich 07:00 Uhr (Gesamt-Pipeline)")
    print("  • daily-pipeline-resume-noon     — täglich 11:00 Uhr (fehlende Schritte)")
    print("  • daily-pipeline-resume-evening  — täglich 17:00 Uhr (fehlende Schritte)")
    print("  • ki-analysis-backup-deployment  — täglich 14:00 Uhr (KI-Analyse Backup)")
    print("  • geocoding-backup-deployment    — täglich 15:00 Uhr (Geocoding Backup/Backlog)")
    print("  • data-quality-backup-deployment — täglich 15:30 Uhr (Datenqualität Backup)")
    print("  • market-harvest-deployment      — täglich 02:30 Uhr (Marktreferenz-Ernte)")
    print("  • market-recheck-deployment      — montags 03:30 Uhr (Preis- und Standzeitprüfung)")
    print("  • reanalyze-investment-enrichment-deployment — manuell (Dry-Run, Limit 50)")
    print()
    print("Worker läuft — warte auf geplante Runs (Ctrl+C zum Beenden)...")

    deployments = build_deployments()

    # serve() blockiert und pollt die Prefect API nach anstehenden Runs
    serve(
        *deployments,
        pause_on_shutdown=True,
    )


if __name__ == "__main__":
    main()
