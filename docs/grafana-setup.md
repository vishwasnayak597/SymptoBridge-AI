# Grafana Cloud setup (free tier, ~10 minutes)

The backend already exposes Prometheus metrics at `https://symptobridge-ai.onrender.com/metrics`:
HTTP request duration/status by route, Node process metrics, and real-user web
vitals (`web_vitals_value` — LCP/CLS/TTFB reported by browsers). This guide
connects them to hosted dashboards + alerting. The free tier is permanent
(10k series, 14-day retention, alerting included) — no credit card.

## 1. Protect the metrics endpoint (recommended)

In Render → `symptobridge-ai` → Environment, add:

```
METRICS_TOKEN=<any long random string>
```

The endpoint then requires `Authorization: Bearer <token>` (or `?token=`).

## 2. Create the Grafana Cloud stack

1. Sign up at https://grafana.com (free plan).
2. In your stack, go to **Connections → Add new connection → Metrics endpoint**
   (the "scrape a URL" integration).
3. Configure:
   - URL: `https://symptobridge-ai.onrender.com/metrics`
   - Auth: Bearer token → the `METRICS_TOKEN` value
   - Scrape interval: 60s
4. Save — Grafana Cloud starts scraping and storing the metrics.

## 3. Import the starter dashboard

Dashboards → New → Import → upload `docs/grafana-dashboard.json` from this
repo. Panels included:

- Request rate by route (req/s)
- p95 latency by route
- Error rate (5xx %)
- Real-user web vitals: LCP p75 and CLS p75 (Google's recommended percentile)
- Node process memory / event-loop lag

## 4. One alert worth having

Alerting → New alert rule:

```
expr: sum(rate(http_request_duration_seconds_count{status=~"5.."}[5m]))
      / sum(rate(http_request_duration_seconds_count[5m])) > 0.05
for: 10m
```

"Error rate above 5% for 10 minutes" → notify via email (free).

## Useful queries

| What | PromQL |
|---|---|
| p95 latency | `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))` |
| Requests/s by route | `sum(rate(http_request_duration_seconds_count[5m])) by (route)` |
| LCP p75 (ms) | `histogram_quantile(0.75, sum(rate(web_vitals_value_bucket{metric="LCP"}[1h])) by (le))` |
| CLS p75 | `histogram_quantile(0.75, sum(rate(web_vitals_value_bucket{metric="CLS"}[1h])) by (le))` |
