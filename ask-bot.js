const db = require('./database');
const trust = require('./trust');

// Normalize email content
function normalizeContent(text) {
  if (!text) return '';
  
  return text
    // Remove greeting lines
    .replace(/^(dear|hi|hello|respected|sir|madam|to whom)[\s\S]*?\n/gim, '')
    // Remove signature blocks
    .replace(/\n(regards|thanks|thank you|best|sincerely|yours)[\s\S]*$/gim, '')
    // Remove quoted text
    .replace(/^>.*$/gm, '')
    // Remove disclaimers
    .replace(/this email.*confidential[\s\S]*/gim, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// Classify query type
function classifyQuery(text) {
  const normalized = text.toLowerCase();
  
  // Rule/entitlement queries
  const ruleKeywords = ['entitled', 'eligible', 'eligibility', 'pension', 'gratuity', 'echs', 'canteen', 'csd', 'rule', 'regulation'];
  if (ruleKeywords.some(k => normalized.includes(k))) {
    return 'RULE_QUERY';
  }
  
  // Opportunity queries
  const oppKeywords = ['job', 'vacancy', 'opening', 'recruitment', 'opportunity', 'position', 'hiring', 'career'];
  if (oppKeywords.some(k => normalized.includes(k))) {
    return 'OPPORTUNITY_QUERY';
  }
  
  // Status queries
  const statusKeywords = ['status', 'update', 'when', 'deadline', 'last date'];
  if (statusKeywords.some(k => normalized.includes(k))) {
    return 'STATUS_QUERY';
  }
  
  return 'INVALID';
}

// Extract query parameters
function extractQueryParams(text, queryType) {
  const params = {};
  const normalized = text.toLowerCase();
  
  // Extract service branch
  const services = ['army', 'navy', 'air force', 'paramilitary', 'coast guard'];
  for (const service of services) {
    if (normalized.includes(service)) {
      params.service = service.toUpperCase().replace(' ', '_');
      break;
    }
  }
  
  // Extract category for opportunity queries
  const categories = ['employment', 'training', 'scholarship', 'resettlement', 'entrepreneurship', 'welfare', 'housing', 'healthcare', 'education'];
  for (const cat of categories) {
    if (normalized.includes(cat)) {
      params.category = cat.toUpperCase();
      break;
    }
  }
  
  // Extract rank if mentioned
  const ranks = ['jco', 'nco', 'officer', 'jawan', 'havildar', 'subedar', 'captain', 'major', 'colonel', 'general'];
  for (const rank of ranks) {
    if (normalized.includes(rank)) {
      params.rank = rank.toUpperCase();
      break;
    }
  }
  
  return params;
}

// Get missing required params
function getMissingParams(params, queryType) {
  const missing = [];
  
  if (queryType === 'RULE_QUERY') {
    if (!params.service) missing.push('service');
  } else if (queryType === 'OPPORTUNITY_QUERY') {
    // At least category or specific org
    if (!params.category) missing.push('category');
  }
  
  return missing;
}

// Query official rules
function queryOfficialPull(params) {
  let query = "SELECT * FROM official_pull WHERE status = 'ACTIVE'";
  const bindings = [];
  
  if (params.service) {
    query += ' AND applicability LIKE ?';
    bindings.push(`%${params.service}%`);
  }
  
  query += ' ORDER BY issue_date DESC LIMIT 5';
  
  return db.prepare(query).all(...bindings);
}

// Query opportunities
function queryOpportunities(params) {
  let query = "SELECT * FROM submitted_opportunity WHERE status = 'ACTIVE'";
  const bindings = [];
  
  if (params.category) {
    query += ' AND opportunity_category = ?';
    bindings.push(params.category);
  }
  
  query += " AND (validity_end IS NULL OR validity_end >= date('now'))";
  query += ' ORDER BY created_at DESC LIMIT 10';
  
  return db.prepare(query).all(...bindings);
}

// Check for conflicts in results
function hasConflict(results) {
  if (results.length < 2) return false;
  return results.some(r => r.status === 'CONFLICT');
}

// Process ASK query - main entry point
function processAsk(fromEmail, subject, body) {
  // Check system config
  const config = db.prepare("SELECT enabled FROM system_config WHERE key = 'ASK_BOT_ENABLED'").get();
  if (!config?.enabled) {
    return { action: 'SILENCE', reason: 'BOT_DISABLED' };
  }
  
  const safeMode = db.prepare("SELECT enabled FROM system_config WHERE key = 'SAFE_MODE'").get();
  if (safeMode?.enabled) {
    return { action: 'SILENCE', reason: 'SAFE_MODE' };
  }
  
  // Get/create sender and check trust
  const sender = trust.getOrCreateSender(fromEmail);
  
  if (trust.isShadowBanned(sender.sender_hash)) {
    trust.logEvent('ASK', 'SILENCE', 'SHADOW_BANNED');
    return { action: 'SILENCE', reason: 'SHADOW_BANNED' };
  }
  
  if (trust.isRateLimited(sender.sender_hash)) {
    trust.updateTrust(sender.sender_hash, 'ASK', 'RATE_LIMITED');
    trust.logEvent('ASK', 'SILENCE', 'RATE_LIMITED');
    return { action: 'SILENCE', reason: 'RATE_LIMITED' };
  }
  
  // Normalize and classify
  const content = normalizeContent(`${subject} ${body}`);
  const queryType = classifyQuery(content);
  
  if (queryType === 'INVALID') {
    trust.updateTrust(sender.sender_hash, 'ASK', 'SILENCE');
    trust.logEvent('ASK', 'SILENCE', 'INVALID');
    return { action: 'SILENCE', reason: 'INVALID_QUERY' };
  }
  
  // Extract and validate params
  const params = extractQueryParams(content, queryType);
  const missing = getMissingParams(params, queryType);
  
  if (missing.length > 1) {
    trust.updateTrust(sender.sender_hash, 'ASK', 'SILENCE');
    trust.logEvent('ASK', 'SILENCE', queryType);
    return { action: 'SILENCE', reason: 'TOO_MANY_MISSING_PARAMS' };
  }
  
  if (missing.length === 1) {
    trust.updateTrust(sender.sender_hash, 'ASK', 'CLARIFICATION');
    trust.logEvent('ASK', 'CLARIFICATION_SENT', queryType);
    return { 
      action: 'CLARIFICATION', 
      missingField: missing[0],
      queryType 
    };
  }
  
  // Query data
  let results;
  if (queryType === 'RULE_QUERY') {
    results = queryOfficialPull(params);
  } else {
    results = queryOpportunities(params);
  }
  
  // Check for conflicts
  if (hasConflict(results)) {
    trust.updateTrust(sender.sender_hash, 'ASK', 'REPLY_SENT');
    trust.logEvent('ASK', 'CONFLICT_DETECTED', queryType);
    return { 
      action: 'CONFLICT', 
      results,
      queryType 
    };
  }
  
  // Return results
  trust.updateTrust(sender.sender_hash, 'ASK', 'REPLY_SENT');
  trust.logEvent('ASK', 'REPLY_SENT', queryType);
  
  return {
    action: results.length > 0 ? 'RESPONSE' : 'NO_MATCH',
    results,
    queryType,
    params
  };
}

module.exports = {
  processAsk,
  normalizeContent,
  classifyQuery,
  extractQueryParams
};
