// Email templates for FAUJNET responses

const templates = {
  // ASK BOT TEMPLATES
  ASK_RESPONSE: {
    subject: 'FAUJNET: Response to your query',
    body: (data) => `Your query has been processed.

VERIFIED INFORMATION
--------------------
${data.results.length > 0 ? data.results.map((r, i) => 
  `${i + 1}. ${r.opportunity_title || r.document_number}
   ${r.organisation_name || r.authority_name}
   ${r.description || r.clauses}
   Status: ${r.status}
`).join('\n') : 'No matching records found.'}

---
This is an automated response from FAUJNET.
No reply is required or monitored.
Reference: FAUJ-ASK-${Date.now()}`
  },

  ASK_CLARIFICATION: {
    subject: 'FAUJNET: Additional information required',
    body: (data) => `Your query could not be processed due to missing information.

MISSING INFORMATION
-------------------
${data.missingField === 'service' ? 'Please specify which service branch (Army, Navy, Air Force, Paramilitary).' : ''}
${data.missingField === 'category' ? 'Please specify the opportunity category (Employment, Training, Scholarship, Healthcare, etc.).' : ''}

Please send a new email with complete information.
One clarification request is sent per query.
Incomplete follow-ups will not receive responses.

---
This is an automated response from FAUJNET.
Reference: FAUJ-ASK-${Date.now()}`
  },

  ASK_NO_MATCH: {
    subject: 'FAUJNET: No verified information found',
    body: (data) => `Your query has been processed.

RESULT
------
No verified information exists in the FAUJNET registry matching your criteria.

This is not an error. FAUJNET only returns verified information from official sources.

---
This is an automated response from FAUJNET.
Reference: FAUJ-ASK-${Date.now()}`
  },

  ASK_CONFLICT: {
    subject: 'FAUJNET: Conflicting information detected',
    body: (data) => `Your query has identified conflicting official information.

CONFLICT DETAILS
----------------
Multiple sources provide different information on this topic.
Please contact the relevant authority directly for clarification.

FAUJNET does not interpret or resolve conflicts.

---
This is an automated response from FAUJNET.
Reference: FAUJ-ASK-${Date.now()}`
  },

  // SUBMIT BOT TEMPLATES
  SUBMIT_ACCEPTED: {
    subject: 'FAUJNET: Opportunity submission accepted',
    body: (data) => `Your opportunity submission has been accepted.

SUBMISSION DETAILS
------------------
Opportunity ID: ${data.opportunityId}
Title: ${data.fields.opportunity_title}
Organisation: ${data.fields.organisation_name}
Category: ${data.fields.opportunity_category}
Relevance: ${data.fields.military_relevance_tier}
Valid From: ${data.fields.validity_start}
${data.fields.validity_end ? `Valid Until: ${data.fields.validity_end}` : ''}

STATUS
------
Your submission is now ACTIVE in the FAUJNET registry.

IMPORTANT
---------
- No edits or updates are possible via email
- To withdraw, send email with subject "WITHDRAW ${data.opportunityId}"
- Expired submissions are automatically marked inactive

---
This is an automated response from FAUJNET.
Reference: FAUJ-SUB-${Date.now()}`
  },

  SUBMIT_CLARIFICATION: {
    subject: 'FAUJNET: Submission incomplete',
    body: (data) => `Your opportunity submission could not be processed.

MISSING FIELD
-------------
${data.missingField === 'organisation_name' ? 'Organisation name is required.' : ''}
${data.missingField === 'opportunity_title' ? 'Opportunity title is required.' : ''}
${data.missingField === 'opportunity_category' ? 'Category is required (Employment, Training, Scholarship, etc.).' : ''}
${data.missingField === 'description' ? 'Description is required (minimum 50 characters).' : ''}
${data.missingField === 'military_relevance' ? 'Please clarify if this opportunity is specifically for veterans (EXPLICIT) or open to all including veterans (INCLUSIVE).' : ''}

EXTRACTED INFORMATION
---------------------
${Object.entries(data.extractedFields || {}).map(([k, v]) => `${k}: ${v}`).join('\n')}

Please send a new email with complete information.

---
This is an automated response from FAUJNET.
Reference: FAUJ-SUB-${Date.now()}`
  },

  SUBMIT_DUPLICATE: {
    subject: 'FAUJNET: Duplicate submission detected',
    body: (data) => `Your submission matches an existing record.

EXISTING RECORD
---------------
Title: ${data.fields.opportunity_title}
Organisation: ${data.fields.organisation_name}

No new record has been created.

---
This is an automated response from FAUJNET.
Reference: FAUJ-SUB-${Date.now()}`
  },

  SUBMIT_REJECTED: {
    subject: 'FAUJNET: Submission not accepted',
    body: (data) => `Your submission could not be accepted.

REASON
------
The opportunity does not appear to be relevant to the military community.

FAUJNET only accepts:
- Opportunities explicitly for ex-servicemen/veterans
- Opportunities open to all candidates including veterans

---
This is an automated response from FAUJNET.
Reference: FAUJ-SUB-${Date.now()}`
  }
};

function getTemplate(type, data) {
  const template = templates[type];
  if (!template) return null;
  
  return {
    subject: template.subject,
    body: template.body(data)
  };
}

module.exports = { templates, getTemplate };
