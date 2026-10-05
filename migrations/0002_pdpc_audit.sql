ALTER TABLE dpo_records
ADD COLUMN pdpc_uen TEXT;

ALTER TABLE dpo_records
ADD COLUMN discrepancy_reason TEXT;


CREATE INDEX IF NOT EXISTS idx_dpo_pdpc_uen
ON dpo_records(pdpc_uen);


CREATE TABLE IF NOT EXISTS pdpc_lookup_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    mcst_no TEXT NOT NULL,

    bca_uen TEXT,

    estate_name TEXT,

    search_type TEXT NOT NULL,

    search_value TEXT NOT NULL,

    outcome TEXT NOT NULL,

    pdpc_organisation_name TEXT,

    pdpc_uen TEXT,

    dpo_name TEXT,

    dpo_email TEXT,

    discrepancy INTEGER NOT NULL DEFAULT 0,

    discrepancy_reason TEXT,

    observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE INDEX IF NOT EXISTS idx_pdpc_attempt_mcst
ON pdpc_lookup_attempts(mcst_no);


CREATE INDEX IF NOT EXISTS idx_pdpc_attempt_bca_uen
ON pdpc_lookup_attempts(bca_uen);


CREATE INDEX IF NOT EXISTS idx_pdpc_attempt_pdpc_uen
ON pdpc_lookup_attempts(pdpc_uen);


CREATE INDEX IF NOT EXISTS idx_pdpc_attempt_observed
ON pdpc_lookup_attempts(observed_at);
