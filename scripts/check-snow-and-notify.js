/**
 * SlabHQ Smart Snow Alert
 * Runs via GitHub Actions cron at 6am PST daily.
 *
 * ALERT TYPES (by day-of-week):
 *   Thu/Fri: "Weekend Forecast" — 4"+ expected Sat-Sun, gives 1-2 days to plan
 *   Any day: "Powder Tomorrow" — 6"+ forecast for tomorrow, urgent "leave tonight"
 *   Mon/Tue: "Week Ahead" — 10"+ in next 7 days, plan your week
 *   Wed:     "Extended Outlook" — 15"+ in days 8-16, early heads-up for PTO
 *   Mon:     "Weekly Digest" — opt-in summary of all conditions
 *   Any day: "Bluebird Alert" — 6"+ fell yesterday + clear skies tomorrow
 *   Any day: "Mega Dump" — 12"+ in a single day (too good to miss, any day)
 *
 * PRIORITY: Mega Dump > Powder Tomorrow > Bluebird > Weekend Forecast > Week Ahead > Extended Outlook > Weekly Digest
 * Only ONE alert per subscriber per day (highest priority wins)
 */


const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'SlabHQ Alerts <alerts@slabhq.com>';
const SITE_URL = 'https://xiaoseanlu.github.io/SlabHQ/';

// Resort data (matching index.html RESORTS)
const RESORTS = [
  { id: 'palisades', name: 'Palisades Tahoe', lat: 39.1968, lng: -120.2354, status: 'GOOD', routes: ['80', '89', '20', '267'] },
  { id: 'mammoth', name: 'Mammoth Mountain', lat: 37.6308, lng: -119.0326, status: 'GOOD', routes: ['395', '203', '120'] },
  { id: 'kirkwood', name: 'Kirkwood', lat: 38.6850, lng: -120.0654, status: 'GOOD', routes: ['88', '50'] },
  { id: 'heavenly', name: 'Heavenly', lat: 38.9353, lng: -119.9400, status: 'GOOD', routes: ['50', '89', '207'] },
  { id: 'northstar', name: 'Northstar', lat: 39.2746, lng: -120.1210, status: 'GOOD', routes: ['80', '89', '267', '20'] },
  { id: 'bigbear', name: 'Big Bear', lat: 34.2369, lng: -116.8600, status: 'LIMITED', routes: ['18', '38', '330'] },
  { id: 'mtbachelor', name: 'Mt. Bachelor', lat: 43.9792, lng: -121.6886, status: 'GOOD', routes: [] },
  { id: 'crystalmt', name: 'Crystal Mountain', lat: 46.9282, lng: -121.5045, status: 'GOOD', routes: [] },
  { id: 'mthood', name: 'Mt. Hood Meadows', lat: 45.3311, lng: -121.6649, status: 'GOOD', routes: [] },
  { id: 'stevens', name: 'Stevens Pass', lat: 47.7448, lng: -121.0890, status: 'GOOD', routes: [] },
  { id: 'snowbird', name: 'Snowbird', lat: 40.5830, lng: -111.6508, status: 'GOOD', routes: [] },
  { id: 'parkcity', name: 'Park City', lat: 40.6514, lng: -111.5080, status: 'LIMITED', routes: [] },
  { id: 'brighton', name: 'Brighton', lat: 40.5980, lng: -111.5832, status: 'GOOD', routes: [] },
  { id: 'jackson', name: 'Jackson Hole', lat: 43.5877, lng: -110.8279, status: 'GOOD', routes: [] },
  { id: 'sunvalley', name: 'Sun Valley', lat: 43.6975, lng: -114.3514, status: 'LIMITED', routes: [] },
  { id: 'steamboat', name: 'Steamboat', lat: 40.4572, lng: -106.8045, status: 'LIMITED', routes: [] },
  { id: 'vail', name: 'Vail', lat: 39.6061, lng: -106.3550, status: 'LIMITED', routes: [] },
  { id: 'aspen', name: 'Aspen Snowmass', lat: 39.2084, lng: -106.9490, status: 'LIMITED', routes: [] },
  { id: 'telluride', name: 'Telluride', lat: 37.9375, lng: -107.8123, status: 'LIMITED', routes: [] },
  { id: 'revelstoke', name: 'Revelstoke', lat: 51.0045, lng: -118.1610, status: 'GOOD', routes: [] },
  { id: 'whistler', name: 'Whistler Blackcomb', lat: 50.1163, lng: -122.9574, status: 'GOOD', routes: [] },
  { id: 'bigskymt', name: 'Big Sky', lat: 45.2833, lng: -111.4014, status: 'LIMITED', routes: [] },
];

// Known origins for drive time estimates
const ORIGINS = {
  'livermore, ca': { lat: 37.6819, lng: -121.7680, name: 'Livermore, CA' },
  'livermore': { lat: 37.6819, lng: -121.7680, name: 'Livermore, CA' },
  'san francisco': { lat: 37.7749, lng: -122.4194, name: 'San Francisco' },
  'sf': { lat: 37.7749, lng: -122.4194, name: 'San Francisco' },
  'sacramento': { lat: 38.5816, lng: -121.4944, name: 'Sacramento' },
  'san jose': { lat: 37.3382, lng: -121.8863, name: 'San Jose' },
  'la': { lat: 33.9425, lng: -118.4081, name: 'Los Angeles' },
  'los angeles': { lat: 33.9425, lng: -118.4081, name: 'Los Angeles' },
  'reno': { lat: 39.5296, lng: -119.8138, name: 'Reno' },
  'salt lake city': { lat: 40.7608, lng: -111.8910, name: 'Salt Lake City' },
  'portland': { lat: 45.5155, lng: -122.6789, name: 'Portland' },
  'seattle': { lat: 47.6062, lng: -122.3321, name: 'Seattle' },
  'denver': { lat: 39.7392, lng: -104.9903, name: 'Denver' },
};

function getOrigin(location) {
  const k = (location || '').toLowerCase().trim();
  if (ORIGINS[k]) return ORIGINS[k];
  const kCity = k.split(',')[0].trim();
  if (ORIGINS[kCity]) return ORIGINS[kCity];
  for (const [key, v] of Object.entries(ORIGINS)) {
    if (key.length >= 4 && k.includes(key)) return v;
  }
  return ORIGINS['san francisco'];
}

function distMiles(a, b) {
  const R = 3959;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

function estimateDrive(origin, resort) {
  const dist = distMiles(origin, resort);
  const driveHours = dist / 45;
  const h = Math.floor(driveHours);
  const m = Math.round((driveHours - h) * 60);
  return { dist, hours: h, mins: m, str: h > 0 ? `${h}h ${m}m` : `${m}m` };
}

// ── OPEN-METEO API (16-day forecast) ──
async function fetchWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,windspeed_10m,snowfall,weathercode&daily=temperature_2m_max,temperature_2m_min,windspeed_10m_max,snowfall_sum,weathercode&timezone=auto&forecast_days=16&temperature_unit=fahrenheit&windspeed_unit=mph`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather API failed: ${res.status}`);
  return res.json();
}

// ── CALTRANS ROAD CONDITIONS ──
async function fetchRoadConditions(routeNumbers) {
  const conditions = {};
  for (const num of routeNumbers) {
    try {
      const url = `https://roads.dot.ca.gov/roadscell.php?roadnumber=${num}`;
      const res = await fetch(url);
      const html = await res.text();
      // Parse road condition text from HTML
      const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const routeName = num === '80' ? 'I-80' : num === '50' ? 'US-50' : num === '395' ? 'US-395' : `SR-${num}`;

      let status = 'clear';
      let detail = 'No restrictions reported';

      if (/closed/i.test(text)) {
        status = 'closed';
        // Extract closure detail
        const closedMatch = text.match(/closed[^.]*\./i);
        detail = closedMatch ? closedMatch[0].trim() : 'Road closed';
      } else if (/chain control|chains? (are |or snow tires )?required|chains? (are )?mandatory|R-[123]/i.test(text)) {
        status = 'chains';
        const chainMatch = text.match(/(chains?[^.]*\.)/i);
        detail = chainMatch ? chainMatch[0].trim() : 'Chain controls in effect';
        // Detect level
        if (/R-3|chains required on all/i.test(text)) detail = 'R3: Chains required on ALL vehicles. ' + detail;
        else if (/R-2|chains.*except.*4.?wheel/i.test(text)) detail = 'R2: Chains required except 4WD w/ snow tires. ' + detail;
        else if (/R-1|chains.*or.*snow tires/i.test(text)) detail = 'R1: Chains or snow tires required. ' + detail;
      } else if (/wind|advisory/i.test(text)) {
        status = 'advisory';
        const advMatch = text.match(/(wind[^.]*\.|advisory[^.]*\.)/i);
        detail = advMatch ? advMatch[0].trim() : 'Weather advisory in effect';
      }

      conditions[num] = { route: routeName, status, detail };
    } catch (e) {
      console.warn(`  Road conditions fetch failed for route ${num}: ${e.message}`);
      conditions[num] = { route: `Route ${num}`, status: 'unknown', detail: 'Unable to fetch conditions' };
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return conditions;
}

// ── SCORING ──
function scoreResort(weather) {
  const daily = weather.daily;
  if (!daily || !daily.snowfall_sum) return 0;
  const todaySnow = daily.snowfall_sum[0] || 0;
  const tomorrowSnow = daily.snowfall_sum[1] || 0;
  const weekSnow = daily.snowfall_sum.slice(0, 7).reduce((a, b) => a + b, 0);
  const todayWind = daily.windspeed_10m_max[0] || 0;
  const todayHigh = daily.temperature_2m_max[0] || 32;
  const fresh = Math.max(todaySnow, tomorrowSnow);
  const snowScore = Math.min(fresh * 4, 40);
  const tempScore = todayHigh <= 28 ? 10 : todayHigh <= 35 ? 7 : todayHigh <= 42 ? 4 : 2;
  const windScore = todayWind <= 10 ? 10 : todayWind <= 20 ? 7 : todayWind <= 35 ? 4 : 1;
  const weatherScore = Math.round((tempScore + windScore) / 2 * 2);
  const weekBonus = Math.min(weekSnow * 1.5, 15);
  const visScore = todaySnow > 5 ? 3 : todaySnow > 0 ? 6 : 10;
  return Math.round(Math.min(snowScore + weatherScore + weekBonus + visScore, 100));
}

// ── DAY ANALYSIS ──
function analyzeDays(weather) {
  const daily = weather.daily;
  const days = [];
  for (let i = 0; i < daily.time.length; i++) {
    const date = new Date(daily.time[i] + 'T12:00:00');
    const dow = date.getDay();
    days.push({
      date: daily.time[i],
      dateObj: date,
      dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
      fullDay: date.toLocaleDateString('en-US', { weekday: 'long' }),
      dateFmt: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      snow: Math.round((daily.snowfall_sum[i] || 0) * 10) / 10,
      wind: Math.round(daily.windspeed_10m_max[i] || 0),
      high: Math.round(daily.temperature_2m_max[i] || 0),
      low: Math.round(daily.temperature_2m_min[i] || 0),
      weatherCode: daily.weathercode[i] || 0,
      isWeekend: dow === 0 || dow === 6,
      isWeekday: dow >= 1 && dow <= 5,
      dayIndex: i,
    });
  }
  return days;
}

function getBestDay(days) {
  let best = days[0];
  let bestVal = -999;
  for (const d of days) {
    const val = d.snow * 3 - d.wind * 0.2;
    if (val > bestVal) { bestVal = val; best = d; }
  }
  return best;
}

function getWeekendSummary(days) {
  const wkend = days.filter(d => d.isWeekend && d.dayIndex < 7);
  if (wkend.length === 0) return { snow: 0, maxWind: 0, days: [] };
  const snow = Math.round(wkend.reduce((s, d) => s + d.snow, 0) * 10) / 10;
  const maxWind = Math.max(...wkend.map(d => d.wind));
  return { snow, maxWind, days: wkend };
}

function isClearDay(d) {
  return d.weatherCode <= 3 && d.wind <= 20;
}

// ── SMART TRIGGER LOGIC ──
function determineAlertType(cond, dow) {
  const days = cond.days;
  const today = days[0];
  const tomorrow = days[1];
  const weekDays = days.slice(0, 7);
  const extendedDays = days.slice(7, 16);

  const weekSnow7 = weekDays.reduce((s, d) => s + d.snow, 0);
  const extendedSnow = extendedDays.reduce((s, d) => s + d.snow, 0);

  const wkend = getWeekendSummary(days);

  // Priority 1: MEGA DUMP — 12"+ in a single day within next 3 days (any day of week)
  for (let i = 0; i <= 2 && i < days.length; i++) {
    if (days[i].snow >= 12) {
      return {
        type: 'mega_dump',
        priority: 100,
        subject: `MEGA DUMP: ${days[i].snow}" hitting ${cond.name} ${i === 0 ? 'today' : i === 1 ? 'tomorrow' : days[i].fullDay}`,
        tag: 'MEGA DUMP',
        tagColor: '#e04040',
        reason: `${days[i].snow}" in a single day — this is a season-defining dump. ${days[i].isWeekday ? 'Call in sick.' : 'Clear your weekend.'}`,
        day: days[i],
      };
    }
  }

  // Priority 2: POWDER TOMORROW — 6"+ forecast for tomorrow (any day)
  // But on Thu/Fri, lower threshold since it's a weekend trip
  const tomorrowThreshold = (dow === 4 || dow === 5) ? 4 : 6;
  if (tomorrow && tomorrow.snow >= tomorrowThreshold) {
    const isWeekendTrip = dow === 4 || dow === 5;
    return {
      type: 'powder_tomorrow',
      priority: 90,
      subject: `Powder Tomorrow: ${tomorrow.snow}" hitting ${cond.name} ${tomorrow.dateFmt}`,
      tag: 'POWDER TOMORROW',
      tagColor: '#42c97a',
      reason: isWeekendTrip
        ? `${tomorrow.snow}" expected ${tomorrow.fullDay} (${tomorrow.dateFmt}). Weekend trip is ON.`
        : `${tomorrow.snow}" forecast for ${tomorrow.fullDay} (${tomorrow.dateFmt}). ${tomorrow.isWeekday ? 'Worth a day off if you can swing it.' : ''}`,
      day: tomorrow,
    };
  }

  // Priority 3: BLUEBIRD — 6"+ fell yesterday (today) + tomorrow clear + low wind
  if (today.snow >= 6 && tomorrow && isClearDay(tomorrow)) {
    return {
      type: 'bluebird',
      priority: 85,
      subject: `Bluebird Alert: ${today.snow}" fresh + clear skies tomorrow at ${cond.name}`,
      tag: 'BLUEBIRD DAY',
      tagColor: '#5bc4e0',
      reason: `${today.snow}" fell today and tomorrow is clear with ${tomorrow.wind}mph winds. Fresh powder + sunshine — the dream.`,
      day: tomorrow,
    };
  }

  // Priority 4: WEEKEND FORECAST — Thu/Fri only, 4"+ on Sat+Sun
  if ((dow === 4 || dow === 5) && wkend.snow >= 4) {
    return {
      type: 'weekend_forecast',
      priority: 75,
      subject: `This Weekend: ${wkend.snow}" expected at ${cond.name}`,
      tag: 'WEEKEND FORECAST',
      tagColor: '#8b6f47',
      reason: `${wkend.snow}" expected Sat-Sun. ${wkend.snow >= 8 ? 'This is a GO weekend.' : 'Solid conditions for a day trip.'}${wkend.maxWind > 25 ? ` Heads up: winds up to ${wkend.maxWind}mph.` : ''}`,
    };
  }

  // Priority 5: WEEK AHEAD — Mon/Tue, 10"+ in next 7 days
  if ((dow === 1 || dow === 2) && weekSnow7 >= 10) {
    const bestDay = getBestDay(weekDays);
    return {
      type: 'week_ahead',
      priority: 60,
      subject: `Week Ahead: ${Math.round(weekSnow7)}" coming to ${cond.name} this week`,
      tag: 'WEEK AHEAD',
      tagColor: '#5bc4e0',
      reason: `${Math.round(weekSnow7)}" total this week. Best day: ${bestDay.fullDay} (${bestDay.dateFmt}) with ${bestDay.snow}". ${bestDay.isWeekend ? 'Weekend looking good.' : 'Weekday powder — plan accordingly.'}`,
      day: bestDay,
    };
  }

  // Priority 6: EXTENDED OUTLOOK — Wed only, 15"+ in days 8-16
  if (dow === 3 && extendedSnow >= 15) {
    const bestExtDay = getBestDay(extendedDays);
    return {
      type: 'extended_outlook',
      priority: 50,
      subject: `Heads Up: ${Math.round(extendedSnow)}" expected at ${cond.name} in ~2 weeks`,
      tag: 'EARLY HEADS UP',
      tagColor: '#7a8fa8',
      reason: `Major storm pattern forming. ${Math.round(extendedSnow)}" forecast for ${cond.name} in the next 2-3 weeks. Best window around ${bestExtDay.dateFmt}. Time to request PTO and book lodging.`,
      day: bestExtDay,
    };
  }

  return null;
}

// ── TRIP RECOMMENDATION (for email body) ──
function tripRecommendation(days, weekendSnow, bestDay) {
  const weekdaySnowDays = days.filter(d => d.isWeekday && d.snow >= 4).slice(0, 7);
  const totalWeekSnow = days.slice(0, 7).reduce((s, d) => s + d.snow, 0);

  if (bestDay.isWeekday && bestDay.snow >= 8 && bestDay.snow > weekendSnow * 2) {
    return { action: 'TAKE THE DAY OFF', color: '#42c97a', reason: `${bestDay.fullDay} (${bestDay.dateFmt}) is the day — ${bestDay.snow}" expected with ${bestDay.wind}mph winds. Weekend will have significantly less snow.` };
  }
  if (weekendSnow >= 6) {
    return { action: 'GO THIS WEEKEND', color: '#42c97a', reason: `${weekendSnow}" expected this weekend. No need to burn PTO.` };
  }
  if (totalWeekSnow >= 12 && weekendSnow >= 2) {
    return { action: 'WEEKEND IS SOLID', color: '#5bc4e0', reason: `Storm dumps ${Math.round(totalWeekSnow)}" this week. Weekend won't have fresh snow but the base will be stacked.` };
  }
  if (weekdaySnowDays.length > 0 && weekendSnow < 2) {
    const best = weekdaySnowDays.sort((a, b) => b.snow - a.snow)[0];
    return { action: 'WEEKDAY WORTH IT', color: '#e0960a', reason: `${best.fullDay} (${best.dateFmt}) gets ${best.snow}" — the weekend looks dry. If you can swing it, ${best.dayName} is the play.` };
  }
  if (weekendSnow > 0) {
    return { action: 'WEEKEND OK', color: '#5bc4e0', reason: `Light snow this weekend (${weekendSnow}"). Decent conditions but not a powder day.` };
  }
  return { action: 'WAIT', color: '#a09890', reason: 'No significant snow in the 7-day forecast. Check back next week.' };
}

// ── EMAIL TEMPLATES ──
function buildAlertEmail(subscriber, alert, resortAlerts, allConditions, roadConditions) {
  const origin = getOrigin(subscriber.location);
  const favIds = subscriber.favorites || [];

  // Sort: favorites first, then by score
  const sorted = [...allConditions].sort((a, b) => {
    const aFav = favIds.includes(a.id) ? 1 : 0;
    const bFav = favIds.includes(b.id) ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;
    return b.score - a.score;
  });
  const topResorts = sorted.slice(0, 6);

  const primaryResort = resortAlerts.sort((a, b) => b.score - a.score)[0];
  const primaryDays = primaryResort.days.slice(0, 7);
  const bestDay = getBestDay(primaryDays);
  const wkend = getWeekendSummary(primaryResort.days);
  const rec = tripRecommendation(primaryDays, wkend.snow, bestDay);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // Road conditions for primary resort
  const primaryResortData = RESORTS.find(r => r.id === primaryResort.id);
  const roadHtml = (primaryResortData && primaryResortData.routes.length > 0) ? primaryResortData.routes.map(num => {
    const rc = roadConditions[num];
    if (!rc) return '';
    const statusColor = rc.status === 'closed' ? '#e04040' : rc.status === 'chains' ? '#e0960a' : rc.status === 'advisory' ? '#d4a03a' : '#42c97a';
    const statusLabel = rc.status === 'closed' ? 'CLOSED' : rc.status === 'chains' ? 'CHAINS' : rc.status === 'advisory' ? 'ADVISORY' : 'CLEAR';
    return `<div style="display:flex;align-items:center;padding:6px 0;border-bottom:1px solid #f0ebe5">
      <div style="font-size:12px;font-weight:600;color:#1a1a2e;width:60px">${rc.route}</div>
      <div style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;background:${statusColor};color:#fff;margin-right:8px">${statusLabel}</div>
      <div style="flex:1;font-size:11px;color:#7a8fa8;line-height:1.3">${rc.detail}</div>
    </div>`;
  }).filter(Boolean).join('') : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">

    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:24px;font-weight:800;color:#1a1a2e;letter-spacing:-0.5px">Slab<span style="color:#8b6f47">HQ</span></div>
      <div style="font-size:11px;color:${alert.tagColor};letter-spacing:2px;text-transform:uppercase;margin-top:2px">${alert.tag}</div>
    </div>

    <!-- HEADLINE -->
    <div style="background:#1a1a2e;border-radius:12px;padding:24px;margin-bottom:16px;color:#fff">
      <div style="font-size:10px;color:#7a8fa8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">${today}</div>
      <div style="font-size:22px;font-weight:700;line-height:1.3;margin-bottom:12px">${alert.subject.replace(/^[^:]+:\s*/, '')}</div>
      <div style="font-size:13px;color:#d8e6f2;line-height:1.6">${alert.reason}</div>
    </div>

    <!-- TRIP RECOMMENDATION -->
    <div style="background:${rec.color};border-radius:12px;padding:20px;margin-bottom:16px;color:#fff">
      <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;opacity:0.8">RECOMMENDATION</div>
      <div style="font-size:20px;font-weight:700;margin-bottom:8px">${rec.action}</div>
      <div style="font-size:13px;line-height:1.5;opacity:0.95">${rec.reason}</div>
    </div>

    ${roadHtml ? `
    <!-- ROAD CONDITIONS -->
    <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #e5ddd4">
      <div style="font-size:10px;color:#7a8fa8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px">ROAD CONDITIONS (LIVE)</div>
      ${roadHtml}
      <div style="font-size:9px;color:#a09890;margin-top:8px">Source: Caltrans &middot; Updated ${today} 6:00 AM PST</div>
    </div>` : ''}

    <!-- 7-DAY FORECAST -->
    <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #e5ddd4">
      <div style="font-size:10px;color:#7a8fa8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px">7-DAY FORECAST</div>
      <div style="font-size:14px;font-weight:600;color:#1a1a2e;margin-bottom:14px">${primaryResort.name}</div>
      ${primaryDays.map(d => {
        const snowBar = d.snow > 0 ? `<div style="display:inline-block;width:${Math.min(d.snow / 10 * 100, 100)}%;min-width:${d.snow > 0 ? '20px' : '0'};height:14px;background:${d.snow >= 6 ? '#5bc4e0' : d.snow >= 2 ? '#6ab5c4' : '#a8c4cc'};border-radius:3px;margin-right:6px;vertical-align:middle"></div>` : '';
        const isBest = d === bestDay && d.snow > 0;
        return `<div style="display:flex;align-items:center;padding:8px 0;${d.isWeekend ? 'background:#faf8f5;margin:0 -20px;padding-left:20px;padding-right:20px;' : ''}border-bottom:1px solid #f0ebe5">
          <div style="width:80px;font-size:12px;color:${d.isWeekend ? '#8b6f47' : '#1a1a2e'};font-weight:${d.isWeekend ? '700' : '500'}">
            ${d.dayName} ${d.dateFmt}${d.isWeekend ? ' &#9733;' : ''}
          </div>
          <div style="flex:1;font-size:12px;color:#1a1a2e">
            ${snowBar}${d.snow > 0 ? `<strong>${d.snow}"</strong>` : '<span style="color:#a09890">&mdash;</span>'}
          </div>
          <div style="width:50px;text-align:right;font-size:11px;color:#7a8fa8">${d.wind}mph</div>
          <div style="width:50px;text-align:right;font-size:11px;color:#1a1a2e">${d.high}&deg;/${d.low}&deg;</div>
          ${isBest ? '<div style="width:20px;text-align:center;font-size:10px">&#128293;</div>' : '<div style="width:20px"></div>'}
        </div>`;
      }).join('')}
      <div style="margin-top:10px;font-size:11px;color:#7a8fa8;line-height:1.5">
        ${wkend.snow > 0 ? `&#9733; Weekend total: <strong style="color:#1a1a2e">${wkend.snow}"</strong> &middot; ` : ''}Week total: <strong style="color:#1a1a2e">${primaryResort.weekSnow}"</strong>${bestDay.snow > 0 ? ` &middot; &#128293; Best day: <strong style="color:#1a1a2e">${bestDay.fullDay}</strong>` : ''}
      </div>
    </div>

    ${alert.type === 'extended_outlook' ? `
    <!-- EXTENDED OUTLOOK (days 8-16) -->
    <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #e5ddd4">
      <div style="font-size:10px;color:#7a8fa8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px">EXTENDED OUTLOOK (2-3 WEEKS)</div>
      <div style="font-size:14px;font-weight:600;color:#1a1a2e;margin-bottom:14px">${primaryResort.name}</div>
      ${primaryResort.days.slice(7, 16).map(d => {
        return `<div style="display:flex;align-items:center;padding:6px 0;border-bottom:1px solid #f0ebe5">
          <div style="width:80px;font-size:11px;color:${d.isWeekend ? '#8b6f47' : '#7a8fa8'};font-weight:${d.isWeekend ? '600' : '400'}">${d.dayName} ${d.dateFmt}</div>
          <div style="flex:1;font-size:11px;color:#1a1a2e">${d.snow > 0 ? `<strong>${d.snow}"</strong>` : '&mdash;'}</div>
          <div style="width:50px;text-align:right;font-size:10px;color:#7a8fa8">${d.wind}mph</div>
        </div>`;
      }).join('')}
      <div style="margin-top:8px;font-size:10px;color:#e0960a;line-height:1.4">Note: Extended forecasts (8-16 days out) are less reliable. Use for planning, not commitments. Check back as dates get closer.</div>
    </div>` : ''}

    <!-- ALL RESORT CONDITIONS -->
    <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #e5ddd4">
      <div style="font-size:10px;color:#7a8fa8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:14px">ALL RESORT CONDITIONS</div>
      ${topResorts.map((r, i) => {
        const isFav = favIds.includes(r.id);
        const drive = estimateDrive(origin, RESORTS.find(x => x.id === r.id) || { lat: 0, lng: 0 });
        return `<div style="display:flex;align-items:center;padding:10px 0;${i < topResorts.length - 1 ? 'border-bottom:1px solid #f0ebe5;' : ''}${isFav ? 'background:#faf8f5;margin:0 -20px;padding-left:20px;padding-right:20px;' : ''}">
          <div style="flex:1">
            <div style="font-size:14px;font-weight:600;color:#1a1a2e">${isFav ? '&#9733; ' : ''}${r.name}</div>
            <div style="font-size:11px;color:#7a8fa8;margin-top:2px">${r.fresh24h}" fresh &middot; ${r.weekSnow}" this week &middot; Wind ${r.wind}mph</div>
            <div style="font-size:10px;color:#a09890;margin-top:2px">&#128663; ${drive.str} from ${origin.name} (${drive.dist} mi)</div>
          </div>
          <div style="text-align:right;min-width:44px">
            <div style="font-size:20px;font-weight:700;color:${r.score >= 80 ? '#42c97a' : r.score >= 65 ? '#5bc4e0' : '#e0960a'}">${r.score}</div>
            <div style="font-size:9px;font-weight:600;color:${r.score >= 80 ? '#42c97a' : r.score >= 65 ? '#5bc4e0' : '#e0960a'}">${r.score >= 80 ? 'GO' : r.score >= 65 ? 'GOOD' : 'OK'}</div>
          </div>
        </div>`;
      }).join('')}
    </div>

    <div style="text-align:center;margin:24px 0">
      <a href="${SITE_URL}" style="display:inline-block;background:#8b6f47;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.5px">Open SlabHQ &rarr;</a>
    </div>

    <div style="text-align:center;font-size:10px;color:#a09890;line-height:1.8;margin-top:32px;padding-top:16px;border-top:1px solid #e5ddd4">
      <div>Data: <a href="https://open-meteo.com" style="color:#8b6f47;text-decoration:none">Open-Meteo API</a> | Roads: <a href="https://roads.dot.ca.gov" style="color:#8b6f47;text-decoration:none">Caltrans</a> &middot; Updated ${today} at 6:00 AM PST</div>
      <div>Location: ${subscriber.location || 'Not set'} &middot; Tracking: ${favIds.length ? favIds.join(', ') : 'All resorts'}</div>
      <div style="margin-top:8px"><a href="${SITE_URL}" style="color:#8b6f47;text-decoration:none">SlabHQ</a> &middot; Know before you go.</div>
    </div>

  </div>
</body>
</html>`;
}

function buildWeeklyDigestEmail(subscriber, allConditions, roadConditions) {
  const origin = getOrigin(subscriber.location);
  const favIds = (subscriber.favorites || '').split(',').map(s => s.trim()).filter(Boolean);

  const sorted = [...allConditions].sort((a, b) => {
    const aFav = favIds.includes(a.id) ? 1 : 0;
    const bFav = favIds.includes(b.id) ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;
    return b.score - a.score;
  });
  const topResorts = sorted.slice(0, 8);
  const bestResort = [...allConditions].sort((a, b) => b.score - a.score)[0];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const bestDays = bestResort.days || [];
  const wkend = getWeekendSummary(bestDays);
  const bestDay = bestDays.length ? getBestDay(bestDays) : null;

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
        Best conditions: <strong>${bestResort.name}</strong> — score ${bestResort.score}, ${bestResort.fresh24h}" fresh.
        ${bestResort.weekSnow > 10 ? ` Storm total: ${bestResort.weekSnow}" this week.` : ''}
        ${wkend && wkend.snow > 0 ? `<br>Weekend outlook: ${wkend.snow}" expected.` : ''}
        ${bestDay && bestDay.snow > 0 ? `<br>Best day: ${bestDay.fullDay} (${bestDay.dateFmt}) with ${bestDay.snow}".` : ''}
      </div>
    </div>

    <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #e5ddd4">
      <div style="font-size:10px;color:#7a8fa8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:14px">RESORT RANKINGS</div>
      ${topResorts.map((r, i) => {
        const isFav = favIds.includes(r.id);
        const drive = estimateDrive(origin, RESORTS.find(x => x.id === r.id) || { lat: 0, lng: 0 });
        return `<div style="display:flex;align-items:center;padding:8px 0;${i < topResorts.length - 1 ? 'border-bottom:1px solid #f0ebe5;' : ''}${isFav ? 'background:#faf8f5;margin:0 -20px;padding-left:20px;padding-right:20px;' : ''}">
          <div style="width:24px;font-size:12px;font-weight:700;color:#a09890">${i + 1}</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:#1a1a2e">${isFav ? '&#9733; ' : ''}${r.name}</div>
            <div style="font-size:11px;color:#7a8fa8">${r.fresh24h}" fresh &middot; ${r.weekSnow}" week &middot; Wind ${r.wind}mph</div>
            <div style="font-size:10px;color:#a09890">&#128663; ${drive.str} from ${origin.name}</div>
          </div>
          <div style="font-size:18px;font-weight:700;color:${r.score >= 80 ? '#42c97a' : r.score >= 65 ? '#5bc4e0' : '#e0960a'}">${r.score}</div>
        </div>`;
      }).join('')}
    </div>

    <div style="text-align:center;margin:24px 0">
      <a href="${SITE_URL}" style="display:inline-block;background:#8b6f47;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">View Full Details &rarr;</a>
    </div>

    <div style="text-align:center;font-size:10px;color:#a09890;line-height:1.8;margin-top:32px;padding-top:16px;border-top:1px solid #e5ddd4">
      <div>Data: <a href="https://open-meteo.com" style="color:#8b6f47;text-decoration:none">Open-Meteo API</a> &middot; Updated ${today}</div>
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
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
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
  console.log('=== SlabHQ Smart Snow Alert ===');
  console.log(`Time: ${new Date().toISOString()}`);
  const dow = new Date().getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  console.log(`Day of week: ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]}`);

  // Load subscribers from Cloudflare Worker KV (private storage)
  let subscribers = [];
  const workerUrl = process.env.WORKER_URL || 'https://slabhq-subscribe.xiaoseanlu.workers.dev';
  const subsToken = process.env.SUBSCRIBERS_TOKEN;
  if (!subsToken) {
    console.log('SUBSCRIBERS_TOKEN not set. Cannot fetch subscribers.');
    return;
  }
  try {
    const subsRes = await fetch(`${workerUrl}/subscribers`, {
      headers: { 'Authorization': `Bearer ${subsToken}` },
    });
    const subsData = await subsRes.json();
    if (!subsData.ok) throw new Error(subsData.error || 'Failed to fetch');
    subscribers = subsData.subscribers || [];
  } catch (e) {
    console.log('Failed to fetch subscribers from worker:', e.message);
    return;
  }
  if (subscribers.length === 0) { console.log('No subscribers. Exiting.'); return; }
  console.log(`Found ${subscribers.length} subscriber(s).`);

  // Fetch weather for all non-closed resorts (16-day forecast)
  const openResorts = RESORTS.filter(r => r.status !== 'CLOSED');
  console.log(`Fetching 16-day weather for ${openResorts.length} resorts...`);

  const allConditions = [];
  for (const resort of openResorts) {
    try {
      const weather = await fetchWeather(resort.lat, resort.lng);
      const daily = weather.daily;
      const score = scoreResort(weather);
      const fresh24h = Math.round((daily.snowfall_sum[0] || 0) * 10) / 10;
      const weekSnow = Math.round(daily.snowfall_sum.slice(0, 7).reduce((a, b) => a + b, 0) * 10) / 10;
      const wind = Math.round(daily.windspeed_10m_max[0] || 0);
      const high = Math.round(daily.temperature_2m_max[0] || 0);
      const low = Math.round(daily.temperature_2m_min[0] || 0);
      const days = analyzeDays(weather);

      allConditions.push({
        id: resort.id, name: resort.name, lat: resort.lat, lng: resort.lng,
        score, fresh24h, weekSnow, wind, high, low, days,
      });
      console.log(`  ${resort.name}: ${fresh24h}" fresh, ${weekSnow}" week, score ${score}`);
    } catch (e) {
      console.warn(`  Failed to fetch ${resort.name}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  if (allConditions.length === 0) { console.log('No weather data. Exiting.'); return; }

  // Fetch road conditions for CA mountain routes
  console.log('Fetching Caltrans road conditions...');
  const roadConditions = await fetchRoadConditions(['80', '50', '89', '88', '395', '203', '108', '120', '20', '267', '158', '207', '18', '38', '330']);
  for (const [num, rc] of Object.entries(roadConditions)) {
    console.log(`  ${rc.route}: ${rc.status} — ${rc.detail.slice(0, 80)}`);
  }

  // Process each subscriber
  let sentCount = 0;
  for (const sub of subscribers) {
    const prefs = sub.prefs || ['powder_8in', 'storm_12in', 'epic_85'];
    const favIds = (sub.favorites || '').split(',').map(s => s.trim()).filter(Boolean);

    // Find the best alert across all relevant resorts
    let bestAlert = null;
    const resortAlerts = [];

    for (const cond of allConditions) {
      const isRelevant = favIds.length === 0 || favIds.includes(cond.id);
      if (!isRelevant) continue;

      const alert = determineAlertType(cond, dow);
      if (alert) {
        resortAlerts.push(cond);
        if (!bestAlert || alert.priority > bestAlert.priority) {
          bestAlert = alert;
        }
      }
    }

    if (bestAlert && resortAlerts.length > 0) {
      const html = buildAlertEmail({ ...sub, favorites: favIds }, bestAlert, resortAlerts, allConditions, roadConditions);
      const sent = await sendEmail(sub.email, bestAlert.subject, html);
      if (sent) sentCount++;
      console.log(`  ${sub.email}: ${bestAlert.type} — ${bestAlert.subject}`);
    }
    // Weekly digest on Mondays (opt-in, only if no other alert sent)
    else if (dow === 1 && prefs.includes('weekly_digest')) {
      const best = [...allConditions].sort((a, b) => b.score - a.score)[0];
      const subject = `Weekly Snow Digest: ${best.name} leads with score ${best.score}`;
      const html = buildWeeklyDigestEmail(sub, allConditions, roadConditions);
      const sent = await sendEmail(sub.email, subject, html);
      if (sent) sentCount++;
    } else {
      console.log(`  No alert triggered for ${sub.email}`);
    }

    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\nDone. Sent ${sentCount} email(s) to ${subscribers.length} subscriber(s).`);
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
