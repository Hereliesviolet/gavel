-- Der wöchentliche Investor-Digest war ein Endpunkt, der nie einen Digest
-- erzeugt hat (generated: false), und eine Tabelle, in der nie eine Zeile
-- stand. Die Frage "was ist gerade wichtig" beantwortet jetzt die Seite
-- /investor (Heute) direkt aus den Daten.
DROP TABLE IF EXISTS investor_digests;
