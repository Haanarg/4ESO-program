-- Propostes IA separades de la nota final validada pel professor.
CREATE TABLE IF NOT EXISTS exam_ai_suggestions (
  attempt_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  answer_hash TEXT NOT NULL,
  score REAL NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(attempt_id,question_id)
);
