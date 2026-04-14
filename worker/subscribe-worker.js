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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ROAD_ROUTES = ['80', '50', '89', '88', '395', '203', '108', '120', '20', '267', '158', '207', '18', '38', '330'];
const ROAD_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let roadCache = { data: null, ts: 0 };

// ── YOY SEASONAL SNOWFALL (from Open-Meteo Historical API) ──
const YOY_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours (historical data changes slowly)
let yoyCache = { data: null, ts: 0 };

const YOY_RESORTS = [
  { id: 'mammoth', lat: 37.6308, lng: -119.0326 },
  { id: 'palisades', lat: 39.1965, lng: -120.2356 },
  { id: 'june', lat: 37.7772, lng: -119.0786 },
  { id: 'kirkwood', lat: 38.6847, lng: -120.0652 },
  { id: 'heavenly', lat: 38.9333, lng: -119.9397 },
  { id: 'northstar', lat: 39.2746, lng: -120.1211 },
  { id: 'sierra', lat: 38.7988, lng: -120.0805 },
  { id: 'bigbear', lat: 34.2274, lng: -116.8603 },
  { id: 'steamboat', lat: 40.4572, lng: -106.8045 },
  { id: 'aspen', lat: 39.1869, lng: -106.8131 },
  { id: 'jackson', lat: 43.5877, lng: -110.8279 },
  { id: 'deervalley', lat: 40.6375, lng: -111.4783 },
  { id: 'snowbird', lat: 40.5830, lng: -111.6538 },
  { id: 'brighton', lat: 40.5980, lng: -111.5831 },
  { id: 'solitude', lat: 40.6199, lng: -111.5919 },
  { id: 'alta', lat: 40.5884, lng: -111.6387 },
  { id: 'winterpark', lat: 39.8841, lng: -105.7627 },
  { id: 'copper', lat: 39.4804, lng: -106.1511 },
  { id: 'telluride', lat: 37.9375, lng: -107.8123 },
  { id: 'taos', lat: 36.5964, lng: -105.4542 },
  { id: 'tremblant', lat: 46.2147, lng: -74.5856 },
  { id: 'revelstoke', lat: 51.0275, lng: -118.1614 },
  { id: 'niseko', lat: 42.8625, lng: 140.6989 },
  { id: 'chamonix', lat: 45.9237, lng: 6.8694 },
  { id: 'zermatt', lat: 46.0207, lng: 7.7491 },
  { id: 'vallenevado', lat: -33.3568, lng: -70.2472 },
  { id: 'thredbo', lat: -36.5053, lng: 148.3066 },
];

async function fetchYOYData() {
  if (yoyCache.data && (Date.now() - yoyCache.ts) < YOY_CACHE_TTL) return yoyCache.data;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  // Season starts Nov — if before Nov, current season started last year
  const seasonStartYear = currentMonth >= 11 ? currentYear : currentYear - 1;
  const todayStr = now.toISOString().slice(0, 10);

  const results = {};

  // Fetch in parallel batches of 5 to avoid rate limits
  for (let i = 0; i < YOY_RESORTS.length; i += 5) {
    const batch = YOY_RESORTS.slice(i, i + 5);
    const promises = batch.map(async (resort) => {
      try {
        // Southern hemisphere resorts have reversed seasons (Jun-Oct)
        const isSouthern = resort.lat < 0;
        const seasonStart = isSouthern ? `${seasonStartYear}-06-01` : `${seasonStartYear}-11-01`;
        const seasonEnd = todayStr;
        const lastStart = isSouthern ? `${seasonStartYear - 1}-06-01` : `${seasonStartYear - 1}-11-01`;
        const lastEnd = isSouthern ? `${seasonStartYear - 1}-10-31` : `${seasonStartYear}-04-30`;
        const tz = isSouthern ? 'auto' : 'America/Los_Angeles';

        // Fetch this season + last season in parallel
        const [thisRes, lastRes] = await Promise.all([
          fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${resort.lat}&longitude=${resort.lng}&start_date=${seasonStart}&end_date=${seasonEnd}&daily=snowfall_sum&timezone=${tz}`),
          fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${resort.lat}&longitude=${resort.lng}&start_date=${lastStart}&end_date=${lastEnd}&daily=snowfall_sum&timezone=${tz}`),
        ]);

        const [thisData, lastData] = await Promise.all([thisRes.json(), lastRes.json()]);

        const sumSnow = (d) => {
          if (!d.daily || !d.daily.snowfall_sum) return 0;
          return d.daily.snowfall_sum.reduce((s, v) => s + (v || 0), 0);
        };

        const thisSeasonCm = sumSnow(thisData);
        const lastSeasonCm = sumSnow(lastData);

        // Compute 5-year average (fetch just totals for 3 more seasons)
        let totalFiveYear = thisSeasonCm + lastSeasonCm;
        let seasonCount = 2;
        for (let y = 2; y < 5; y++) {
          try {
            const yStart = isSouthern ? `${seasonStartYear - y}-06-01` : `${seasonStartYear - y}-11-01`;
            const yEnd = isSouthern ? `${seasonStartYear - y}-10-31` : `${seasonStartYear - y + 1}-04-30`;
            const yRes = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${resort.lat}&longitude=${resort.lng}&start_date=${yStart}&end_date=${yEnd}&daily=snowfall_sum&timezone=${tz}`);
            const yData = await yRes.json();
            totalFiveYear += sumSnow(yData);
            seasonCount++;
          } catch (e) { /* skip failed seasons */ }
        }

        const toInches = (cm) => Math.round(cm * 0.394);
        results[resort.id] = {
          thisYear: toInches(thisSeasonCm),
          lastYear: toInches(lastSeasonCm),
          avg: Math.round(toInches(totalFiveYear / seasonCount)),
          source: 'Open-Meteo Historical API',
          seasonLabel: isSouthern ? `Jun ${seasonStartYear} – Oct ${seasonStartYear}` : `Nov ${seasonStartYear} – Apr ${seasonStartYear + 1}`,
        };
      } catch (e) {
        results[resort.id] = { error: 'Failed to fetch', detail: e.message };
      }
    });
    await Promise.all(promises);
  }

  yoyCache = { data: results, ts: Date.now() };
  return results;
}

async function fetchRoadConditions() {
  if (roadCache.data && (Date.now() - roadCache.ts) < ROAD_CACHE_TTL) return roadCache.data;

  const conditions = {};
  for (const num of ROAD_ROUTES) {
    try {
      const url = `https://roads.dot.ca.gov/roadscell.php?roadnumber=${num}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'SlabHQ-Worker' } });
      const html = await res.text();
      const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const routeName = num === '80' ? 'I-80' : num === '50' ? 'US-50' : num === '395' ? 'US-395' : `SR-${num}`;

      let status = 'clear';
      let detail = 'No restrictions reported';

      if (/\bclosed\b/i.test(text)) {
        status = 'closed';
        // Match "closed from X to Y" or "closed at X" patterns, allow digits/decimals in road segments
        const m = text.match(/\bclosed\b[^.!]{0,300}[.!]/i) || text.match(/\bclosed\b.{0,200}/i);
        detail = m ? m[0].replace(/\s+/g, ' ').trim() : 'Road closed';
        if (detail.length < 10) detail = 'Road closed — check Caltrans for details';
      } else if (/chain control|chains? (are |or snow tires )?required|chains? (are )?mandatory|R-[123]/i.test(text)) {
        status = 'chains';
        const m = text.match(/(chains?[^.]{0,200}\.)/i);
        detail = m ? m[0].trim() : 'Chain controls in effect';
        if (/R-3|chains required on all/i.test(text)) status = 'chains_r3';
        else if (/R-2|chains.*except.*4.?wheel/i.test(text)) status = 'chains_r2';
        else if (/R-1|chains.*or.*snow tires/i.test(text)) status = 'chains_r1';
      } else if (/wind|advisory/i.test(text)) {
        status = 'advisory';
        const m = text.match(/(wind[^.]{0,150}\.|advisory[^.]{0,150}\.)/i);
        detail = m ? m[0].trim() : 'Weather advisory in effect';
      } else if (/no traffic restrictions/i.test(text)) {
        status = 'clear';
        detail = 'No traffic restrictions are reported';
      }

      conditions[num] = { route: routeName, status, detail: detail.slice(0, 300) };
    } catch (e) {
      conditions[num] = { route: `Route ${num}`, status: 'unknown', detail: 'Unable to fetch' };
    }
  }

  roadCache = { data: conditions, ts: Date.now() };
  return conditions;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // GET /roads — live road conditions from Caltrans
    if (request.method === 'GET' && (url.pathname === '/roads' || url.pathname === '/roads/')) {
      try {
        const conditions = await fetchRoadConditions();
        return new Response(JSON.stringify({ ok: true, conditions, updatedAt: new Date().toISOString() }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: 'Failed to fetch road conditions' }), {
          status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
    }

    // GET /yoy — seasonal snowfall year-over-year from Open-Meteo Historical API
    if (request.method === 'GET' && (url.pathname === '/yoy' || url.pathname === '/yoy/')) {
      try {
        const data = await fetchYOYData();
        return new Response(JSON.stringify({ ok: true, data, updatedAt: new Date().toISOString(), source: 'Open-Meteo Historical Weather API' }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: 'Failed to fetch YOY data' }), {
          status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
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
