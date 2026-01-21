# Email to Lunch Money - Setup Guide

This guide will walk you through setting up the email-to-lunchmoney service to automatically enrich your Lunch Money transactions with details from receipt emails.

## Overview

The setup process involves four main steps:

1. **Gmail Label Setup** - Configure Gmail to automatically label receipt emails that should be forwarded
2. **Google Apps Script Deployment** - Deploy a script that monitors labeled emails and forwards them to the service
3. **Cloudflare Workers Deployment** - Deploy the main processing service on Cloudflare
4. **Service Configuration** - Configure API tokens, optional Telegram notifications, and other settings

The service will parse receipt emails from supported services (Amazon, Lyft, Apple, Cloudflare), extract transaction details, and automatically update your Lunch Money transactions with notes or split them into itemized line items.

---

## Prerequisites

**Important:** Please ensure all prerequisites are met before beginning the setup process.

Before starting, ensure you have:

- A Gmail account with receipt emails you want to process
- A [Lunch Money](https://lunchmoney.app) account
- An [OpenAI API account](https://platform.openai.com) (for AI-powered parsing)
- A [Cloudflare account](https://cloudflare.com) (free tier works fine)
- **A domain registered with or proxied through Cloudflare** (required for Email Routing)
  - You can [register a domain through Cloudflare](https://developers.cloudflare.com/registrar/get-started/register-domain/) at cost pricing
  - Or transfer an existing domain to use Cloudflare nameservers
- Node.js installed (v18 or later recommended)
- Basic familiarity with command line tools and git

**Optional:**
- A Telegram bot (for notifications about old unprocessed actions)

---

## 1. Gmail Label Setup

The first step is to configure Gmail to automatically apply a label to receipt emails that should be forwarded to the service.

> [!NOTE]
> **Using gmailctl for filter management**
>
> If you manage many Gmail filters, consider using [gmailctl](https://github.com/mbrt/gmailctl) to define filters as code. This makes it easier to version control and maintain complex filter setups.
>
> See [evanpurkhiser/gmailctl-personal](https://github.com/evanpurkhiser/gmailctl-personal) for a complete example configuration, including the Lunch Money forwarding rules starting at [line 758](https://github.com/evanpurkhiser/gmailctl-personal/blob/main/evanpurkhiser@gmail.com.jsonnet#L758).

### 1.1 Create the Gmail Label

1. Open Gmail in your browser
2. In the left sidebar, scroll down and click **"Create new label"** (or go to Settings → Labels → Create new label)
3. Create a label named: `Fwd / Lunch Money`
4. Click **Create**

### 1.2 Create Gmail Filters

Now you'll create filters to automatically apply this label to specific receipt emails. The service currently supports:

- **Amazon** - Order confirmations
- **Lyft** - Ride and bike rental receipts
- **Apple** - App Store and iTunes receipts
- **Cloudflare** - Invoices (with PDF attachments)

<details>
<summary><strong>Amazon Filter</strong></summary>

1. In Gmail, click the search box at the top
2. Click the filter icon (or use the dropdown to select "Show search options")
3. Configure the filter:
   - **From:** `amazon.com`
   - **Subject:** `Ordered:`
4. Click **"Create filter"**
5. Check **"Apply the label"** and select `Fwd / Lunch Money`
6. Click **"Create filter"**

</details>

<details>
<summary><strong>Lyft Ride Filter</strong></summary>

1. In Gmail, click the search box at the top
2. Click the filter icon (or use the dropdown to select "Show search options")
3. Configure the filter:
   - **From:** `lyftmail.com`
   - **Subject:** `Your Ride with`
4. Click **"Create filter"**
5. Check **"Apply the label"** and select `Fwd / Lunch Money`
6. Click **"Create filter"**

</details>

<details>
<summary><strong>Lyft Bike Filter</strong></summary>

1. In Gmail, click the search box at the top
2. Click the filter icon (or use the dropdown to select "Show search options")
3. Configure the filter:
   - **From:** `lyftmail.com`
   - **Subject:** `Your Lyft Bike ride`
4. Click **"Create filter"**
5. Check **"Apply the label"** and select `Fwd / Lunch Money`
6. Click **"Create filter"**

</details>

<details>
<summary><strong>Apple Filter</strong></summary>

1. In Gmail, click the search box at the top
2. Click the filter icon (or use the dropdown to select "Show search options")
3. Configure the filter:
   - **From:** `email.apple.com`
   - **Subject:** `Your receipt from Apple.`
4. Click **"Create filter"**
5. Check **"Apply the label"** and select `Fwd / Lunch Money`
6. Click **"Create filter"**

</details>

<details>
<summary><strong>Cloudflare Filter</strong></summary>

1. In Gmail, click the search box at the top
2. Click the filter icon (or use the dropdown to select "Show search options")
3. Configure the filter:
   - **From:** `cloudflare.com`
   - **Subject:** `Your Cloudflare invoice is attached`
   - **Has attachment:** Yes
4. Click **"Create filter"**
5. Check **"Apply the label"** and select `Fwd / Lunch Money`
6. Click **"Create filter"**

</details>

---

## 2. Google Apps Script Deployment

The Apps Script monitors emails with the `Fwd / Lunch Money` label and forwards them to the Cloudflare service.

> [!NOTE]
> **Why use an Apps Script instead of Gmail's built-in forwarding?**
>
> While Gmail does have the ability to forward emails based on filters, the forwarded emails may not include attachments and plain-text versions of the email, making it impossible to parse all receipt emails correctly. The Apps Script ensures the entirety of the original email (including all MIME parts and attachments) is forwarded to email-to-lunchmoney.

### 2.1 Install clasp (Google Apps Script CLI)

```bash
npm install -g @google/clasp
```

### 2.2 Authenticate with Google

```bash
clasp login
```

This will open a browser window to authenticate with your Google account. Grant the necessary permissions.

### 2.3 Clone and Configure the Script

1. Clone this repository (if you haven't already):
   ```bash
   git clone https://github.com/evanpurkhiser/email-to-lunchmoney.git
   cd email-to-lunchmoney
   ```

2. Navigate to the Apps Script directory:
   ```bash
   cd google-app-script
   ```

3. Create a new Apps Script project:
   ```bash
   clasp create --type standalone --title "Email to Lunch Money Forwarder"
   ```

   This will create a `.clasp.json` file with your script ID.

4. Edit `.clasp.json` to add TypeScript support by adding `".ts"` to the `scriptExtensions` array:
   ```json
   {
     "scriptId": "...",
     "rootDir": "",
     "scriptExtensions": [".ts", ".js", ".gs"],
     ...
   }
   ```

5. Deploy the script:
   ```bash
   clasp push
   ```

   This uploads the script to Google Apps Script.

### 2.4 Configure Script Properties

The script needs two configuration properties to be set:

1. Open your Apps Script project:
   ```bash
   clasp open-script
   ```

2. In the Apps Script editor, click **Project Settings** (gear icon in the left sidebar)

3. Scroll down to **Script Properties** and click **Add script property**

4. Add the following two properties:

   | Property Name | Value | Description |
   |--------------|-------|-------------|
   | `GMAIL_LABEL` | `Fwd / Lunch Money` | The Gmail label to monitor |
   | `INGEST_EMAIL` | `lunchmoney-details@yourdomain.com` | Your Cloudflare email routing address |

   **Note:** For `INGEST_EMAIL`, you'll configure the Cloudflare email routing address in Step 3. For now, use your intended domain (you can update this property later once the Cloudflare email routing is set up).

5. Click **Save script properties**

### 2.5 Configure the Trigger

The script needs to run periodically to check for new labeled emails.

1. Open your Apps Script project:
   ```bash
   clasp open-script
   ```

   Or go directly to [script.google.com](https://script.google.com) and open your project.

2. In the left sidebar, click the **clock icon** (Triggers)

3. Click **"+ Add Trigger"** (bottom right)

4. Configure the trigger:
   - **Choose which function to run:** `forwardLabeledEmails`
   - **Choose which deployment should run:** `Head`
   - **Select event source:** `Time-driven`
   - **Select type of time based trigger:** `Minutes timer` or `Hour timer`
   - **Select minute/hour interval:** Every 30 minutes or Every 1 hour (your preference)
     - Note: Gmail quotas limit email forwarding to ~100/day, so hourly is usually sufficient

5. Click **Save**

6. Grant permissions when prompted (the script needs access to read your Gmail messages)

### 2.6 Test the Script

You can manually test the script:

1. First, manually apply the `Fwd / Lunch Money` label to a test email in your Gmail:
   - Find any email in your Gmail inbox
   - Click the label icon and select `Fwd / Lunch Money`

2. In the Apps Script editor, select the `forwardLabeledEmails` function from the dropdown

3. Click **Run** (play button)

4. Check the **Execution log** at the bottom to verify it ran without errors. You should see output similar to:
   ```
   Notice    Execution started
   Info      Found 1 emails to forward...
   Notice    Execution completed
   ```

5. Check that the email you labeled had the `Fwd / Lunch Money` label removed (indicating it was forwarded)

**Note:** The script will successfully forward emails, but they won't be received or processed until you configure Cloudflare email routing in Step 3.

---

## 3. Cloudflare Workers Deployment

Now you'll deploy the main processing service on Cloudflare Workers.

### 3.1 Install Dependencies

From the root of the repository:

```bash
npm install -g wrangler
pnpm install
```

### 3.2 Authenticate with Cloudflare

```bash
wrangler login
```

This will open a browser window to authenticate with your Cloudflare account.

### 3.3 Create a D1 Database

The service uses Cloudflare D1 (SQLite) to store pending actions.

```bash
wrangler d1 create email-to-lunchmoney
```

This will output a database ID. Copy it.

### 3.4 Update wrangler.jsonc

Open `wrangler.jsonc` and update the placeholder values:

1. **Replace the database ID** with the ID from the previous step:
   ```jsonc
   "database_id": "YOUR_DATABASE_ID_HERE"  // Replace with your database ID
   ```

2. **Replace the email address** with your Gmail address (the one you'll be forwarding from):
   ```jsonc
   "ACCEPTED_EMAIL": "youremail@gmail.com"  // Replace with your Gmail address
   ```

The complete `wrangler.jsonc` should look like:
```jsonc
{
  "vars": {
    "ACCEPTED_EMAIL": "your-actual-email@gmail.com"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "email-to-lunchmoney",
      "database_id": "your-actual-database-id-here"
    }
  ]
}
```

### 3.5 Apply Database Migrations

```bash
wrangler d1 migrations apply email-to-lunchmoney --remote
```

This creates the necessary database tables in your remote Cloudflare database.

### 3.6 Deploy the Worker

```bash
wrangler deploy
```

This will:
- Bundle your TypeScript code
- Upload it to Cloudflare Workers
- Configure the scheduled trigger (every 30 minutes)
- Set up the email routing handler

You should see output indicating successful deployment:
```
Published email-to-lunchmoney (X.XX sec)
  https://email-to-lunchmoney.your-subdomain.workers.dev
```

### 3.7 Configure Email Routing

Now that the worker is deployed, configure Cloudflare Email Routing to send emails to it.

1. Go to your Cloudflare dashboard: [dash.cloudflare.com](https://dash.cloudflare.com)
2. Select your domain (you must have a domain registered/proxied through Cloudflare)
3. Go to **Email** → **Email Routing**
4. If not enabled, click **Enable Email Routing** and verify your domain
5. Click **Create address** (or **Routing Rules** → **Create address**)
6. Configure:
   - **Custom address:** `lunchmoney-details` (or your preferred prefix)
   - **Action:** `Send to a Worker`
   - **Destination Worker:** Select `email-to-lunchmoney`
7. Save the email address

The full email address will be: `lunchmoney-details@yourdomain.com`

### 3.8 Update Apps Script Configuration

Now that you have the email routing address, update your Apps Script configuration:

1. Open your Apps Script project:
   ```bash
   cd google-app-script
   clasp open-script
   ```

2. Go to **Project Settings** (gear icon in the left sidebar)

3. Under **Script Properties**, find the `INGEST_EMAIL` property and update it with your Cloudflare email routing address (e.g., `lunchmoney-details@yourdomain.com`)

4. Click **Save script properties**

---

## 4. Service Configuration

Finally, configure the service with your API tokens and optional settings.

### 4.1 Required Secrets

You'll need to set the following secrets in Cloudflare:

#### Lunch Money API Key

1. Log in to [Lunch Money](https://my.lunchmoney.app)
2. Go to **Settings** → **Developers**
3. Create a new API token (or use an existing one)
4. Copy the token and set it in Cloudflare:
   ```bash
   wrangler secret put LUNCHMONEY_API_KEY
   ```
   Paste your token when prompted.

#### OpenAI API Key

1. Log in to [OpenAI Platform](https://platform.openai.com)
2. Go to **API Keys** (in your account settings)
3. Create a new secret key
4. Copy the key and set it in Cloudflare:
   ```bash
   wrangler secret put OPENAI_API_KEY
   ```
   Paste your key when prompted.

**Note:** The service uses OpenAI for parsing complex receipt data (e.g., shortening Amazon item names, parsing Cloudflare invoices). Costs are typically minimal (~$0.01-0.05 per month for normal usage).

### 4.2 Optional: Telegram Notifications

Telegram notifications are useful for monitoring the health of your email-to-lunchmoney service. You'll receive alerts when receipt emails have been processed but couldn't be matched to transactions in Lunch Money for 15+ days. This helps you identify issues such as:

- Transactions that haven't been imported into Lunch Money yet
- Mismatched payee names between the receipt and transaction
- Amount discrepancies preventing automatic matching
- Transactions that were already cleared/reviewed before matching could occur

If you want to enable Telegram notifications:

#### Create a Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` and follow the prompts to create a new bot
3. Copy the bot token provided by BotFather
4. Set the token in Cloudflare:
   ```bash
   wrangler secret put TELEGRAM_TOKEN
   ```

#### Get Your Chat ID

1. Send a message to your bot (or add it to a group/channel)
2. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
3. Look for the `chat` object in the response and copy the `id` value
4. Set the chat ID in Cloudflare:
   ```bash
   wrangler secret put TELEGRAM_CHAT_ID
   ```

**What notifications will I receive?**
- Alerts when actions are older than 15 days and haven't been matched to transactions
- This helps you identify receipt emails that couldn't be automatically processed

### 4.3 Optional: Sentry Error Tracking

If you want centralized error tracking (recommended for production use):

1. Create a free account at [sentry.io](https://sentry.io)
2. Create a new project (select "Cloudflare Workers" as the platform)
3. Copy your DSN (Data Source Name)
4. Set the DSN as a secret in Cloudflare:
   ```bash
   wrangler secret put SENTRY_DSN
   ```
   Paste your DSN when prompted (e.g., `https://...@...sentry.io/...`)

### 4.4 Configuration Variables

Additional configuration is available in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "ACCEPTED_EMAIL": "youremail@gmail.com"  // Only accept forwarded emails from this address
  }
}
```

And in the source code:

- **Old Action Threshold** (`src/old-actions-checker.ts`): Currently 15 days. Actions older than this trigger notifications.
- **Cleanup Threshold** (`src/old-action-cleanup.ts`): Currently 30 days. Notified actions older than this are deleted.
- **Scheduled Frequency** (`wrangler.jsonc`): Currently every 30 minutes (`*/30 * * * *`)

---

## 5. Verification and Testing

### 5.1 Test Email Forwarding

1. Find an existing receipt email in your Gmail (or wait for a new one)
2. Ensure it has the `Fwd / Lunch Money` label applied
3. Wait for the Apps Script trigger to run (or manually run it from the Apps Script editor)
4. Check that the label was removed from the email (indicating it was forwarded)

### 5.2 Check Worker Logs

View logs in Cloudflare to confirm the email was received and processed:

```bash
wrangler tail
```

Or view logs in the Cloudflare dashboard:
1. Go to **Workers & Pages**
2. Select `email-to-lunchmoney`
3. Click **Logs** tab

You should see log entries indicating:
- Email received
- Email parsed
- Processor matched (e.g., "Amazon", "Lyft")
- Action stored in database

### 5.3 Check Database

View pending actions in the D1 database:

```bash
wrangler d1 execute email-to-lunchmoney --command "SELECT * FROM lunchmoney_actions"
```

You should see entries with:
- `id`: Auto-incrementing ID
- `date_created`: Timestamp
- `source`: Email source (e.g., "Amazon")
- `action`: JSON-serialized action data

### 5.4 Verify Lunch Money Updates

After the scheduled worker runs (within 30 minutes), check your Lunch Money account:

1. Go to **Transactions**
2. Find the transaction matching your receipt
3. Verify it has been updated with notes or split into line items

**Matching Logic:**
- The service matches actions to transactions based on **payee name** and **amount**
- Transactions must be in the past 180 days
- Transactions must be uncleared (not marked as cleared/reviewed)

---

## Troubleshooting

### Emails Not Being Forwarded

- Check that the Gmail label is spelled correctly: `Fwd / Lunch Money`
- Verify the Apps Script trigger is running (check trigger history in Apps Script editor)
- Check Apps Script execution logs for errors
- Ensure you granted Gmail permissions to the Apps Script

### Emails Not Being Processed

- Check Cloudflare Worker logs: `wrangler tail`
- Verify the `ACCEPTED_EMAIL` in `wrangler.jsonc` matches your Gmail address
- Ensure email routing is configured correctly in Cloudflare dashboard
- Check that your worker is deployed: `wrangler deployments list`

### Actions Not Matching Transactions

- Verify the transaction exists in Lunch Money within the past 180 days
- Check that the transaction is not already cleared/reviewed
- Verify the payee name and amount match (check D1 database for expected values)
- Look for errors in Cloudflare logs during scheduled processing

### OpenAI API Errors

- Verify your OpenAI API key is valid: `wrangler secret list`
- Check your OpenAI account has available credits
- Review error messages in Cloudflare logs or Sentry

### D1 Database Errors

- Ensure migrations were applied: `wrangler d1 migrations list email-to-lunchmoney`
- Check database binding is correct in `wrangler.jsonc`
- View recent queries in Cloudflare dashboard (D1 → Select database → Metrics)

---

## Maintenance

### Viewing Pending Actions

```bash
wrangler d1 execute email-to-lunchmoney --command "SELECT * FROM lunchmoney_actions ORDER BY date_created DESC"
```

### Manually Deleting an Action

If an action is stuck or incorrect:

```bash
wrangler d1 execute email-to-lunchmoney --command "DELETE FROM lunchmoney_actions WHERE id = <ID>"
```

### Updating Configuration

After changing configuration in `wrangler.jsonc` or source code:

```bash
wrangler deploy
```

After changing secrets:

```bash
wrangler secret put SECRET_NAME
```

### Monitoring

- **Worker Logs:** `wrangler tail` or Cloudflare dashboard
- **D1 Database:** Cloudflare dashboard → D1 → Select database
- **Sentry:** [sentry.io](https://sentry.io) (if configured)
- **Telegram:** Receive notifications for old unprocessed actions

---

## Cost Breakdown

The service is designed to be extremely cost-effective:

| Service | Cost |
|---------|------|
| **Cloudflare Workers** | Free tier (100,000 requests/day, 10ms CPU time per request) |
| **Cloudflare D1** | Free tier (5 GB storage, 5 million reads/day, 100k writes/day) |
| **Cloudflare Email Routing** | Free (unlimited email addresses) |
| **OpenAI API** | ~$0.01-0.05/month (depends on usage, mostly gpt-4o-mini) |
| **Google Apps Script** | Free |

**Expected monthly cost:** ~$0.01-0.05 (OpenAI API only)

---

## Security Considerations

- **Email Verification:** The service only accepts emails from the `ACCEPTED_EMAIL` address (your Gmail)
- **API Keys:** All secrets are stored securely in Cloudflare Workers secrets (encrypted at rest)
- **Database Access:** D1 database is only accessible by your worker
- **Email Content:** Raw email content is processed and then discarded (not permanently stored)
- **Action Data:** Only extracted metadata is stored in D1 (no full email bodies or attachments)
