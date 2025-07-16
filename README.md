<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset=".github/logo.svg">
  <img alt="Email to Lunch Money" src=".github/logo.svg">
</picture>

A small Cloudflare worker application that accepts various receipt emails via
an email trigger and associates metadata from the receipt to transactions in
Lunch Money.

This may be useful for those who want to answer questions like:

> What did I buy on Amazon for $75?
> Where did I go on that $12.50 Lyft ride?

### Before Email to Lunch Money

| Date       | Payee  | Amount | Notes |
|------------|--------|--------|-------|
| 2025-07-10 | Amazon | $43.21 |       |
| 2025-07-10 | Lyft   | $8.50  |       |
| 2025-07-10 | Apple  | $9.99  |       |

### After Processing

| Date       | Payee         | Amount | Notes |
|------------|---------------|--------|-------|
| 2025-07-10 | Amazon (split)| $28.22 | Amazon Mise En Scene Hair Serum (113-7795219-8445010) |
| 2025-07-10 | Amazon (split)| $14.99 | Amazon CERRXIAN power adapter (113-5327144-6942647) |
| 2025-07-10 | Lyft          | $8.50  | Lyft 186 States St, San Francisco, CA → 882 Sutter St, San Francisco, CA [16:40, 27m] |
| 2025-07-10 | Apple         | $9.99  | Apple iCloud+ with 2TB storage |

## How it works

The general idea is that you send various types of receipts to this service.
Support for the following emails is currently implemented

- Amazon order emails. Orders with multiple items have their associated Lunch
  Money transactions split into a single transaction for each item. A note is
  added to transactions with a shortened item name and order number.

- Lyft rideshare and Bike rides. A note is added to each transaction with the
  start and end location, time of ride, and duration.

- Apple receipts. Adds the name of the app, subscription, or in-app purchase as
  a note to the Apple transaction.

Some emails I would like to add

- Uber rides. Basically the same as the Lyft rides

- All square receipt emails. Since many places use Square's point of sales
  terminals, we can record receipt details on transactions.

### Workflow

1. Receive receipt emails for some service such as Amazon or Lyft. These
   typically are sent automatically, though if disable, you can likely re-enable
   them in the settings of whatever the service is.

2. Setup Gmail filters to automatically label receipt emails to be forwarded. I
   use [gmailctl](https://github.com/mbrt/gmailctl) to declare my filters,
   though you can just as easily configure this in the Web UI. Emails to be
   forwarded are labeled with `Fwd / Lunch Money`. You can find [my filters
   here](https://github.com/evanpurkhiser/gmailctl-personal/blob/main/evanpurkhiser%40gmail.com.jsonnet)

   > [!NOTE]
   > Ideally the emails could be directly forwarded using the forwarding filter
   > action, however doing so does not forward the entire email, including the
   > plain text version, which is often easier to parse.

3. A [Google App Script](https://developers.google.com/apps-script) is used to
   look for emails labeled as `Fwd / Lunch Money` and it forwards the entire
   raw email to the Cloudflare worker.

   The App Script is in [`./google-app-script`](./google-app-script).

4. The worker receives the email and determines which available Email Processor
   is able to parse the email. Processors typically look at the from header and
   subject, though they can use any part of the email to determine if they can
   handle the email.

5. Each processor may do their own processing:

   - `amazon` parses out the items ordered from the plain text email and passes
     the text to the OpenAI API to get a shortened version of the item names
     (since amazon items typically have very long names). 

   - `lyft-bike` converts the HTML email to text (as they do not send plain
     text variants) and simply uses regex to extract the ride metadata.

6. A "Lunch Money Action" is stored in a database to be processed once the
   transaction posts and is synchronized to Lunch Money.

7. The worker has a scheduled execution that looks for pending Lunch Money
   Actions and uses matching rules in the action (typically payyee name and
   amount) to match transactions in Lunch Money. Once found the transaction is
   updated according to the action

   Actions currently support:

   - Splitting transactions
   - Adding notes to transactions

## Secrets

- `LUNCHMONEY_API_KEY` - Get this in your lunchmoney settings
- `OPENAI_API_KEY` - Needed for processors that talk to OpenAI
