#!/usr/bin/env bash
# Nightly ingest pipeline for the ETF flows dashboard.
#
# Run after US market close (≥4:30 PM ET).
# Idempotent — safe to re-run; everything upserts on conflict.
#
# Pipeline:
#   1) Yahoo daily AUM capture (all 34 tickers, ~30s)
#   2) iShares daily NAV+shares (10 tickers, ~60s)
#   3) Recompute etf_metrics read model (dashboard read source, ~60s)
#
# Weekly:
#   4) Refresh public N-PORT XML (catches new filings as they hit EDGAR)
#
# Quarterly (manual):
#   5) DERA bulk dataset refresh (when new quarter publishes)
#
# Logs to /tmp/etf_ingest_$(date +%Y%m%d).log

set -euo pipefail

PROJECT_ROOT="/Users/riyajain/Desktop/portfolio-scanner"
PYTHON="$PROJECT_ROOT/.venv/bin/python"
LOGFILE="/tmp/etf_ingest_$(date +%Y%m%d).log"

cd "$PROJECT_ROOT"

echo "════════════════════════════════════════════════════════════" >> "$LOGFILE"
echo "Ingest run at $(date)"                                          >> "$LOGFILE"
echo "════════════════════════════════════════════════════════════" >> "$LOGFILE"

run_step() {
  local name="$1"
  shift
  echo ""                                                            >> "$LOGFILE"
  echo "── $name ──"                                                 >> "$LOGFILE"
  if "$@" >> "$LOGFILE" 2>&1; then
    echo "✓ $name OK"                                                >> "$LOGFILE"
  else
    echo "✗ $name FAILED (exit $?)"                                  >> "$LOGFILE"
    # Don't abort the whole pipeline — continue with later steps
  fi
}

# Daily steps
run_step "Yahoo AUM"          "$PYTHON" -m ingest.etf_aum_yahoo
run_step "iShares daily"      "$PYTHON" -m ingest.etf_shares_ishares --days 7

# Weekly steps — only on Mondays (US market data refresh isn't time-critical mid-week)
if [ "$(date +%u)" = "1" ]; then
  run_step "Public N-PORT XML" "$PYTHON" -m ingest.etf_flows --years 1
fi

# Always rebuild the dashboard read model last so it picks up any new data above
run_step "etf_metrics rebuild" "$PYTHON" -m ingest.etf_metrics

echo ""                                                              >> "$LOGFILE"
echo "Done at $(date)"                                               >> "$LOGFILE"
