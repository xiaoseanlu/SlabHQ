/**
 * SlabHQ Daily Snow Alert
 * Runs via GitHub Actions cron — checks Open-Meteo for snow conditions,
 * sends email alerts to subscribers via Resend when thresholds are met.
 */

const fs = require('fs');
const path = require('path');

// ── CONFIGURATION ──
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'SlabHQ Alerts <alerts@slabhq.com>';
const SITE_URL = 'https://xiaoseanlu.github.io/SlabHQ/';

// Alert thresholds
const THRESHOLDS = {
  powder_8in: 8,     // 8"+ fresh snow in 24h
  storm_12in: 12,    // 12"+ total storm snowfall
  epic_85: 85,       // Score >= 85
};

// Resort data (matching index.html RESORTS)
const RESORTS = [
  { id: 'palisades', name: 'Palisades Tahoe', lat: 39.1968, lng: -120.2354, status: 'GOOD' },
  { id: 'mammoth', name: 'Mammoth Mountain', lat: 37.6308, lng: -119.0326, status: 'GOOD' },
  { id: 'kirkwood', name: 'Kirkwood', lat: 38.6850, lng: -120.0654, status: 'GOOD' },
  { id: 'heavenly', name: 'Heavenly', lat: 38.9353, lng: -119.9400, status: 'GOOD' },
  { id: 'northstar', name: 'Northstar', lat: 39.2746, lng: -120.1210, status: 'GOOD' },
  { id: 'bigbear', name: 'Big Bear', lat: 34.2369, lng: -116.8600, status: 'LIMITED' },
  { id: 'mtbachelor', name: 'Mt. Bachelor', lat: 43.9792, lng: -121.6886, status: 'GOOD' },
  { id: 'crystalmt', name: 'Crystal Mountain', lat: 46.9282, lng: -121.5045, status: 'GOOD' },
  { id: 'mthood', name: 'Mt. Hood Meadows', lat: 45.3311, lng: -121.6649, status: 'GOOD' },
  { id: 'stevens', name: 'Stevens Pass', lat: 47.7448, lng: -121.0890, status: 'GOOD' },
  { id: 'snowbird', name: 'Snowbird', lat: 40.5830, lng: -111.6508, status: 'GOOD' },
  { id: 'parkcity', name: 'Park City', lat: 40.6514, lng: -111.5080, status: 'LIMITED' },
  { id: 'brighton', name: 'Brighton', lat: 40.5980, lng: -111.5832, status: 'GOOD' },
  { id: 'jackson', name: 'Jackson Hole', lat: 43.5877, lng: -110.8279, status: 'GOOD' },
  { id: 'sunvalley', name: 'Sun Valley', lat: 43.6975, lng: -114.3514, status: 'LIMITED' },
  { id: 'steamboat', name: 'Steamboat', lat: 40.4572, lng: -106.8045, status: 'LIMITED' },
  { id: 'vail', name: 'Vail', lat: 39.6061, lng: -106.3550, status: 'LIMITED' },
  { id: 'aspen', name: 'Aspen Snowmass', lat: 39.2084, lng: -106.9490, status: 'LIMITED' },
  { id: 'telluride', name: 'Telluride', lat: 37.9375, lng: -107.8123, status: 'LIMITED' },
  { id: 'revelstoke', name: 'Revelstoke', lat: 51.0045, lng: -118.1610, status: 'GOOD' },
  { id: 'whistler', name: 'Whistler Blackcomb', lat: 50.1163, lng: -122.9574, status: 'GOOD' },
  { id: 'bigskymt', name: 'Big Sky', lat: 45.2833, lng: -111.4014, status: 'LIMITED' },
];

// ── OPEN-METEO API ──
async function fetchWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,windspeed_10m,snowfall,weathercode&daily=temperature_2m_max,temperature_2m_min,windspeed_10m_max,snowfall_sum,weathercode&timezone=auto&forecast_days=7&temperature_unit=fahrenheit&windspeed_unit=mph`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather API failed: ${res.status}`);
  return res.json();
}

// ── SCORING ──
function scoreResort(weather) {
  const daily = weather.daily;
  if (!daily || !daily.snowfall_sum) return 0;

  const todaySnow = daily.snowfall_sum[0] || 0;
  const tomorrowSnow = daily.snowfall_sum[1] || 0;
  const weekSnow = daily.snowfall_sum.reduce((a, b) => a + b, 0);
  const todayWind = daily.windspeed_10m_max[0] || 0;
  const todayHigh = daily.temperature_2m_max[0] || 32;

  // Snow score (0-40)
  const fresh = Math.max(todaySnow, tomorrowSnow);
  const snowScore = Math.min(fresh * 4, 40);

  // Weather score (0-20) — cold + low wind = good
  const tempScore = todayHigh <= 28 ? 10 : todayHigh <= 35 ? 7 : todayHigh <= 42 ? 4 : 2;
  const windScore = todayWind <= 10 ? 10 : todayWind <= 20 ? 7 : todayWind <= 35 ? 4 : 1;
  const weatherScore = Math.round((tempScore + windScore) / 2 * 2);

  // Week outlook bonus (0-15)
  const weekBonus = Math.min(weekSnow * 1.5, 15);

  // Visibility (0-10) — assume clear if no snow today
  const visScore = todaySnow > 5 ? 3 : todaySnow > 0 ? 6 : 10;

  return Math.round(Math.min(snowScore + weatherScore + weekBonus + visScore, 100));
}

// ── EMAIL TEMPLATE ──
function buildAlertEmail(subscriber, resortAlerts, allConditions) {
  const topResorts = allConditions
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const alertReasons = [];
  resortAlerts.forEach(a => {
    if (a.reasons.includes('powder')) alertReasons.push(`${a.name}: ${a.fresh24h}" fresh powder`);
    if (a.reasons.includes('storm')) alertReasons.push(`${a.name}: ${a.weekSnow}" storm total this week`);
    if (a.reasons.includes('epic')) alertReasons.push(`${a.name}: Score ${a.score} (epic conditions)`);
  });

  const headline = resortAlerts.length === 1
    ? `${resortAlerts[0].fresh24h}" hitting ${resortAlerts[0].name}`
    : `Powder alert across ${resortAlerts.length} resorts`;

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">

    <!-- HEADER -->
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:24px;font-weight:800;color:#1a1a2e;letter-spacing:-0.5px">Slab<span style="color:#8b6f47">HQ</span></div>
      <div style="font-size:11px;color:#7a8fa8;letter-spacing:2px;text-transform:uppercase;margin-top:2px">POWDER ALERT</div>
    </div>

    <!-- HEADLINE CARD -->
    <div style="background:#1a1a2e;border-radius:12px;padding:24px;margin-bottom:16px;color:#fff">
      <div style="font-size:10px;color:#7a8fa8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">${today}</div>
      <div style="font-size:22px;font-weight:700;line-height:1.3;margin-bottom:12px">${headline}</div>
      <div style="font-size:13px;color:#d8e6f2;line-height:1.6">
        ${alertReasons.map(r => `<div style="margin-bottom:4px">&#10052; ${r}</div>`).join('')}
      </div>
    </div>

    <!-- TOP RESORTS TABLE -->
    <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #e5ddd4">
      <div style="font-size:10px;color:#7a8fa8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:14px">TOP CONDITIONS TODAY</div>
      ${topResorts.map((r, i) => `
        <div style="display:flex;align-items:center;padding:10px 0;${i < topResorts.length - 1 ? 'border-bottom:1px solid #f0ebe5;' : ''}">
          <div style="flex:1">
            <div style="font-size:14px;font-weight:600;color:#1a1a2e">${r.name}</div>
            <div style="font-size:11px;color:#7a8fa8;margin-top:2px">${r.fresh24h}" fresh &middot; ${r.weekSnow}" this week</div>
          </div>
          <div style="font-size:20px;font-weight:700;color:${r.score >= 80 ? '#42c97a' : r.score >= 65 ? '#5bc4e0' : '#e0960a'};min-width:36px;text-align:right">${r.score}</div>
        </div>
      `).join('')}
    </div>

    <!-- 7-DAY SNOWFALL OUTLOOK -->
    <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #e5ddd4">
      <div style="font-size:10px;color:#7a8fa8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:14px">7-DAY SNOWFALL OUTLOOK</div>
      ${topResorts.slice(0, 3).map(r => `
        <div style="margin-bottom:12px">
          <div style="font-size:12px;font-weight:600;color:#1a1a2e;margin-bottom:6px">${r.name}</div>
          <div style="display:flex;gap:3px">
            ${r.dailySnow.map((s, i) => {
              const dayName = new Date(Date.now() + i * 86400000).toLocaleDateString('en-US', { weekday: 'short' });
              const pct = Math.min(s / 8 * 100, 100);
              const bg = s >= 6 ? '#5bc4e0' : s >= 2 ? '#6ab5c4' : s > 0 ? '#a8c4cc' : '#e5e0db';
              return `<div style="flex:1;text-align:center">
                <div style="height:40px;background:#f5f0eb;border-radius:4px;position:relative;overflow:hidden">
                  <div style="position:absolute;bottom:0;width:100%;height:${Math.max(pct, 5)}%;background:${bg};border-radius:4px"></div>
                </div>
                <div style="font-size:9px;color:#1a1a2e;font-weight:600;margin-top:3px">${s > 0 ? s + '"' : '-'}</div>
                <div style="font-size:8px;color:#7a8fa8">${dayName}</div>
              </div>`;
            }).join('')}
          </div>
        </div>
      `).join('')}
    </div>

    ${subscriber.favorites && subscriber.favorites.length ? `
    <!-- YOUR TRACKED RESORTS -->
    <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #e5ddd4">
      <div style="font-size:10px;color:#7a8fa8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:14px">YOUR TRACKED RESORTS</div>
      ${subscriber.favorites.map(fav => {
        const data = allConditions.find(c => c.id === fav);
        if (!data) return '';
        return `<div style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #f0ebe5">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:#1a1a2e">${data.name}</div>
            <div style="font-size:11px;color:#7a8fa8">${data.fresh24h}" fresh &middot; Wind ${data.wind}mph</div>
          </div>
          <div style="font-size:10px;font-weight:600;padding:4px 10px;border-radius:6px;background:${data.score >= 80 ? '#e8f8f0' : data.score >= 65 ? '#e8f4f8' : '#fef4e0'};color:${data.score >= 80 ? '#42c97a' : data.score >= 65 ? '#5bc4e0' : '#e0960a'}">${data.score >= 80 ? 'GO' : data.score >= 65 ? 'GOOD' : 'OK'}</div>
        </div>`;
      }).filter(Boolean).join('')}
    </div>` : ''}

    <!-- CTA -->
    <div style="text-align:center;margin:24px 0">
      <a href="${SITE_URL}" style="display:inline-block;background:#8b6f47;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.5px">Open SlabHQ &rarr;</a>
    </div>

    <!-- FOOTER -->
    <div style="text-align:center;font-size:10px;color:#a09890;line-height:1.8;margin-top:32px;padding-top:16px;border-top:1px solid #e5ddd4">
      <div>You're receiving this because you subscribed to SlabHQ Powder Alerts.</div>
      <div>Location: ${subscriber.location || 'Not set'} &middot; Alerts: ${(subscriber.prefs || []).join(', ') || 'All'}</div>
      <div style="margin-top:8px"><a href="${SITE_URL}" style="color:#8b6f47;text-decoration:none">SlabHQ</a> &middot; Know before you go.</div>
    </div>

  </div>
</body>
</html>`;
}

function buildWeeklyDigestEmail(subscriber, allConditions) {
  const topResorts = allConditions
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const bestResort = topResorts[0];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">

    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:24px;font-weight:800;color:#1a1a2e;letter-spacing:-0.5px">Slab<span style="color:#8b6f47">HQ</span></div>
      <div style="font-size:11px;color:#7a8fa8;letter-spacing:2px;text-transform:uppercase;margin-top:2px">WEEKLY DIGEST</div>
    </div>

    <div style="background:#1a1a2e;border-radius:12px;padding:24px;margin-bottom:16px;color:#fff">
      <div style="font-size:10px;color:#7a8fa8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">${today}</div>
      <div style="font-size:20px;font-weight:700;line-height:1.3;margin-bottom:8px">This Week in Snow</div>
      <div style="font-size:13px;color:#d8e6f2;line-height:1.6">
        Best conditions: <strong>${bestResort.name}</strong> with ${bestResort.fresh24h}" fresh and a score of ${bestResort.score}.
        ${bestResort.weekSnow > 10 ? `Storm total of ${bestResort.weekSnow}" expected this week.` : ''}
      </div>
    </div>

    <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #e5ddd4">
      <div style="font-size:10px;color:#7a8fa8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:14px">RESORT RANKINGS</div>
      ${topResorts.map((r, i) => `
        <div style="display:flex;align-items:center;padding:8px 0;${i < topResorts.length - 1 ? 'border-bottom:1px solid #f0ebe5;' : ''}">
          <div style="width:24px;font-size:12px;font-weight:700;color:#a09890">${i + 1}</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:#1a1a2e">${r.name}</div>
            <div style="font-size:11px;color:#7a8fa8">${r.fresh24h}" fresh &middot; ${r.weekSnow}" week &middot; Wind ${r.wind}mph</div>
          </div>
          <div style="font-size:18px;font-weight:700;color:${r.score >= 80 ? '#42c97a' : r.score >= 65 ? '#5bc4e0' : '#e0960a'}">${r.score}</div>
        </div>
      `).join('')}
    </div>

    <div style="text-align:center;margin:24px 0">
      <a href="${SITE_URL}" style="display:inline-block;background:#8b6f47;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">View Full Details &rarr;</a>
    </div>

    <div style="text-align:center;font-size:10px;color:#a09890;line-height:1.8;margin-top:32px;padding-top:16px;border-top:1px solid #e5ddd4">
      <div>You're receiving this because you subscribed to SlabHQ Weekly Digest.</div>
      <div style="margin-top:8px"><a href="${SITE_URL}" style="color:#8b6f47;text-decoration:none">SlabHQ</a> &middot; Know before you go.</div>
    </div>

  </div>
</body>
</html>`;
}

// ── RESEND API ──
async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.log(`[DRY RUN] Would send to ${to}: ${subject}`);
    return true;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Failed to send to ${to}: ${err}`);
    return false;
  }

  console.log(`Sent to ${to}: ${subject}`);
  return true;
}

// ── MAIN ──
async function main() {
  console.log('=== SlabHQ Snow Alert Check ===');
  console.log(`Time: ${new Date().toISOString()}`);

  // Load subscribers
  const subsPath = path.join(__dirname, '..', 'subscribers.json');
  let subscribers = [];
  try {
    subscribers = JSON.parse(fs.readFileSync(subsPath, 'utf8'));
  } catch (e) {
    console.log('No subscribers file found or empty.');
    return;
  }

  if (subscribers.length === 0) {
    console.log('No subscribers. Exiting.');
    return;
  }

  console.log(`Found ${subscribers.length} subscriber(s).`);

  // Fetch weather for all non-closed resorts
  const openResorts = RESORTS.filter(r => r.status !== 'CLOSED');
  console.log(`Fetching weather for ${openResorts.length} resorts...`);

  const allConditions = [];
  for (const resort of openResorts) {
    try {
      const weather = await fetchWeather(resort.lat, resort.lng);
      const daily = weather.daily;
      const score = scoreResort(weather);
      const fresh24h = Math.round((daily.snowfall_sum[0] || 0) * 10) / 10;
      const weekSnow = Math.round(daily.snowfall_sum.reduce((a, b) => a + b, 0) * 10) / 10;
      const wind = Math.round(daily.windspeed_10m_max[0] || 0);
      const high = Math.round(daily.temperature_2m_max[0] || 0);
      const low = Math.round(daily.temperature_2m_min[0] || 0);
      const dailySnow = daily.snowfall_sum.map(s => Math.round(s * 10) / 10);

      allConditions.push({
        id: resort.id,
        name: resort.name,
        score,
        fresh24h,
        weekSnow,
        wind,
        high,
        low,
        dailySnow,
      });

      console.log(`  ${resort.name}: ${fresh24h}" fresh, ${weekSnow}" week, score ${score}`);
    } catch (e) {
      console.warn(`  Failed to fetch ${resort.name}: ${e.message}`);
    }

    // Rate limit: slight delay between API calls
    await new Promise(r => setTimeout(r, 200));
  }

  if (allConditions.length === 0) {
    console.log('No weather data retrieved. Exiting.');
    return;
  }

  // Determine which day it is (for weekly digest — send on Mondays)
  const isMonday = new Date().getDay() === 1;

  // Process each subscriber
  let sentCount = 0;
  for (const sub of subscribers) {
    const prefs = sub.prefs || ['powder_8in', 'storm_12in', 'epic_85'];
    const favIds = (sub.favorites || '').split(',').map(s => s.trim()).filter(Boolean);

    // Check which resorts trigger alerts for this subscriber
    const resortAlerts = [];
    for (const cond of allConditions) {
      const reasons = [];
      // Only check resorts they care about (favorites, or all if no favorites)
      const isRelevant = favIds.length === 0 || favIds.includes(cond.id);
      if (!isRelevant) continue;

      if (prefs.includes('powder_8in') && cond.fresh24h >= THRESHOLDS.powder_8in) {
        reasons.push('powder');
      }
      if (prefs.includes('storm_12in') && cond.weekSnow >= THRESHOLDS.storm_12in) {
        reasons.push('storm');
      }
      if (prefs.includes('epic_85') && cond.score >= THRESHOLDS.epic_85) {
        reasons.push('epic');
      }

      if (reasons.length > 0) {
        resortAlerts.push({ ...cond, reasons });
      }
    }

    // Send powder/storm/epic alert if triggered
    if (resortAlerts.length > 0) {
      const topAlert = resortAlerts.sort((a, b) => b.score - a.score)[0];
      const subject = `Powder Alert: ${topAlert.fresh24h}" hitting ${topAlert.name}`;
      const html = buildAlertEmail({ ...sub, favorites: favIds }, resortAlerts, allConditions);
      const sent = await sendEmail(sub.email, subject, html);
      if (sent) sentCount++;
    }
    // Send weekly digest on Mondays if subscribed
    else if (isMonday && prefs.includes('weekly_digest')) {
      const best = allConditions.sort((a, b) => b.score - a.score)[0];
      const subject = `Weekly Snow Digest: ${best.name} leads with score ${best.score}`;
      const html = buildWeeklyDigestEmail(sub, allConditions);
      const sent = await sendEmail(sub.email, subject, html);
      if (sent) sentCount++;
    } else {
      console.log(`  No alert triggered for ${sub.email}`);
    }

    // Rate limit between sends
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\nDone. Sent ${sentCount} email(s) to ${subscribers.length} subscriber(s).`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
