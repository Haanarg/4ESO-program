-- Alertes d'integritat d'examen descartades pel professor.
-- Es conserva l'esdeveniment original; només deixa de comptar com a alerta activa.
CREATE TABLE IF NOT EXISTS exam_event_dismissals (
  event_id INTEGER PRIMARY KEY,
  dismissed_by INTEGER NOT NULL,
  dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exam_event_dismissals_time
  ON exam_event_dismissals(dismissed_at);
