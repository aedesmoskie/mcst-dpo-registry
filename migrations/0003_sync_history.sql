CREATE TABLE IF NOT EXISTS sync_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    source TEXT NOT NULL,

    status TEXT NOT NULL,

    population_count INTEGER NOT NULL DEFAULT 0,

    inserted_count INTEGER NOT NULL DEFAULT 0,

    updated_count INTEGER NOT NULL DEFAULT 0,

    removed_count INTEGER NOT NULL DEFAULT 0,

    error_message TEXT,

    started_at TEXT NOT NULL,

    completed_at TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_history_source_completed
ON sync_history(source, completed_at);
