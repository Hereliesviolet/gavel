-- Login und Profil vergleichen E-Mails case-insensitive (lower(email)).
-- Die bestehende UNIQUE(email) verhindert nur exakte Duplikate; ohne diesen
-- Index wären a@x.de und A@x.de zwei Konten mit demselben Login-Schlüssel.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
