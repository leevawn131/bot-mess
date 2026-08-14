CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_uid TEXT UNIQUE NOT NULL,
    facebook_name TEXT NOT NULL,
    display_name TEXT,
    avatar TEXT,
    gender TEXT,
    personality TEXT NOT NULL,
    speaking_style TEXT NOT NULL,
    self_pronoun TEXT,
    user_pronoun TEXT,
    humor_level INTEGER DEFAULT 50,
    emoji_level INTEGER DEFAULT 30,
    system_prompt TEXT,
    created_at INTEGER,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS user_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_uid TEXT UNIQUE,
    nickname TEXT,
    preferred_pronoun TEXT,
    language TEXT,
    favorite_character TEXT,
    created_at INTEGER,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_uid TEXT,
    type TEXT,
    content TEXT,
    tags TEXT,
    importance REAL,
    usage_score INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_uid TEXT,
    user_uid TEXT,
    affinity INTEGER DEFAULT 50,
    trust INTEGER DEFAULT 50,
    familiarity INTEGER DEFAULT 0,
    last_interaction INTEGER,
    updated_at INTEGER,
    UNIQUE(character_uid, user_uid)
);

CREATE TABLE IF NOT EXISTS conversation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_uid TEXT,
    user_uid TEXT,
    role TEXT,
    content TEXT,
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS shared_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_uid TEXT,
    source_character_uid TEXT,
    title TEXT,
    summary TEXT,
    visibility TEXT,
    importance REAL,
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_uid TEXT,
    user_uid TEXT,
    content TEXT,
    importance REAL,
    created_at INTEGER,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS character_diaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_uid TEXT,
    user_uid TEXT,
    entry TEXT,
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS character_moods (
    character_uid TEXT PRIMARY KEY,
    mood TEXT,
    intensity REAL,
    reason TEXT,
    expires_at INTEGER,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS world_state (
    key TEXT PRIMARY KEY,
    value TEXT
);
