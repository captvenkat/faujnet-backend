const { Resend } = require('resend');

const resend = new Resend('re_Acm6UCqv_GnmC2rdKMzqi5vGw73aUWGzK');

// Send email response
async function sendEmail(to, subject, body) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'FAUJNET <noreply@faujnetmail.com>',
      to: to,
      subject: subject,
      text: body,
      headers: {
        'X-Auto-Response-Suppress': 'All',
        'Auto-Submitted': 'auto-replied'
      }
    });

    if (error) {
      console.error('Resend error:', error);
      return { success: false, error };
    }

    console.log('Email sent:', data.id);
    return { success: true, id: data.id };
  } catch (err) {
    console.error('Send failed:', err);
    return { success: false, error: err.message };
  }
}

// Verify domain is configured
async function verifySetup() {
  try {
    const { data, error } = await resend.domains.list();
    if (error) {
      console.error('Domain check failed:', error);
      return false;
    }
    console.log('Configured domains:', data);
    return true;
  } catch (err) {
    console.error('Setup check failed:', err);
    return false;
  }
}

module.exports = { sendEmail, verifySetup, resend };
