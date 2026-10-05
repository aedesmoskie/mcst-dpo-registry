ALTER TABLE dpo_records ADD COLUMN pdpc_uen TEXT;
ALTER TABLE dpo_records ADD COLUMN discrepancy_reason TEXT;

CREATE TABLE IF NOT EXISTS pdpc_lookup_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mcst_no TEXT NOT NULL,
    bca_uen TEXT,
    estate_name TEXT,
    search_type TEXT NOT NULL,
    search_value TEXT NOT NULL,
    state TEXT NOT NULL,
    message TEXT,
    checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pdpc_attempt_mcst
ON pdpc_lookup_attempts(mcst_no);

CREATE INDEX IF NOT EXISTS idx_pdpc_attempt_state
ON pdpc_lookup_attempts(state);
