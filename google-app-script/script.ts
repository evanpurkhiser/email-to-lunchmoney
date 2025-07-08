const LABEL = 'Fwd / Lunch Money';
const INGEST_EMAIL = 'lunchmoney-details@evanpurkhiser.com';

/**
 * Extracts the raw message body from emails labeled with the LABEL and forward
 * them to the INGEST_EMAIL.
 *
 * This Gooogle App Script exists purely due to a limitation with gmails filter
 * forwarding action, where it is impossible to access the plain text body of a
 * multipart email.
 */
function findAndForwardEmails() {
	// Get the threads matching some criteria (e.g., label or query)
	const threads = GmailApp.search(`label:${LABEL}`);

	for (const thread of threads) {
		const messages = thread.getMessages();
		const lastMessage = messages[messages.length - 1];

		const rawBody = lastMessage.getRawContent();
		const subject = lastMessage.getSubject();

		GmailApp.sendEmail(INGEST_EMAIL, subject, rawBody);

		// Optionally mark as read or remove label
		thread.markRead();
		thread.removeLabel(GmailApp.getUserLabelByName(LABEL));
	}
}
