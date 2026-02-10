const crypto = require('crypto');
const db = require('./database');
const trust = require('./trust');

// Normalize content
function normalizeContent(text) {
  if (!text) return '';
  
  return text
    .replace(/^(dear|hi|hello|respected|sir|madam)[\s\S]*?\n/gim, '')
    .replace(/\n(regards|thanks|thank you|best|sincerely)[\s\S]*$/gim, '')
    .replace(/^>.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract submission fields
function extractFields(text) {
  const fields = {};
  const lines = text.split('\n');
  
  // Try to extract structured fields
  for (const line of lines) {
    const lower = line.toLowerCase();
    
    if (lower.includes('organisation:') || lower.includes('organization:') || lower.includes('company:')) {
      fields.organisation_name = line.split(':').slice(1).join(':').trim();
    }
    else if (lower.includes('title:') || lower.includes('position:') || lower.includes('role:')) {
      fields.opportunity_title = line.split(':').slice(1).join(':').trim();
    }
    else if (lower.includes('category:') || lower.includes('type:')) {
      fields.opportunity_category = line.split(':').slice(1).join(':').trim().toUpperCase();
    }
    else if (lower.includes('description:') || lower.includes('details:')) {
      fields.description = line.split(':').slice(1).join(':').trim();
    }
    else if (lower.includes('valid from:') || lower.includes('start date:') || lower.includes('from:')) {
      fields.validity_start = line.split(':').slice(1).join(':').trim();
    }
    else if (lower.includes('valid until:') || lower.includes('end date:') || lower.includes('deadline:')) {
      fields.validity_end = line.split(':').slice(1).join(':').trim();
    }
  }
  
  // If no structured data, try to extract from free text
  if (!fields.organisation_name) {
    const orgMatch = text.match(/(?:from|at|by)\s+([A-Z][A-Za-z\s&]+(?:Ltd|Limited|Corp|Inc|Pvt)?)/);
    if (orgMatch) fields.organisation_name = orgMatch[1].trim();
  }
  
  // Infer category from keywords
  if (!fields.opportunity_category) {
    const catKeywords = {
      'EMPLOYMENT': ['job', 'vacancy', 'hiring', 'recruitment', 'position'],
      'TRAINING': ['training', 'course', 'workshop', 'certification'],
      'SCHOLARSHIP': ['scholarship', 'fellowship', 'grant', 'stipend'],
      'EDUCATION': ['education', 'degree', 'study', 'admission'],
      'ENTREPRENEURSHIP': ['startup', 'business', 'entrepreneur', 'venture'],
      'WELFARE': ['welfare', 'benefit', 'support', 'assistance'],
      'HEALTHCARE': ['health', 'medical', 'hospital', 'treatment'],
      'HOUSING': ['housing', 'accommodation', 'residence', 'quarter']
    };
    
    const lower = text.toLowerCase();
    for (const [cat, keywords] of Object.entries(catKeywords)) {
      if (keywords.some(k => lower.includes(k))) {
        fields.opportunity_category = cat;
        break;
      }
    }
  }
  
  // Use full text as description if not extracted
  if (!fields.description && text.length > 50) {
    fields.description = normalizeContent(text).substring(0, 1000);
  }
  
  // Default validity_start to today
  if (!fields.validity_start) {
    fields.validity_start = new Date().toISOString().split('T')[0];
  }
  
  return fields;
}

// Classify military relevance
function classifyRelevance(text) {
  const lower = text.toLowerCase();
  
  // Explicit military targeting
  const explicitKeywords = ['ex-servicemen', 'ex-serviceman', 'veteran', 'veterans', 'defence personnel', 
    'defense personnel', 'military', 'armed forces', 'esm', 'retired army', 'retired navy', 
    'retired air force', 'fauji', 'sainik'];
  
  if (explicitKeywords.some(k => lower.includes(k))) {
    return 'EXPLICIT';
  }
  
  // Check for exclusions
  const exclusionKeywords = ['active duty only', 'serving personnel only', 'not for veterans'];
  if (exclusionKeywords.some(k => lower.includes(k))) {
    return 'NONE';
  }
  
  // General opportunity open to all
  const inclusiveKeywords = ['all candidates', 'open to all', 'general public', 'anyone can apply'];
  if (inclusiveKeywords.some(k => lower.includes(k))) {
    return 'INCLUSIVE';
  }
  
  // Default to inclusive if it seems like a legitimate opportunity
  if (lower.includes('apply') || lower.includes('opportunity') || lower.includes('position')) {
    return 'INCLUSIVE';
  }
  
  return 'UNCLEAR';
}

// Determine org type
function classifyOrgType(orgName, text) {
  const lower = (orgName + ' ' + text).toLowerCase();
  
  if (lower.includes('.gov') || lower.includes('ministry') || lower.includes('department of') || 
      lower.includes('government') || lower.includes('directorate')) {
    return 'GOVT';
  }
  
  if (lower.includes('psu') || lower.includes('public sector') || lower.includes('bharat') ||
      lower.includes('hindustan') || lower.includes('indian oil') || lower.includes('ongc')) {
    return 'PSU';
  }
  
  if (lower.includes('ngo') || lower.includes('foundation') || lower.includes('trust') ||
      lower.includes('charitable') || lower.includes('non-profit')) {
    return 'NGO';
  }
  
  return 'PRIVATE';
}

// Get missing required fields
function getMissingFields(fields) {
  const required = ['organisation_name', 'opportunity_title', 'opportunity_category', 'description'];
  const missing = [];
  
  for (const field of required) {
    if (!fields[field] || fields[field].length < 3) {
      missing.push(field);
    }
  }
  
  return missing;
}

// Check for duplicates
function isDuplicate(fields) {
  const existing = db.prepare(`
    SELECT id FROM submitted_opportunity 
    WHERE organisation_name = ? AND opportunity_title = ? AND validity_start = ?
  `).get(fields.organisation_name, fields.opportunity_title, fields.validity_start);
  
  return !!existing;
}

// Create opportunity record
function createOpportunity(fields, relevance, orgType) {
  const hash = crypto.createHash('sha256')
    .update(`${fields.organisation_name}${fields.opportunity_title}${fields.validity_start}`)
    .digest('hex');
  
  const result = db.prepare(`
    INSERT INTO submitted_opportunity 
    (organisation_name, organisation_type, opportunity_title, opportunity_category, description, 
     military_relevance_tier, validity_start, validity_end, submission_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fields.organisation_name,
    orgType,
    fields.opportunity_title,
    fields.opportunity_category,
    fields.description,
    relevance,
    fields.validity_start,
    fields.validity_end || null,
    hash
  );
  
  return result.lastInsertRowid;
}

// Process SUBMIT - main entry point
function processSubmit(fromEmail, subject, body) {
  // Check system config
  const config = db.prepare("SELECT enabled FROM system_config WHERE key = 'SUBMIT_BOT_ENABLED'").get();
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
    trust.logEvent('SUBMIT', 'SILENCE', 'SHADOW_BANNED');
    return { action: 'SILENCE', reason: 'SHADOW_BANNED' };
  }
  
  if (trust.isRateLimited(sender.sender_hash)) {
    trust.updateTrust(sender.sender_hash, 'SUBMIT', 'RATE_LIMITED');
    trust.logEvent('SUBMIT', 'SILENCE', 'RATE_LIMITED');
    return { action: 'SILENCE', reason: 'RATE_LIMITED' };
  }
  
  // Extract fields
  const content = `${subject}\n${body}`;
  const fields = extractFields(content);
  
  // Check missing fields
  const missing = getMissingFields(fields);
  
  if (missing.length > 1) {
    trust.updateTrust(sender.sender_hash, 'SUBMIT', 'SILENCE');
    trust.logEvent('SUBMIT', 'SILENCE', 'MISSING_FIELDS');
    return { action: 'SILENCE', reason: 'TOO_MANY_MISSING_FIELDS', missing };
  }
  
  if (missing.length === 1) {
    trust.logEvent('SUBMIT', 'CLARIFICATION_SENT', fields.opportunity_category);
    return { 
      action: 'CLARIFICATION', 
      missingField: missing[0],
      extractedFields: fields 
    };
  }
  
  // Classify relevance
  const relevance = classifyRelevance(content);
  
  if (relevance === 'NONE') {
    trust.updateTrust(sender.sender_hash, 'SUBMIT', 'SILENCE');
    trust.logEvent('SUBMIT', 'REJECTED', 'NO_RELEVANCE');
    return { action: 'REJECTED', reason: 'NOT_MILITARY_RELEVANT' };
  }
  
  if (relevance === 'UNCLEAR') {
    trust.logEvent('SUBMIT', 'CLARIFICATION_SENT', 'RELEVANCE');
    return { 
      action: 'CLARIFICATION', 
      missingField: 'military_relevance',
      extractedFields: fields 
    };
  }
  
  // Check duplicate
  if (isDuplicate(fields)) {
    trust.updateTrust(sender.sender_hash, 'SUBMIT', 'DUPLICATE');
    trust.logEvent('SUBMIT', 'DUPLICATE', fields.opportunity_category);
    return { action: 'DUPLICATE', fields };
  }
  
  // Classify org type
  const orgType = classifyOrgType(fields.organisation_name, content);
  
  // Create record
  const opportunityId = createOpportunity(fields, relevance, orgType);
  
  trust.updateTrust(sender.sender_hash, 'SUBMIT', 'ACCEPTED');
  trust.logEvent('SUBMIT', 'ACCEPTED', fields.opportunity_category);
  
  return {
    action: 'ACCEPTED',
    opportunityId,
    fields: {
      ...fields,
      military_relevance_tier: relevance,
      organisation_type: orgType
    }
  };
}

module.exports = {
  processSubmit,
  extractFields,
  classifyRelevance
};
