const { Resend } = require('resend');

const resend = new Resend('re_Acm6UCqv_GnmC2rdKMzqi5vGw73aUWGzK');

// Send email response with reply-friendly sender
async function sendEmail(to, subject, body, type = 'ask') {
  // Use the appropriate sender based on email type
  // This allows users to reply directly
  const fromAddress = type === 'submit' 
    ? 'FAUJNET <submit@faujnetmail.com>'
    : 'FAUJNET <ask@faujnetmail.com>';

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: to,
      subject: subject,
      text: body,
      headers: {
        'X-Auto-Response-Suppress': 'OOF', // Only suppress Out-of-Office, allow normal replies
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
