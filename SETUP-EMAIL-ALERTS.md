# SlabHQ Email Alert System — Setup Guide

## Architecture
```
User subscribes on site
        ↓
Cloudflare Worker (free)
   ├── Saves subscriber to subscribers.json (via GitHub API)
   └── Sends welcome email (via Resend API)

Daily @ 6am PST:
GitHub Actions cron (free for public repos)
   ├── Fetches Open-Meteo snow data for all resorts
   ├── Checks thresholds (8"+ powder, 12"+ storm, 85+ score)
   ├── Reads subscribers.json
   └── Sends alert emails via Resend (free: 100/day, 3,000/month)
```

**Total cost: $0/month**

---

## Step 1: Create a Resend Account (email sending)

1. Go to [resend.com](https://resend.com) and sign up (free, no credit card)
2. After signup, go to **API Keys** → **Create API Key**
3. Name it `slabhq-alerts`, select **Full access**, click Create
4. **Copy the API key** (starts with `re_...`) — you'll need it for both GitHub Actions and Cloudflare

### Free tier limits:
- 100 emails/day
- 3,000 emails/month
- Sends from `onboarding@resend.dev` on free plan (or custom domain if you add one)

### Optional: Add custom domain
If you own a domain and want emails from `alerts@yourdomain.com`:
1. Go to Resend → **Domains** → **Add Domain**
2. Add DNS records (TXT, MX) as instructed
3. Update `FROM_EMAIL` in the worker and GitHub Actions

---

## Step 2: Add GitHub Secrets

1. Go to your repo: `github.com/xiaoseanlu/SlabHQ/settings/secrets/actions`
2. Click **New repository secret** and add:

| Secret Name | Value |
|-------------|-------|
| `RESEND_API_KEY` | Your Resend API key (`re_...`) |
| `FROM_EMAIL` | `SlabHQ Alerts <onboarding@resend.dev>` (or custom domain) |

---

## Step 3: Deploy the Cloudflare Worker (subscription endpoint)

### 3a. Create a Cloudflare account
1. Go to [cloudflare.com](https://dash.cloudflare.com/sign-up) and sign up (free)
2. No domain required — Workers work on `*.workers.dev` subdomain

### 3b. Install Wrangler CLI
```bash
npm install -g wrangler
wrangler login  # Opens browser for auth
```

### 3c. Create a GitHub Personal Access Token
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens?type=beta)
2. Click **Generate new token (fine-grained)**
3. Name: `slabhq-worker`
4. Repository access: **Only select repositories** → `SlabHQ`
5. Permissions: **Contents** → Read and write
6. Click Generate → **copy the token**

### 3d. Deploy the Worker
```bash
cd worker/
npx wrangler deploy

# Set secrets:
npx wrangler secret put GITHUB_TOKEN
# Paste your GitHub token when prompted

npx wrangler secret put RESEND_API_KEY
# Paste your Resend API key when prompted
```

### 3e. Get your Worker URL
After deploying, Wrangler will show:
```
Published slabhq-subscribe to https://slabhq-subscribe.YOUR_SUBDOMAIN.workers.dev
```

### 3f. Update index.html
Open `index.html` and find this line:
```javascript
const SUBSCRIBE_URL='https://slabhq-subscribe.YOUR_SUBDOMAIN.workers.dev';
```
Replace `YOUR_SUBDOMAIN` with your actual Cloudflare Workers subdomain.

---

## Step 4: Test Everything

### Test the subscription endpoint:
```bash
curl -X POST https://slabhq-subscribe.YOUR_SUBDOMAIN.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","location":"Livermore, CA","favorites":"palisades, mammoth","prefs":["powder_8in","storm_12in","epic_85"]}'
```
Expected: `{"ok":true,"message":"Subscribed successfully"}`
Check: `subscribers.json` in your repo should now have the entry.

### Test the daily alert (manual trigger):
1. Go to your repo → **Actions** tab
2. Click **Daily Snow Alert** workflow
3. Click **Run workflow** → **Run workflow**
4. Check the logs — you'll see snow conditions and whether alerts were sent

### Test with dry run (no Resend key):
```bash
node scripts/check-snow-and-notify.js
```
Without `RESEND_API_KEY` set, it runs in dry-run mode and logs what it would send.

---

## How Alerts Work

### Powder Alert (triggered when conditions are met):
- **8"+ fresh snow** in 24 hours at a tracked resort → "Powder Alert"
- **12"+ storm total** across 7 days → "Storm Alert"
- **Score 85+** (epic conditions) → "Epic Conditions Alert"

### Weekly Digest (every Monday):
- If subscriber opted into `weekly_digest`
- Summarizes all resort rankings and conditions

### Email includes:
- Headline with snow amounts
- Top 5 resorts ranked by score
- 7-day snowfall bar chart for top 3 resorts
- Subscriber's tracked resorts with conditions
- Direct link to SlabHQ

---

## Customization

### Change alert thresholds:
Edit `scripts/check-snow-and-notify.js`:
```javascript
const THRESHOLDS = {
  powder_8in: 8,     // inches of fresh snow
  storm_12in: 12,    // inches total storm
  epic_85: 85,       // minimum score
};
```

### Change schedule:
Edit `.github/workflows/snow-alert.yml`:
```yaml
schedule:
  - cron: '0 14 * * *'  # 6am PST (UTC-8)
```

### Add/remove resorts:
Edit the `RESORTS` array in `scripts/check-snow-and-notify.js` to match your `index.html`.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No emails received | Check Resend dashboard for delivery status. Check spam folder. |
| Worker returns 500 | Check `GITHUB_TOKEN` is valid and has Contents write permission |
| GitHub Actions doesn't run | Ensure repo is public (free Actions). Check Actions tab is enabled. |
| "Rate limit" errors | Open-Meteo allows ~10,000 requests/day. You're well under. |
| Want custom from address | Add a domain in Resend, update `FROM_EMAIL` everywhere |
