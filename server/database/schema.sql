CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_rules (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  keywords TEXT NOT NULL,
  score INTEGER NOT NULL,
  description TEXT,
  advice TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_records (
  id TEXT PRIMARY KEY,
  input_text TEXT NOT NULL,
  job_type TEXT,
  risk_level TEXT,
  score INTEGER,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS follow_up_messages (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (record_id) REFERENCES analysis_records(id)
);

CREATE TABLE IF NOT EXISTS job_cases (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  job_type TEXT NOT NULL,
  input_text TEXT NOT NULL,
  expected_risk_level TEXT,
  expected_focus TEXT,
  created_at TEXT NOT NULL
);
