CREATE TABLE IF NOT EXISTS visitors (
  target TEXT NOT NULL,
  visitor TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (target, visitor)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS visitors_last_seen ON visitors(last_seen, target);
CREATE TABLE IF NOT EXISTS analytics_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT OR IGNORE INTO analytics_meta VALUES ('started_at', unixepoch() * 1000);
