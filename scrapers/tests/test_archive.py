from pathlib import Path


def test_archive_uses_berlin_calendar_and_missing_brake():
    postgres = (Path(__file__).resolve().parents[1] / "src/storage/postgres.py").read_text()
    shell = (Path(__file__).resolve().parents[1] / "archive_expired.sh").read_text()
    flow = (Path(__file__).resolve().parents[1] / "src/flows/archive_past_listings.py").read_text()
    fn = postgres.split("async def archive_expired_and_missing_listings", 1)[1]
    assert "Europe/Berlin" in fn
    assert "TIME '00:00:00'" in fn
    assert "termin_date < NOW()" in fn
    assert "termin_date < CURRENT_DATE" not in fn
    assert "MAX_MISSING_SHARE_PERCENT" in fn
    assert "'termin_abgelaufen'" in fn
    assert "'quelle_verschwunden'" in fn
    assert "last_seen_at < NOW() - ($1::int * INTERVAL '1 day')" in fn
    assert "Europe/Berlin" in shell
    assert "TIME '00:00:00'" in shell
    assert "termin_date < NOW()" in shell
    assert "MAX_MISSING_SHARE_PERCENT" in shell
    assert 'r.get("reason")' in flow
    assert "datetime.now(timezone.utc)" not in flow
    assert "except ArchiveMissingShareBlocked" in fn
    assert "raise ArchiveMissingShareBlocked" in fn
    assert "return []" not in fn.split("finally:", 1)[0]
    assert "ArchiveMissingShareBlocked" in flow
    assert "post_ops_alert" in flow
    assert 'result["missing_share_blocked"] = True' in flow
    assert 'result["error"]' in flow
    pipeline = (Path(__file__).resolve().parents[1] / "src/flows/daily_pipeline.py").read_text()
    assert 'result = {"error": str(exc)}' in pipeline
    assert "step_succeeded_today" in pipeline
    assert "hold_heavy_run_lock" in pipeline
    assert "occupy_worker=False" in pipeline


def test_zvg_upsert_updates_flaechen_and_rooms():
    postgres = (Path(__file__).resolve().parents[1] / "src/storage/postgres.py").read_text()
    fn = postgres.split("ON CONFLICT (bundesland, COALESCE(amtsgericht, ''), aktenzeichen)", 1)[1]
    fn = fn.split("RETURNING id, (xmax = 0)", 1)[0]
    assert "wohnflaeche_m2 = COALESCE(NULLIF(EXCLUDED.wohnflaeche_m2, 0)" in fn
    assert "grundstuecksflaeche_m2 = COALESCE(NULLIF(EXCLUDED.grundstuecksflaeche_m2, 0)" in fn
    assert "nutzflaeche_m2 = COALESCE(NULLIF(EXCLUDED.nutzflaeche_m2, 0)" in fn
    assert "gesamtflaeche_m2 = COALESCE(NULLIF(EXCLUDED.gesamtflaeche_m2, 0)" in fn
    assert "baujahr = COALESCE(NULLIF(EXCLUDED.baujahr, 0)" in fn
    assert "zimmer = COALESCE(NULLIF(EXCLUDED.zimmer, 0)" in fn
    assert "etage = COALESCE(EXCLUDED.etage, zvg_listings.etage)" in fn
    assert "BTRIM(EXCLUDED.etage)" not in fn
    assert "BTRIM(EXCLUDED.baujahr)" not in fn
    assert "BTRIM(EXCLUDED.zimmer)" not in fn
    assert "hausnummer = COALESCE(NULLIF(BTRIM(EXCLUDED.hausnummer), '')" in fn
    assert "stadtteil = COALESCE(NULLIF(BTRIM(EXCLUDED.stadtteil), '')" in fn
    assert "versteigerungsort = COALESCE(NULLIF(BTRIM(EXCLUDED.versteigerungsort), '')" in fn
    assert "termin_saal = COALESCE(NULLIF(BTRIM(EXCLUDED.termin_saal), '')" in fn


def test_deploy_flows_has_one_schedule_per_source():
    deploy = (Path(__file__).resolve().parents[1] / "deploy_flows.py").read_text()
    assert 'name="zvg-daily-deployment"' not in deploy
    assert 'name="hanmark-daily-deployment"' not in deploy
    assert 'cron="0 4 * * *"' not in deploy
    assert 'cron="0 6 * * *"' not in deploy
    assert 'cron="0 7 * * *"' in deploy
    assert "eine Schedule pro Quelle" in deploy


def test_hanmark_deactivate_scopes_amtsgericht():
    postgres = (Path(__file__).resolve().parents[1] / "src/storage/postgres.py").read_text()
    daily = (Path(__file__).resolve().parents[1] / "src/flows/hanmark_daily.py").read_text()
    fn = postgres.split("async def deactivate_hanmark_listing", 1)[1].split(
        "async def archive_expired_and_missing_listings", 1
    )[0]
    assert "normalize_amtsgericht(amtsgericht)" in fn
    assert "$3::text IS NULL" in fn
    assert "COALESCE(amtsgericht, '') = $3" in fn
    assert "listing.amtsgericht" in daily
