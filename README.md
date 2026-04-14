# SlabHQ

**Real-time ski trip intelligence for Ikon Pass holders.**

Live snow forecasts, road conditions, driving routes, and resort rankings for 50+ Ikon Pass resorts -- so you don't have to check 10 different sites.

## What it does

- **Resort rankings** scored by snow conditions, weather, travel distance, and crowd factors
- **7-day hourly forecasts** + 3-week outlook for every resort
- **Live road conditions** from Caltrans with chain control alerts
- **Real driving routes** via Valhalla with accurate distance and drive time
- **Storm context** -- when it started, when it peaks, best window for fresh tracks
- **Trip planner** with itinerary, packing checklist, and Google Maps integration
- **Email alerts** for powder days, storm totals, and epic conditions at your favorite resorts
- **Year-over-year snowfall** comparison (this season vs last 5 years) via historical weather data
- **Multi-language** support (English, Chinese, Japanese)
- **Dark mode** with system preference detection

## Data sources

| Data | Source | Type |
|------|--------|------|
| Snow forecast & weather | [Open-Meteo API](https://open-meteo.com) | Live |
| Historical snowfall (YOY) | [Open-Meteo Historical API](https://open-meteo.com/en/docs/historical-weather-api) | Live |
| Road conditions | [Caltrans QuickMap](https://roads.dot.ca.gov) | Live |
| Driving routes & distance | [Valhalla (OSM)](https://valhalla.openstreetmap.de) | Live |
| Snow depth | [Open-Meteo](https://open-meteo.com) | Live |
| Lift/trail counts, hours | Resort websites | Estimated |

## Architecture

```
Single-page app (index.html)
    |
    |-- Open-Meteo API (weather, forecasts, snow depth, historical)
    |-- Valhalla API (driving routes, distance, duration)
    |-- Caltrans API (road conditions, chain control)
    |
Cloudflare Worker (worker/)
    |-- Handles email subscriptions
    |-- Saves subscribers via GitHub API
    |-- Sends welcome emails via Resend
    |
GitHub Actions (.github/workflows/)
    |-- Daily 6am PST cron job
    |-- Checks snow thresholds for all resorts
    |-- Sends powder/storm/epic alerts via Resend
    |-- Weekly digest every Monday
```

**Total hosting cost: $0/month** (GitHub Pages + Cloudflare Workers free tier + Resend free tier)

## Resorts

50+ Ikon Pass resorts across North America and international destinations:

**California** -- Mammoth Mountain, Palisades Tahoe, June Mountain, Big Bear, Snow Summit, Mountain High, Snow Valley, China Peak, Boreal, Bear Valley

**Utah** -- Snowbird, Brighton, Solitude, Alta, Deer Valley, Snowbasin

**Colorado** -- Aspen Snowmass, Steamboat, Winter Park, Copper Mountain, Eldora, Arapahoe Basin

**Pacific Northwest** -- Crystal Mountain, The Summit at Snoqualmie, Mt. Bachelor, Schweitzer

**Northeast** -- Killington, Sugarbush, Stratton, Windham, Loon, Sunday River, Sugarloaf, Tremblant

**Rocky Mountain** -- Big Sky, Jackson Hole, Taos, Revelstoke, Red Mountain

**International** -- Niseko (Japan), Chamonix (France), Zermatt (Switzerland), Valle Nevado (Chile), Thredbo (Australia)

## Setup

The app runs as a static site -- just open `index.html` or serve it:

```bash
npx serve -l 8080 -s
```

For email alerts setup, see [SETUP-EMAIL-ALERTS.md](SETUP-EMAIL-ALERTS.md).

## Tech stack

- **Frontend**: Vanilla HTML/CSS/JS (single file, no build step)
- **Maps**: Leaflet.js with CartoDB tiles
- **Routing**: Valhalla (OpenStreetMap)
- **Weather**: Open-Meteo (free, no API key)
- **Email**: Resend (100/day free)
- **Subscriptions**: Cloudflare Workers (free tier)
- **Alerts**: GitHub Actions (free for public repos)
- **Hosting**: GitHub Pages (free)

## License

Not for commercial use.
