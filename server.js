const express = require('express');
const cors = require('cors');
const db = require('./database');
const askBot = require('./ask-bot');
const submitBot = require('./submit-bot');
const templates = require('./templates');
const { sendEmail, verifySetup } = require('./email');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// RESEND INBOUND WEBHOOK (receives emails)
// ============================================

// Resend sends inbound emails to this endpoint
app.post('/webhook/resend/inbound', async (req, res) => {
  console.log('Inbound email received:', JSON.stringify(req.body, null, 2));
  
  // Resend webhook format: { type, created_at, data: { from, to, subject, text, html, ... } }
  const payload = req.body.data || req.body;
  const { from, to, subject, text, html } = payload;
  
  if (!from || !to) {
    console.log('Missing from/to, payload:', payload);
    return res.status(400).json({ error: 'Missing from/to' });
  }
  
  // Use subject as body if no text/html (common in simple emails)
  const body = text || html || subject || '';
  const toAddress = Array.isArray(to) ? to[0] : to;
  const fromAddress = typeof from === 'object' ? from.email : from;
  
  console.log(`Processing: from=${fromAddress}, to=${toAddress}, subject=${subject}, body=${body}`);
  
  // Route based on recipient
  if (toAddress.includes('ask@')) {
    // Process ASK query
    const result = askBot.processAsk(fromAddress, subject || '', body);
    
    if (result.action !== 'SILENCE') {
      let template = null;
      if (result.action === 'RESPONSE') {
        template = templates.getTemplate('ASK_RESPONSE', result);
      } else if (result.action === 'NO_MATCH') {
        template = templates.getTemplate('ASK_NO_MATCH', result);
      } else if (result.action === 'CLARIFICATION') {
        template = templates.getTemplate('ASK_CLARIFICATION', result);
      } else if (result.action === 'CONFLICT') {
        template = templates.getTemplate('ASK_CONFLICT', result);
      }
      
      if (template) {
        const emailResult = await sendEmail(fromAddress, template.subject, template.body);
        console.log('ASK response sent:', emailResult);
      }
    } else {
      console.log('ASK: SILENCE (no response sent)');
    }
    
    return res.json({ processed: true, action: result.action });
    
  } else if (toAddress.includes('submit@')) {
    // Process SUBMIT
    const result = submitBot.processSubmit(fromAddress, subject || '', body);
    
    if (result.action !== 'SILENCE') {
      let template = null;
      if (result.action === 'ACCEPTED') {
        template = templates.getTemplate('SUBMIT_ACCEPTED', result);
      } else if (result.action === 'CLARIFICATION') {
        template = templates.getTemplate('SUBMIT_CLARIFICATION', result);
      } else if (result.action === 'DUPLICATE') {
        template = templates.getTemplate('SUBMIT_DUPLICATE', result);
      } else if (result.action === 'REJECTED') {
        template = templates.getTemplate('SUBMIT_REJECTED', result);
      }
      
      if (template) {
        const emailResult = await sendEmail(fromAddress, template.subject, template.body);
        console.log('SUBMIT response sent:', emailResult);
      }
    } else {
      console.log('SUBMIT: SILENCE (no response sent)');
    }
    
    return res.json({ processed: true, action: result.action });
  }
  
  res.json({ processed: false, reason: 'Unknown recipient' });
});

// ============================================
// LEGACY WEBHOOK ENDPOINTS (manual integration)
// ============================================

// Process incoming ASK email
app.post('/webhook/ask', async (req, res) => {
  const { from, subject, body } = req.body;
  
  if (!from || !body) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const result = askBot.processAsk(from, subject || '', body);
  
  let response = null;
  if (result.action === 'RESPONSE') {
    response = templates.getTemplate('ASK_RESPONSE', result);
  } else if (result.action === 'NO_MATCH') {
    response = templates.getTemplate('ASK_NO_MATCH', result);
  } else if (result.action === 'CLARIFICATION') {
    response = templates.getTemplate('ASK_CLARIFICATION', result);
  } else if (result.action === 'CONFLICT') {
    response = templates.getTemplate('ASK_CONFLICT', result);
  }
  
  // Send email if response needed and outbound enabled
  let emailSent = false;
  if (response && result.action !== 'SILENCE') {
    const config = db.prepare("SELECT enabled FROM system_config WHERE key = 'OUTBOUND_EMAIL_ENABLED'").get();
    if (config?.enabled) {
      const emailResult = await sendEmail(from, response.subject, response.body);
      emailSent = emailResult.success;
    }
  }
  
  res.json({
    action: result.action,
    sendResponse: result.action !== 'SILENCE',
    emailSent,
    response,
    debug: result
  });
});

// Process incoming SUBMIT email
app.post('/webhook/submit', async (req, res) => {
  const { from, subject, body } = req.body;
  
  if (!from || !body) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const result = submitBot.processSubmit(from, subject || '', body);
  
  let response = null;
  if (result.action === 'ACCEPTED') {
    response = templates.getTemplate('SUBMIT_ACCEPTED', result);
  } else if (result.action === 'CLARIFICATION') {
    response = templates.getTemplate('SUBMIT_CLARIFICATION', result);
  } else if (result.action === 'DUPLICATE') {
    response = templates.getTemplate('SUBMIT_DUPLICATE', result);
  } else if (result.action === 'REJECTED') {
    response = templates.getTemplate('SUBMIT_REJECTED', result);
  }
  
  // Send email if response needed and outbound enabled
  let emailSent = false;
  if (response && result.action !== 'SILENCE') {
    const config = db.prepare("SELECT enabled FROM system_config WHERE key = 'OUTBOUND_EMAIL_ENABLED'").get();
    if (config?.enabled) {
      const emailResult = await sendEmail(from, response.subject, response.body);
      emailSent = emailResult.success;
    }
  }
  
  res.json({
    action: result.action,
    sendResponse: result.action !== 'SILENCE',
    emailSent,
    response,
    debug: result
  });
});

// ============================================
// ADMIN API ENDPOINTS
// ============================================

// Get system status
app.get('/api/admin/status', (req, res) => {
  const configs = db.prepare('SELECT key, enabled FROM system_config').all();
  const configMap = {};
  configs.forEach(c => configMap[c.key] = c.enabled === 1);
  
  const today = new Date().toISOString().split('T')[0];
  const stats = db.prepare(`
    SELECT 
      SUM(CASE WHEN event_type = 'ASK' THEN count ELSE 0 END) as total_asks,
      SUM(CASE WHEN event_type = 'SUBMIT' THEN count ELSE 0 END) as total_submits,
      SUM(CASE WHEN result_type = 'ACCEPTED' THEN count ELSE 0 END) as accepted,
      SUM(CASE WHEN result_type = 'REPLY_SENT' THEN count ELSE 0 END) as replies,
      SUM(CASE WHEN result_type = 'SILENCE' THEN count ELSE 0 END) as silenced
    FROM email_event_log WHERE day_bucket = ?
  `).get(today);
  
  const activeOpps = db.prepare(`
    SELECT COUNT(*) as count FROM submitted_opportunity 
    WHERE status = 'ACTIVE' AND (validity_end IS NULL OR validity_end >= date('now'))
  `).get();
  
  const sources = db.prepare('SELECT COUNT(*) as count FROM source_whitelist WHERE is_enabled = 1').get();
  
  res.json({
    bots: {
      ask: configMap['ASK_BOT_ENABLED'] || false,
      submit: configMap['SUBMIT_BOT_ENABLED'] || false,
      ingestion: configMap['INGESTION_BOT_ENABLED'] || false,
      distribution: configMap['DISTRIBUTION_BOT_ENABLED'] || false
    },
    outboundEmail: configMap['OUTBOUND_EMAIL_ENABLED'] || false,
    safeMode: configMap['SAFE_MODE'] || false,
    today: {
      queries: stats?.total_asks || 0,
      submissions: stats?.total_submits || 0,
      accepted: stats?.accepted || 0,
      replies: stats?.replies || 0,
      silenced: stats?.silenced || 0
    },
    activeOpportunities: activeOpps?.count || 0,
    activeSources: sources?.count || 0
  });
});

// Toggle bot/config
app.post('/api/admin/toggle', (req, res) => {
  const { key, enabled } = req.body;
  
  const validKeys = ['ASK_BOT_ENABLED', 'SUBMIT_BOT_ENABLED', 'INGESTION_BOT_ENABLED', 
    'DISTRIBUTION_BOT_ENABLED', 'OUTBOUND_EMAIL_ENABLED', 'SAFE_MODE'];
  
  if (!validKeys.includes(key)) {
    return res.status(400).json({ error: 'Invalid config key' });
  }
  
  const prev = db.prepare('SELECT enabled FROM system_config WHERE key = ?').get(key);
  
  db.prepare('UPDATE system_config SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?')
    .run(enabled ? 1 : 0, key);
  
  // Log audit
  db.prepare(`
    INSERT INTO admin_audit_log (admin_id, action, target_entity, previous_value, new_value)
    VALUES (?, ?, ?, ?, ?)
  `).run('admin', enabled ? 'BOT_ENABLED' : 'BOT_DISABLED', key, 
    JSON.stringify({ enabled: prev?.enabled === 1 }), 
    JSON.stringify({ enabled }));
  
  res.json({ success: true, key, enabled });
});

// Get opportunities
app.get('/api/opportunities', (req, res) => {
  const { category, relevance, status, limit = 50 } = req.query;
  
  let query = 'SELECT * FROM submitted_opportunity WHERE 1=1';
  const params = [];
  
  if (category) {
    query += ' AND opportunity_category = ?';
    params.push(category);
  }
  if (relevance) {
    query += ' AND military_relevance_tier = ?';
    params.push(relevance);
  }
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  } else {
    query += " AND status = 'ACTIVE'";
  }
  
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit));
  
  const opportunities = db.prepare(query).all(...params);
  
  res.json({ opportunities, count: opportunities.length });
});

// Get single opportunity
app.get('/api/opportunities/:id', (req, res) => {
  const opp = db.prepare('SELECT * FROM submitted_opportunity WHERE id = ?').get(req.params.id);
  
  if (!opp) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  res.json(opp);
});

// Get sources
app.get('/api/admin/sources', (req, res) => {
  const sources = db.prepare('SELECT * FROM source_whitelist ORDER BY created_at DESC').all();
  res.json({ sources });
});

// Get inboxes
app.get('/api/admin/inboxes', (req, res) => {
  const inboxes = db.prepare('SELECT * FROM email_inbox ORDER BY created_at DESC').all();
  res.json({ inboxes });
});

// Get event stats
app.get('/api/admin/stats', (req, res) => {
  const { days = 7 } = req.query;
  
  const stats = db.prepare(`
    SELECT day_bucket, event_type, result_type, SUM(count) as total
    FROM email_event_log
    WHERE day_bucket >= date('now', '-' || ? || ' days')
    GROUP BY day_bucket, event_type, result_type
    ORDER BY day_bucket DESC
  `).all(days);
  
  res.json({ stats });
});

// Get audit log
app.get('/api/admin/audit', (req, res) => {
  const { limit = 100 } = req.query;
  
  const logs = db.prepare(`
    SELECT * FROM admin_audit_log 
    ORDER BY timestamp DESC 
    LIMIT ?
  `).all(parseInt(limit));
  
  res.json({ logs });
});

// Get sender trust stats (aggregated, no PII)
app.get('/api/admin/trust-stats', (req, res) => {
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_senders,
      AVG(trust_score) as avg_score,
      SUM(CASE WHEN is_shadow_banned = 1 THEN 1 ELSE 0 END) as shadow_banned,
      SUM(total_queries) as total_queries,
      SUM(total_submissions) as total_submissions,
      SUM(accepted_submissions) as accepted_submissions
    FROM sender_trust
  `).get();
  
  res.json(stats);
});

// ============================================
// TEST EMAIL ENDPOINT
// ============================================

app.post('/api/test-email', async (req, res) => {
  const { to } = req.body;
  
  if (!to) {
    return res.status(400).json({ error: 'Recipient email required' });
  }
  
  const result = await sendEmail(
    to,
    'FAUJNET: Test Email',
    'This is a test email from FAUJNET.\n\nIf you received this, email integration is working correctly.\n\n---\nFAUJNET - Automated email exchange for India\'s military community.'
  );
  
  res.json(result);
});

// ============================================
// SIMULATE EMAIL (for testing without real email)
// ============================================

app.post('/api/simulate/ask', async (req, res) => {
  const { email, query, sendReal = false } = req.body;
  
  if (!email || !query) {
    return res.status(400).json({ error: 'Email and query required' });
  }
  
  const result = askBot.processAsk(email, '', query);
  
  let response = null;
  if (result.action === 'RESPONSE') {
    response = templates.getTemplate('ASK_RESPONSE', result);
  } else if (result.action === 'NO_MATCH') {
    response = templates.getTemplate('ASK_NO_MATCH', result);
  } else if (result.action === 'CLARIFICATION') {
    response = templates.getTemplate('ASK_CLARIFICATION', result);
  } else if (result.action === 'CONFLICT') {
    response = templates.getTemplate('ASK_CONFLICT', result);
  }
  
  // Optionally send real email
  let emailSent = false;
  if (sendReal && response && result.action !== 'SILENCE') {
    const emailResult = await sendEmail(email, response.subject, response.body);
    emailSent = emailResult.success;
  }
  
  res.json({
    action: result.action,
    wouldSendEmail: result.action !== 'SILENCE',
    emailSent,
    emailResponse: response,
    debug: result
  });
});

app.post('/api/simulate/submit', async (req, res) => {
  const { email, content, sendReal = false } = req.body;
  
  if (!email || !content) {
    return res.status(400).json({ error: 'Email and content required' });
  }
  
  const result = submitBot.processSubmit(email, '', content);
  
  let response = null;
  if (result.action === 'ACCEPTED') {
    response = templates.getTemplate('SUBMIT_ACCEPTED', result);
  } else if (result.action === 'CLARIFICATION') {
    response = templates.getTemplate('SUBMIT_CLARIFICATION', result);
  } else if (result.action === 'DUPLICATE') {
    response = templates.getTemplate('SUBMIT_DUPLICATE', result);
  } else if (result.action === 'REJECTED') {
    response = templates.getTemplate('SUBMIT_REJECTED', result);
  }
  
  // Optionally send real email
  let emailSent = false;
  if (sendReal && response && result.action !== 'SILENCE') {
    const emailResult = await sendEmail(email, response.subject, response.body);
    emailSent = emailResult.success;
  }
  
  res.json({
    action: result.action,
    wouldSendEmail: result.action !== 'SILENCE',
    emailSent,
    emailResponse: response,
    debug: result
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Email setup check
app.get('/api/email-status', async (req, res) => {
  const ok = await verifySetup();
  res.json({ configured: ok });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`FAUJNET Backend running on port ${PORT}`);
  console.log(`- Resend Inbound: POST /webhook/resend/inbound`);
  console.log(`- Webhook ASK: POST /webhook/ask`);
  console.log(`- Webhook SUBMIT: POST /webhook/submit`);
  console.log(`- Admin API: /api/admin/*`);
  console.log(`- Simulate: /api/simulate/*`);
  console.log(`- Test Email: POST /api/test-email`);
});
