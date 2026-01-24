/**
 * Extracts the raw message body from emails labeled with the configured label
 * and POSTs them to the configured Worker endpoint.
 *
 * This Google App Script exists purely due to a limitation with gmails filter
 * forwarding action, where it is impossible to access the plain text body of a
 * multipart email.
 *
 * The raw content is base64-encoded to prevent line wrapping issues that could
 * corrupt email structure and attachments during transmission.
 *
 * Configuration:
 * - GMAIL_LABEL: The Gmail label to monitor (e.g., "Fwd / Lunch Money")
 * - INGEST_URL: The Worker endpoint URL (e.g., "https://email-to-lunchmoney.your-subdomain.workers.dev/ingest")
 * - INGEST_TOKEN: Authentication token for the Worker endpoint
 *
 * These properties must be set in Project Settings > Script Properties.
 */
function findAndForwardEmails() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const label = scriptProperties.getProperty('GMAIL_LABEL');
  const ingestUrl = scriptProperties.getProperty('INGEST_URL');
  const ingestToken = scriptProperties.getProperty('INGEST_TOKEN');

  if (!label || !ingestUrl || !ingestToken) {
    throw new Error(
      'Missing required script properties. Please set GMAIL_LABEL, INGEST_URL, and INGEST_TOKEN in Project Settings > Script Properties.'
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
    Logger.log(`Found ${threads.length} emails to process...`);
  }

  for (const thread of threads) {
    const messages = thread.getMessages();
    const lastMessage = messages[messages.length - 1];

    const subject = lastMessage.getSubject();
    const rawBody = lastMessage.getRawContent();

    // Base64 encode the raw email content to prevent line wrapping issues that
    // could corrupt MIME structure and attachments during transmission
    const encodedBody = Utilities.base64Encode(rawBody);

    try {
      // POST to the Worker endpoint
      const response = UrlFetchApp.fetch(ingestUrl, {
        method: 'post',
        headers: {
          Authorization: `Bearer ${ingestToken}`,
        },
        payload: encodedBody,
        muteHttpExceptions: true,
      });

      const statusCode = response.getResponseCode();

      if (statusCode === 202) {
        Logger.log(`Successfully sent email: ${subject}`);
        thread.removeLabel(gmailLabel);
      } else {
        const responseBody = response.getContentText();
        Logger.log(
          `Failed to send email "${subject}". Status: ${statusCode}, Response: ${responseBody}`
        );
        // Remove label even on failure to avoid reprocessing (per design decision)
        thread.removeLabel(gmailLabel);
      }
    } catch (error) {
      Logger.log(`Error sending email "${subject}": ${error}`);
      // Remove label even on error to avoid reprocessing
      thread.removeLabel(gmailLabel);
    }
  }
}
