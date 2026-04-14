/**
 * SlabHQ Subscription Worker — Cloudflare Worker
 * Handles email subscription form submissions from the static site.
 * Stores subscribers in Cloudflare KV (private, not in git).
 *
 * Environment bindings:
 *   SUBSCRIBERS      — KV namespace for subscriber data
 *   RESEND_API_KEY   — Resend API key (secret)
 *   SUBSCRIBERS_TOKEN — Auth token for GET /subscribers (secret)
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
  // California
  { id: 'mammoth', lat: 37.6308, lng: -119.0326 },
  { id: 'palisades', lat: 39.1965, lng: -120.2356 },
  { id: 'june', lat: 37.7772, lng: -119.0786 },
  { id: 'sierra', lat: 38.7966, lng: -120.0802 },
  { id: 'bigbear', lat: 34.2154, lng: -116.8909 },
  // Utah
  { id: 'snowbird', lat: 40.5833, lng: -111.6551 },
  { id: 'brighton', lat: 40.5975, lng: -111.5833 },
  { id: 'solitude', lat: 40.6203, lng: -111.5919 },
  { id: 'deervalley', lat: 40.6374, lng: -111.478 },
  { id: 'alta', lat: 40.5884, lng: -111.6386 },
  { id: 'snowbasin', lat: 41.2072, lng: -111.8512 },
  // Wyoming / Montana
  { id: 'jacksonhole', lat: 43.5877, lng: -110.828 },
  { id: 'bigsky', lat: 45.2833, lng: -111.4014 },
  // Colorado
  { id: 'steamboat', lat: 40.4572, lng: -106.8045 },
  { id: 'winterpark', lat: 39.8841, lng: -105.7625 },
  { id: 'copper', lat: 39.5022, lng: -106.1497 },
  { id: 'eldora', lat: 39.9375, lng: -105.5831 },
  { id: 'aspensnowmass', lat: 39.2084, lng: -106.9499 },
  { id: 'abasin', lat: 39.6425, lng: -105.8719 },
  // Idaho / NM / WA / OR
  { id: 'taos', lat: 36.5966, lng: -105.4543 },
  { id: 'sunvalley', lat: 43.6977, lng: -114.3514 },
  { id: 'schweitzer', lat: 48.368, lng: -116.6227 },
  { id: 'crystalmt', lat: 46.9349, lng: -121.5045 },
  { id: 'bachelor', lat: 43.9792, lng: -121.689 },
  { id: 'snoqualmie', lat: 47.424, lng: -121.416 },
  { id: 'alyeska', lat: 60.9705, lng: -149.0982 },
  // East US
  { id: 'killington', lat: 43.6045, lng: -72.8201 },
  { id: 'sugarbush', lat: 44.1358, lng: -72.8954 },
  { id: 'stratton', lat: 43.1134, lng: -72.9079 },
  { id: 'loon', lat: 44.0369, lng: -71.6218 },
  { id: 'sugarloaf', lat: 45.0314, lng: -70.3131 },
  { id: 'sundayriver', lat: 44.47, lng: -70.8547 },
  { id: 'pico', lat: 43.671, lng: -72.8487 },
  { id: 'snowshoe', lat: 38.403, lng: -79.9972 },
  { id: 'bluemtpa', lat: 40.8109, lng: -75.5208 },
  { id: 'camelback', lat: 41.0523, lng: -75.3464 },
  // Midwest
  { id: 'boynemtn', lat: 45.167, lng: -84.924 },
  { id: 'highlands', lat: 45.434, lng: -84.93 },
  { id: 'lutsen', lat: 47.6471, lng: -90.6749 },
  { id: 'granitepe', lat: 44.91, lng: -89.64 },
  { id: 'snowriver', lat: 46.49, lng: -89.97 },
  // Canada
  { id: 'tremblant', lat: 46.2146, lng: -74.5855 },
  { id: 'bluemountain', lat: 44.5018, lng: -80.3161 },
  { id: 'revelstoke', lat: 50.9577, lng: -118.1649 },
  { id: 'sunshine', lat: 51.115, lng: -115.764 },
  { id: 'lakelouise', lat: 51.445, lng: -116.177 },
  { id: 'norquay', lat: 51.203, lng: -115.599 },
  { id: 'cypress', lat: 49.326, lng: -122.804 },
  { id: 'panorama', lat: 50.46, lng: -116.24 },
  { id: 'silverstar', lat: 50.358, lng: -119.064 },
  { id: 'sunpeaks', lat: 50.884, lng: -119.886 },
  { id: 'redmtn', lat: 49.103, lng: -117.826 },
  { id: 'lemassif', lat: 47.283, lng: -70.617 },
  // International
  { id: 'niseko', lat: 42.8625, lng: 140.6988 },
  { id: 'furano', lat: 43.282, lng: 142.473 },
  { id: 'lottearai', lat: 36.93, lng: 138.58 },
  { id: 'chamonix', lat: 45.9237, lng: 6.8694 },
  { id: 'zermatt', lat: 46.0207, lng: 7.7491 },
  { id: 'grandvalira', lat: 42.57, lng: 1.68 },
  { id: 'ischgl', lat: 47.012, lng: 10.291 },
  // Southern hemisphere
  { id: 'vallenevado', lat: -33.3614, lng: -70.2478 },
  { id: 'thredbo', lat: -36.5054, lng: 148.3069 },
  { id: 'coronetpeak', lat: -44.916, lng: 168.74 },
  { id: 'remarkables', lat: -45.053, lng: 168.815 },
  { id: 'mthutt', lat: -43.471, lng: 171.526 },
  { id: 'mtbuller', lat: -37.147, lng: 146.426 },
];

async function fetchYOYData() {
  if (yoyCache.data && (Date.now() - yoyCache.ts) < YOY_CACHE_TTL) return yoyCache.data;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const seasonStartYear = currentMonth >= 11 ? currentYear : currentYear - 1;
  const todayStr = now.toISOString().slice(0, 10);

  // Split resorts into northern and southern hemisphere
  const northern = YOY_RESORTS.filter(r => r.lat >= 0);
  const southern = YOY_RESORTS.filter(r => r.lat < 0);

  const results = {};
  const toInches = (cm) => Math.round(cm * 0.394);
  const sumSnow = (d) => {
    if (!d || !d.daily || !d.daily.snowfall_sum) return 0;
    return d.daily.snowfall_sum.reduce((s, v) => s + (v || 0), 0);
  };

  // Batch resorts into groups of 25 for Open-Meteo API, then merge results
  // Open-Meteo supports comma-separated coordinates, returns array
  async function fetchBatch(resorts, seasonStart, seasonEnd, tz) {
    const CHUNK = 25;
    const chunks = [];
    for (let i = 0; i < resorts.length; i += CHUNK) chunks.push(resorts.slice(i, i + CHUNK));
    const results = [];
    for (const chunk of chunks) {
      const lats = chunk.map(r => r.lat).join(',');
      const lngs = chunk.map(r => r.lng).join(',');
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lngs}&start_date=${seasonStart}&end_date=${seasonEnd}&daily=snowfall_sum&timezone=${tz}`;
      const res = await fetch(url);
      const data = await res.json();
      const arr = Array.isArray(data) ? data : [data];
      results.push(...arr);
    }
    return results;
  }

  try {
    if (northern.length > 0) {
      const thisStart = `${seasonStartYear}-11-01`;
      const lastStart = `${seasonStartYear - 1}-11-01`;
      const lastEnd = `${seasonStartYear}-04-30`;

      // Fetch this season + last season + 3 more (= 5 API calls for ALL northern resorts)
      const [thisData, lastData, y3Data, y4Data, y5Data] = await Promise.all([
        fetchBatch(northern, thisStart, todayStr, 'America/Los_Angeles'),
        fetchBatch(northern, lastStart, lastEnd, 'America/Los_Angeles'),
        fetchBatch(northern, `${seasonStartYear - 2}-11-01`, `${seasonStartYear - 1}-04-30`, 'America/Los_Angeles'),
        fetchBatch(northern, `${seasonStartYear - 3}-11-01`, `${seasonStartYear - 2}-04-30`, 'America/Los_Angeles'),
        fetchBatch(northern, `${seasonStartYear - 4}-11-01`, `${seasonStartYear - 3}-04-30`, 'America/Los_Angeles'),
      ]);

      northern.forEach((resort, i) => {
        const thisCm = sumSnow(thisData[i]);
        const lastCm = sumSnow(lastData[i]);
        const y3Cm = sumSnow(y3Data[i]);
        const y4Cm = sumSnow(y4Data[i]);
        const y5Cm = sumSnow(y5Data[i]);
        const avgCm = (thisCm + lastCm + y3Cm + y4Cm + y5Cm) / 5;
        results[resort.id] = {
          thisYear: toInches(thisCm),
          lastYear: toInches(lastCm),
          avg: Math.round(toInches(avgCm)),
          source: 'Open-Meteo Historical API',
          seasonLabel: `Nov ${seasonStartYear} – Apr ${seasonStartYear + 1}`,
        };
      });
    }

    if (southern.length > 0) {
      const thisStart = `${seasonStartYear}-06-01`;
      const lastStart = `${seasonStartYear - 1}-06-01`;
      const lastEnd = `${seasonStartYear - 1}-10-31`;

      const [thisData, lastData, y3Data] = await Promise.all([
        fetchBatch(southern, thisStart, todayStr, 'auto'),
        fetchBatch(southern, lastStart, lastEnd, 'auto'),
        fetchBatch(southern, `${seasonStartYear - 2}-06-01`, `${seasonStartYear - 2}-10-31`, 'auto'),
      ]);

      southern.forEach((resort, i) => {
        const thisCm = sumSnow(thisData[i]);
        const lastCm = sumSnow(lastData[i]);
        const y3Cm = sumSnow(y3Data[i]);
        const avgCm = (thisCm + lastCm + y3Cm) / 3;
        results[resort.id] = {
          thisYear: toInches(thisCm),
          lastYear: toInches(lastCm),
          avg: Math.round(toInches(avgCm)),
          source: 'Open-Meteo Historical API',
          seasonLabel: `Jun ${seasonStartYear} – Oct ${seasonStartYear}`,
        };
      });
    }
  } catch (e) {
    console.error('YOY fetch error:', e);
    // Return partial results
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

    // GET /subscribers — authenticated endpoint for alert script
    if (request.method === 'GET' && (url.pathname === '/subscribers' || url.pathname === '/subscribers/')) {
      const auth = request.headers.get('Authorization');
      if (!env.SUBSCRIBERS_TOKEN || auth !== `Bearer ${env.SUBSCRIBERS_TOKEN}`) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
      try {
        const data = await env.SUBSCRIBERS.get('subscribers', 'json');
        return new Response(JSON.stringify({ ok: true, subscribers: data || [] }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to read subscribers' }), {
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

      // Read current subscribers from KV
      let subscribers = (await env.SUBSCRIBERS.get('subscribers', 'json')) || [];

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

      // Save to KV
      await env.SUBSCRIBERS.put('subscribers', JSON.stringify(subscribers));

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
