-- Sistema d'exàmens de programació
-- Les mateixes taules també es creen de manera idempotent des del Worker
-- per mantenir compatible la base de dades D1 ja desplegada.

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  start_at TEXT,
  end_at TEXT,
  duration_minutes INTEGER,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  statement TEXT NOT NULL DEFAULT '',
  starter_code TEXT NOT NULL DEFAULT '',
  max_score REAL NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  graded_at TEXT,
  final_score REAL,
  teacher_comment TEXT NOT NULL DEFAULT '',
  UNIQUE(exam_id,user_id)
);

CREATE TABLE IF NOT EXISTS exam_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  stdin TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  score REAL,
  feedback TEXT NOT NULL DEFAULT '',
  UNIQUE(attempt_id,question_id)
);

CREATE TABLE IF NOT EXISTS exam_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL,
  question_id INTEGER,
  event_type TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exam_questions_exam
  ON exam_questions(exam_id, position);

CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam_user
  ON exam_attempts(exam_id, user_id);

CREATE INDEX IF NOT EXISTS idx_exam_answers_attempt
  ON exam_answers(attempt_id, question_id);

CREATE INDEX IF NOT EXISTS idx_exam_events_attempt
  ON exam_events(attempt_id, created_at);
