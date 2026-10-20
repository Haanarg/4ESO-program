-- Salvaguardes d'integritat per als exercicis normals
CREATE TABLE IF NOT EXISTS exercise_integrity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  exercise_id INTEGER NOT NULL,
  submission_id INTEGER,
  event_type TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exercise_integrity_user_exercise
  ON exercise_integrity_events(user_id, exercise_id, submission_id);

CREATE INDEX IF NOT EXISTS idx_exercise_integrity_submission
  ON exercise_integrity_events(submission_id, created_at);
