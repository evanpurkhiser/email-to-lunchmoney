/**
 * Extracts the raw message body from emails labeled with the configured label
 * and forwards them to the configured ingest email.
 *
 * This Google App Script exists purely due to a limitation with gmails filter
 * forwarding action, where it is impossible to access the plain text body of a
 * multipart email.
 *
 * The raw content is base64-encoded to prevent line wrapping issues that could
 * corrupt email structure and attachments during forwarding.
 *
 * Configuration:
 * - GMAIL_LABEL: The Gmail label to monitor (e.g., "Fwd / Lunch Money")
 * - INGEST_EMAIL: The email address to forward to (e.g., "lunchmoney-details@yourdomain.com")
 *
 * These properties must be set in Project Settings > Script Properties.
 */
function findAndForwardEmails() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const label = scriptProperties.getProperty('GMAIL_LABEL');
  const ingestEmail = scriptProperties.getProperty('INGEST_EMAIL');

  if (!label || !ingestEmail) {
    throw new Error(
      'Missing required script properties. Please set GMAIL_LABEL and INGEST_EMAIL in Project Settings > Script Properties.'
    );
  }

  const gmailLabel = GmailApp.getUserLabelByName(label);

  if (!gmailLabel) {
    throw new Error(
      `Gmail label "${label}" not found. Please create the label or update the GMAIL_LABEL property.`
    );
  }

  const threads = gmailLabel.getThreads();

  if (threads.length > 0) {
    Logger.log(`Found ${threads.length} emails to forward...`);
  }

  for (const thread of threads) {
    const messages = thread.getMessages();
    const lastMessage = messages[messages.length - 1];

    const subject = lastMessage.getSubject();
    const rawBody = lastMessage.getRawContent();

    // Base64 encode the raw email content to prevent line wrapping issues that
    // could corrupt MIME structure and attachments during forwarding
    const encodedBody = Utilities.base64Encode(rawBody);

    GmailApp.sendEmail(ingestEmail, subject, encodedBody);

    thread.removeLabel(gmailLabel);
  }
}
