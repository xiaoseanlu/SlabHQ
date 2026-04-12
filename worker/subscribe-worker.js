/**
 * SlabHQ Subscription Worker — Cloudflare Worker
 * Handles email subscription form submissions from the static site.
 * Stores subscribers by committing to the GitHub repo's subscribers.json.
 *
 * Environment variables (set in Cloudflare dashboard):
 *   GITHUB_TOKEN  — GitHub Personal Access Token (fine-grained, repo write)
 *   GITHUB_REPO   — e.g. "xiaoseanlu/SlabHQ"
 *
 * Deploy: npx wrangler deploy worker/subscribe-worker.js --name slabhq-subscribe
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = await request.json();
      const { email, location, favorites, prefs } = body;

      if (!email || !email.includes('@')) {
        return new Response(JSON.stringify({ error: 'Valid email required' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      // Fetch current subscribers.json from GitHub
      const repo = env.GITHUB_REPO || 'xiaoseanlu/SlabHQ';
      const token = env.GITHUB_TOKEN;

      const fileRes = await fetch(`https://api.github.com/repos/${repo}/contents/subscribers.json`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'SlabHQ-Worker',
        },
      });

      let subscribers = [];
      let sha = null;

      if (fileRes.ok) {
        const fileData = await fileRes.json();
        sha = fileData.sha;
        const content = atob(fileData.content.replace(/\n/g, ''));
        subscribers = JSON.parse(content);
      }

      // Check for duplicate
      if (subscribers.find(s => s.email.toLowerCase() === email.toLowerCase())) {
        // Update existing subscriber's preferences
        subscribers = subscribers.map(s => {
          if (s.email.toLowerCase() === email.toLowerCase()) {
            return { ...s, location, favorites, prefs, updatedAt: new Date().toISOString() };
          }
          return s;
        });
      } else {
        // Add new subscriber
        subscribers.push({
          email,
          location: location || '',
          favorites: favorites || '',
          prefs: prefs || ['powder_8in', 'storm_12in', 'epic_85'],
          subscribedAt: new Date().toISOString(),
        });
      }

      // Commit updated subscribers.json back to GitHub
      const updateRes = await fetch(`https://api.github.com/repos/${repo}/contents/subscribers.json`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'SlabHQ-Worker',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Add subscriber: ${email.replace(/@.*/, '@***')}`,
          content: btoa(JSON.stringify(subscribers, null, 2)),
          sha,
        }),
      });

      if (!updateRes.ok) {
        const err = await updateRes.text();
        console.error('GitHub API error:', err);
        return new Response(JSON.stringify({ error: 'Failed to save subscription' }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      // Send welcome email via Resend (if configured)
      if (env.RESEND_API_KEY) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: env.FROM_EMAIL || 'SlabHQ Alerts <alerts@slabhq.com>',
              to: [email],
              subject: 'Welcome to SlabHQ Powder Alerts',
              html: buildWelcomeEmail(email, location, favorites),
            }),
          });
        } catch (e) {
          console.error('Welcome email failed:', e);
        }
      }

      return new Response(JSON.stringify({ ok: true, message: 'Subscribed successfully' }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: 'Server error' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  },
};

function buildWelcomeEmail(email, location, favorites) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">

    <div style="text-align:center;margin-bottom:32px">
      <div style="font-size:28px;font-weight:800;color:#1a1a2e;letter-spacing:-0.5px">Slab<span style="color:#8b6f47">HQ</span></div>
    </div>

    <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5ddd4;text-align:center">
      <div style="font-size:40px;margin-bottom:16px">&#10052;</div>
      <div style="font-size:22px;font-weight:700;color:#1a1a2e;margin-bottom:8px">Welcome to Powder Alerts</div>
      <div style="font-size:13px;color:#7a8fa8;line-height:1.6;margin-bottom:24px">
        You're all set, <strong style="color:#1a1a2e">${email}</strong>.<br>
        We'll send you alerts when conditions are worth the drive.
      </div>

      <div style="background:#f5f0eb;border-radius:8px;padding:16px;text-align:left;margin-bottom:20px">
        <div style="font-size:10px;color:#7a8fa8;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px">YOUR SETTINGS</div>
        ${location ? `<div style="font-size:12px;color:#1a1a2e;margin-bottom:4px">&#128205; Starting from: <strong>${location}</strong></div>` : ''}
        ${favorites ? `<div style="font-size:12px;color:#1a1a2e;margin-bottom:4px">&#9733; Tracking: <strong>${favorites}</strong></div>` : ''}
        <div style="font-size:12px;color:#1a1a2e">&#128276; Alerts: Powder days, Storm warnings, Epic conditions</div>
      </div>

      <div style="font-size:11px;color:#7a8fa8;line-height:1.8">
        <strong style="color:#1a1a2e">What to expect:</strong><br>
        &#10052; Powder alerts when 8"+ hits your tracked resorts<br>
        &#127786;&#65039; Storm warnings for 12"+ incoming systems<br>
        &#127775; Epic condition alerts when scores hit 85+<br>
        &#128197; Weekly digest every Monday morning
      </div>
    </div>

    <div style="text-align:center;margin-top:24px">
      <a href="https://xiaoseanlu.github.io/SlabHQ/" style="display:inline-block;background:#8b6f47;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Open SlabHQ &rarr;</a>
    </div>

    <div style="text-align:center;font-size:10px;color:#a09890;margin-top:32px;line-height:1.6">
      <a href="https://xiaoseanlu.github.io/SlabHQ/" style="color:#8b6f47;text-decoration:none">SlabHQ</a> &middot; Know before you go.
    </div>

  </div>
</body>
</html>`;
}
