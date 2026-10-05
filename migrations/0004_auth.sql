CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    email TEXT NOT NULL COLLATE NOCASE,

    password_hash TEXT NOT NULL,

    role TEXT NOT NULL DEFAULT 'viewer'
        CHECK (
            role IN (
                'admin',
                'editor',
                'viewer'
            )
        ),

    active INTEGER NOT NULL DEFAULT 1
        CHECK (
            active IN (0, 1)
        ),

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
ON users(email);


CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER NOT NULL,

    token_hash TEXT NOT NULL,

    expires_at TEXT NOT NULL,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    last_seen_at TEXT,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);


CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash
ON sessions(token_hash);


CREATE INDEX IF NOT EXISTS idx_sessions_user_id
ON sessions(user_id);


CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
ON sessions(expires_at);
