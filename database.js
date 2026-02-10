const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'faujnet.db'));

// Initialize database schema
db.exec(`
  -- Official government rules
  CREATE TABLE IF NOT EXISTS official_pull (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    authority_name TEXT NOT NULL,
    authority_domain TEXT NOT NULL,
    document_type TEXT NOT NULL,
    document_number TEXT NOT NULL,
    issue_date TEXT NOT NULL,
    clauses TEXT DEFAULT '[]',
    applicability TEXT DEFAULT '{}',
    status TEXT DEFAULT 'ACTIVE',
    confidence TEXT DEFAULT 'HIGH',
    source_url TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Submitted opportunities
  CREATE TABLE IF NOT EXISTS submitted_opportunity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organisation_name TEXT NOT NULL,
    organisation_type TEXT DEFAULT 'PRIVATE',
    opportunity_title TEXT NOT NULL,
    opportunity_category TEXT NOT NULL,
    description TEXT NOT NULL,
    military_relevance_tier TEXT NOT NULL,
    eligibility TEXT DEFAULT '{}',
    validity_start TEXT NOT NULL,
    validity_end TEXT,
    status TEXT DEFAULT 'ACTIVE',
    visibility_tier TEXT DEFAULT 'BASE',
    submission_hash TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Sender trust scores
  CREATE TABLE IF NOT EXISTS sender_trust (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_hash TEXT UNIQUE NOT NULL,
    domain TEXT NOT NULL,
    trust_score INTEGER DEFAULT 100,
    total_submissions INTEGER DEFAULT 0,
    accepted_submissions INTEGER DEFAULT 0,
    rejected_submissions INTEGER DEFAULT 0,
    total_queries INTEGER DEFAULT 0,
    invalid_queries INTEGER DEFAULT 0,
    last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
    first_seen TEXT DEFAULT CURRENT_TIMESTAMP,
    is_shadow_banned INTEGER DEFAULT 0
  );

  -- Email event log (aggregates only)
  CREATE TABLE IF NOT EXISTS email_event_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    result_type TEXT NOT NULL,
    category TEXT,
    day_bucket TEXT DEFAULT (date('now')),
    count INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Signal aggregates
  CREATE TABLE IF NOT EXISTS signal_aggregate (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    metric_value TEXT DEFAULT '{}',
    generated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- System config
  CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    description TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Admin audit log
  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_entity TEXT,
    previous_value TEXT,
    new_value TEXT,
    ip_address TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Source whitelist
  CREATE TABLE IF NOT EXISTS source_whitelist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT UNIQUE NOT NULL,
    authority_name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    poll_url TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 1,
    last_polled_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Email inbox config
  CREATE TABLE IF NOT EXISTS email_inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inbox_address TEXT UNIQUE NOT NULL,
    inbox_type TEXT NOT NULL,
    mapped_bot TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Insert default config if not exists
const insertConfig = db.prepare(`
  INSERT OR IGNORE INTO system_config (key, value, enabled, description) VALUES (?, ?, ?, ?)
`);

const defaultConfigs = [
  ['ASK_BOT_ENABLED', '{"active": true}', 1, 'Enable/disable ASK bot'],
  ['SUBMIT_BOT_ENABLED', '{"active": true}', 1, 'Enable/disable SUBMIT bot'],
  ['INGESTION_BOT_ENABLED', '{"active": true}', 1, 'Enable/disable source ingestion'],
  ['DISTRIBUTION_BOT_ENABLED', '{"active": false}', 0, 'Enable/disable distribution'],
  ['OUTBOUND_EMAIL_ENABLED', '{"active": true}', 1, 'Enable/disable outbound email'],
  ['SAFE_MODE', '{"active": false}', 0, 'Emergency system shutdown'],
  ['RATE_LIMIT_PER_HOUR', '{"limit": 10}', 1, 'Rate limit per sender per hour'],
  ['SHADOW_BAN_THRESHOLD', '{"threshold": 20}', 1, 'Trust score for shadow ban']
];

defaultConfigs.forEach(config => insertConfig.run(...config));

// Insert default inboxes
const insertInbox = db.prepare(`
  INSERT OR IGNORE INTO email_inbox (inbox_address, inbox_type, mapped_bot) VALUES (?, ?, ?)
`);
insertInbox.run('ask@faujnetmail.com', 'ASK', 'INBOUND_ASK_BOT');
insertInbox.run('submit@faujnetmail.com', 'SUBMIT', 'INBOUND_SUBMIT_BOT');

// Insert default sources
const insertSource = db.prepare(`
  INSERT OR IGNORE INTO source_whitelist (domain, authority_name, source_type, poll_url) VALUES (?, ?, ?, ?)
`);
insertSource.run('desw.gov.in', 'Dept of Ex-Servicemen Welfare', 'PORTAL', 'https://desw.gov.in');
insertSource.run('mod.gov.in', 'Ministry of Defence', 'PORTAL', 'https://mod.gov.in');
insertSource.run('echs.gov.in', 'ECHS', 'PORTAL', 'https://echs.gov.in');

module.exports = db;
