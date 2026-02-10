const crypto = require('crypto');
const db = require('./database');

// Hash email for privacy
function hashEmail(email) {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

// Extract domain from email
function getDomain(email) {
  return email.split('@')[1]?.toLowerCase() || 'unknown';
}

// Get or create sender trust record
function getOrCreateSender(email) {
  const hash = hashEmail(email);
  const domain = getDomain(email);
  
  let sender = db.prepare('SELECT * FROM sender_trust WHERE sender_hash = ?').get(hash);
  
  if (!sender) {
    db.prepare(`
      INSERT INTO sender_trust (sender_hash, domain) VALUES (?, ?)
    `).run(hash, domain);
    sender = db.prepare('SELECT * FROM sender_trust WHERE sender_hash = ?').get(hash);
  }
  
  return sender;
}

// Check rate limit
function isRateLimited(senderHash) {
  const config = db.prepare("SELECT value FROM system_config WHERE key = 'RATE_LIMIT_PER_HOUR'").get();
  const limit = JSON.parse(config?.value || '{"limit": 10}').limit;
  
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const count = db.prepare(`
    SELECT SUM(count) as total FROM email_event_log 
    WHERE created_at > ? AND category = ?
  `).get(hourAgo, senderHash);
  
  return (count?.total || 0) >= limit;
}

// Check if shadow banned
function isShadowBanned(senderHash) {
  const sender = db.prepare('SELECT is_shadow_banned, trust_score FROM sender_trust WHERE sender_hash = ?').get(senderHash);
  if (!sender) return false;
  
  const config = db.prepare("SELECT value FROM system_config WHERE key = 'SHADOW_BAN_THRESHOLD'").get();
  const threshold = JSON.parse(config?.value || '{"threshold": 20}').threshold;
  
  return sender.is_shadow_banned === 1 || sender.trust_score < threshold;
}

// Update trust score
function updateTrust(senderHash, eventType, result) {
  const adjustments = {
    'ASK_REPLY_SENT': 2,
    'ASK_SILENCE': -5,
    'ASK_CLARIFICATION': 1,
    'SUBMIT_ACCEPTED': 5,
    'SUBMIT_SILENCE': -10,
    'SUBMIT_DUPLICATE': -2,
    'RATE_LIMITED': -3
  };
  
  const key = `${eventType}_${result}`;
  const delta = adjustments[key] || 0;
  
  db.prepare(`
    UPDATE sender_trust 
    SET trust_score = MAX(0, MIN(100, trust_score + ?)),
        last_seen = CURRENT_TIMESTAMP,
        is_shadow_banned = CASE WHEN trust_score + ? < 20 THEN 1 ELSE is_shadow_banned END
    WHERE sender_hash = ?
  `).run(delta, delta, senderHash);
  
  // Update counters
  if (eventType === 'ASK') {
    db.prepare('UPDATE sender_trust SET total_queries = total_queries + 1 WHERE sender_hash = ?').run(senderHash);
    if (result === 'SILENCE') {
      db.prepare('UPDATE sender_trust SET invalid_queries = invalid_queries + 1 WHERE sender_hash = ?').run(senderHash);
    }
  } else if (eventType === 'SUBMIT') {
    db.prepare('UPDATE sender_trust SET total_submissions = total_submissions + 1 WHERE sender_hash = ?').run(senderHash);
    if (result === 'ACCEPTED') {
      db.prepare('UPDATE sender_trust SET accepted_submissions = accepted_submissions + 1 WHERE sender_hash = ?').run(senderHash);
    } else {
      db.prepare('UPDATE sender_trust SET rejected_submissions = rejected_submissions + 1 WHERE sender_hash = ?').run(senderHash);
    }
  }
}

// Log event (aggregate only)
function logEvent(eventType, resultType, category = null) {
  const today = new Date().toISOString().split('T')[0];
  
  const existing = db.prepare(`
    SELECT id FROM email_event_log 
    WHERE event_type = ? AND result_type = ? AND (category = ? OR (category IS NULL AND ? IS NULL)) AND day_bucket = ?
  `).get(eventType, resultType, category, category, today);
  
  if (existing) {
    db.prepare('UPDATE email_event_log SET count = count + 1 WHERE id = ?').run(existing.id);
  } else {
    db.prepare(`
      INSERT INTO email_event_log (event_type, result_type, category, day_bucket) VALUES (?, ?, ?, ?)
    `).run(eventType, resultType, category, today);
  }
}

module.exports = {
  hashEmail,
  getDomain,
  getOrCreateSender,
  isRateLimited,
  isShadowBanned,
  updateTrust,
  logEvent
};
