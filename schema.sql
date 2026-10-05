CREATE TABLE IF NOT EXISTS mcst_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mcst_no TEXT NOT NULL,
    estate_name TEXT,
    uen TEXT,
    source TEXT NOT NULL DEFAULT 'BCA',
    source_estate_name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcst_source_record
ON mcst_records(mcst_no, estate_name, source);


CREATE TABLE IF NOT EXISTS dpo_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mcst_no TEXT NOT NULL,
    uen TEXT,
    estate_name TEXT,
    dpo_found INTEGER NOT NULL DEFAULT 0,
    dpo_name TEXT,
    dpo_email TEXT,
    dpo_company TEXT,
    pdpc_organisation_name TEXT,
    record_discrepancy INTEGER NOT NULL DEFAULT 0,
    lookup_status TEXT,
    lookup_method TEXT,
    checked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dpo_mcst
ON dpo_records(mcst_no);

CREATE INDEX IF NOT EXISTS idx_dpo_uen
ON dpo_records(uen);


CREATE TABLE IF NOT EXISTS lookup_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mcst_no TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lookup_status
ON lookup_jobs(status);
