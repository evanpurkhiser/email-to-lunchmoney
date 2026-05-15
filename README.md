<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset=".github/logo.svg">
  <img alt="Email to Lunch Money" src=".github/logo.svg">
</picture>

[![Build Status](https://github.com/evanpurkhiser/email-to-lunchmoney/actions/workflows/main.yml/badge.svg)](https://github.com/evanpurkhiser/email-to-lunchmoney/actions/workflows/main.yml)

📥 _Parse receipt emails into meaningful metadata in Lunch Money_

**Email to Lunch Money** is a small Cloudflare worker application that accepts
various receipt emails via an email trigger and associates metadata from the
receipt to transactions in Lunch Money.

> [!TIP]
> **Want to deploy this service yourself?** There is a detailed guide in [SETUP.md](SETUP.md) with step-by-step instructions for setting up your own instance.

This may be useful for those who want to answer questions like:

> What did I buy on Amazon for $75?
> Where did I go on that $12.50 Lyft ride?

### Before Email to Lunch Money

| Payee           | Amount  | Notes |
| --------------- | ------- | ----- |
| Amazon          | $43.21  |       |
| United Airlines | $355.66 |       |
| Cloudflare      | $25.20  |       |
| Lyft            | $8.50   |       |
| Apple           | $9.99   |       |
| Steam           | $5.43   |       |

### After Processing

| Payee           | Amount  | Notes                                                                            |
| --------------- | ------- | -------------------------------------------------------------------------------- |
| Amazon          | $28.22  | Mise En Scene Hair Serum (113-7795219-8445010)                                   |
| Amazon          | $14.99  | CERRXIAN power adapter (113-5327144-6942647)                                     |
| United Airlines | $355.66 | EWR → SFO (ORCQG9)                                                               |
| Cloudflare      | $25.20  | prolink.tools renewal (IN-48951432)                                              |
| Lyft            | $8.50   | 186 States St, San Francisco, CA → 882 Sutter St, San Francisco, CA [16:40, 27m] |
| Apple           | $9.99   | iCloud+ with 2TB storage                                                         |
| Steam           | $5.43   | Geometry Dash                                                                    |

## How it works

The general idea is that you send various types of receipts to this service.
Support for the following emails is currently implemented

- **Airline receipts**. Extracts flight details from confirmation/receipt emails
  for United Airlines, Delta Air Lines, Alaska Airlines, American Airlines, and
  Southwest Airlines. Adds route (origin → destination) and confirmation code
  as transaction notes.

- **Amazon order emails**. Orders with multiple items have their associated Lunch
  Money transactions split into a single transaction for each item. A note is
  added to transactions with a shortened item name and order number.

- **Booking.com receipts** (USD only). Adds property name, check-in/check-out dates,
  and number of nights as a note to Booking.com transactions. Currently only
  processes USD receipts.

- **Cloudflare invoices**. Extracts invoice details from PDF invoice
  attachments. Domain renewals and other services are added as transaction
  notes with invoice IDs.

- **Lyft rideshare and Bike rides**. A note is added to each transaction with the
  start and end location, time of ride, and duration.

- **Apple receipts**. Adds the name of the app, subscription, or in-app purchase as
  a note to the Apple transaction.

- **Steam purchase emails**. Extracts the game name from purchase confirmation
  emails and adds it as a note to the Steam transaction.

- **Uber rideshare receipts**. A note is added to each transaction with the
  start and end location, time of ride, and duration.

Some emails I would like to add

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

3. A [Google App Script](https://developers.google.com/apps-script) is used to
   look for emails labeled as `Fwd / Lunch Money` and it POSTs the entire
   raw email to the Cloudflare Worker's HTTP endpoint.

   The App Script is in [`./google-app-script`](./google-app-script).

4. The worker receives the email and determines which available Email Processor
   is able to parse the email. Processors typically look at the from header and
   subject, though they can use any part of the email to determine if they can
   handle the email.

5. Each processor may do their own processing:
   - `amazon` parses out the items ordered from the plain text email and passes
     the text to the OpenAI API to get a shortened version of the item names
     (since amazon items typically have very long names).

   - `cloudflare` extracts text from PDF attachments using pdfjs-serverless and
     uses OpenAI to parse structured invoice data including line items and costs.

   - `lyft-bike` converts the HTML email to text (as they do not send plain
     text variants) and simply uses regex to extract the ride metadata.

   - `steam` converts the HTML email to text and uses regex to extract the game
     name and purchase total.

6. A "Lunch Money Action" is stored in a database to be processed once the
   transaction posts and is synchronized to Lunch Money.

7. The worker has a scheduled execution that looks for pending Lunch Money
   Actions and uses matching rules in the action (typically payyee name and
   amount) to match transactions in Lunch Money. Once found the transaction is
   updated according to the action

   Actions currently support:
   - Splitting transactions
   - Adding notes to transactions

## Future Work

### Flexible Matching Strategies

Currently, processors use exact amount matching to find corresponding transactions in Lunch Money. This works well when the receipt amount matches the transaction amount exactly (e.g., USD transactions in USD accounts).

However, this approach fails for:

- **Foreign currency transactions**: A Booking.com receipt in CAD/EUR/JPY won't match USD transactions in Lunch Money
- **Currency conversion fees**: The final transaction amount may differ slightly from the receipt due to exchange rates and fees
- **Dynamic exchange rates**: Exchange rates change between booking and charging

**Proposed solution**: Implement flexible matching strategies per processor that can:

- Accept an approximate amount range (e.g., ±5% for currency conversions)
- Use currency conversion APIs to estimate expected amounts
- Match based on date proximity + payee when exact amounts aren't available
- Allow processors to specify their matching confidence level

This would enable processors like `booking` to handle international receipts by:

1. Detecting non-USD currency in receipt (CAD $756.16)
2. Converting to approximate USD range using current rates (~$540-560 USD)
3. Matching transactions within that range + date proximity
4. Attaching receipt details even when exact amounts don't match

## Secrets

- `INGEST_TOKEN` - Authentication token for the /ingest endpoint (generate a secure random token)
- `LUNCHMONEY_API_KEY` - Get this in your lunchmoney settings. Used for single-budget setups.
- `LUNCHMONEY_API_KEYS` - Optional comma-delimited ordered list of Lunch Money API tokens for multi-budget setups. When provided, the worker checks each budget in order until an action matches.
- `OPENAI_API_KEY` - Needed for processors that talk to OpenAI
