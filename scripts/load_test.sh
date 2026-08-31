#!/usr/bin/env bash
# ==============================================================================
# Thesa AI — Load Test Script
# Usage: ./scripts/load_test.sh [BASE_URL] [DURATION_SECONDS] [CONCURRENCY]
# Example: ./scripts/load_test.sh http://localhost:8080 30 20
# ==============================================================================
set -euo pipefail

BASE_URL="${1:-http://localhost:8080}"
DURATION="${2:-30}"
CONCURRENCY="${3:-20}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}🔥 Thesa AI — Load Test${NC}"
echo -e "${BLUE}Target: ${BASE_URL} | Duration: ${DURATION}s | Concurrency: ${CONCURRENCY}${NC}"
echo -e "${BLUE}======================================================${NC}\n"

if command -v hey >/dev/null 2>&1; then
  echo -e "${YELLOW}▶ Using: hey${NC}"
  echo -e "\n[1/3] GET /health"
  hey -z "${DURATION}s" -c "$CONCURRENCY" "${BASE_URL}/health"
  echo -e "\n[2/3] POST /api/v1/auth/login"
  hey -z "${DURATION}s" -c "$CONCURRENCY" -m POST \
    -H "Content-Type: application/json" \
    -d '{"email":"alif.awwaz@ui.ac.id","password":"thesa2026"}' \
    "${BASE_URL}/api/v1/auth/login"
  echo -e "\n[3/3] POST /api/v1/supervisor/socratic-questions"
  hey -z "${DURATION}s" -c 5 -m POST \
    -H "Content-Type: application/json" \
    -d '{"document":"Penelitian ini membahas machine learning untuk klasifikasi data."}' \
    "${BASE_URL}/api/v1/supervisor/socratic-questions"
elif command -v ab >/dev/null 2>&1; then
  echo -e "${YELLOW}▶ hey not found, using Apache Bench (ab)${NC}"
  REQUESTS=$(( CONCURRENCY * DURATION * 2 ))
  echo -e "\n[1/2] GET /health"
  ab -n "$REQUESTS" -c "$CONCURRENCY" "${BASE_URL}/health"
  echo -e "\n[2/2] POST /api/v1/auth/login"
  printf '{"email":"alif.awwaz@ui.ac.id","password":"thesa2026"}' > /tmp/thesa_ab_body.json
  ab -n "$REQUESTS" -c "$CONCURRENCY" -p /tmp/thesa_ab_body.json -T "application/json" "${BASE_URL}/api/v1/auth/login"
else
  echo -e "${RED}Neither 'hey' nor 'ab' found. Running curl fallback (basic).${NC}"
  END_TIME=$(( $(date +%s) + DURATION ))
  COUNT=0
  FAIL=0
  while [ "$(date +%s)" -lt "$END_TIME" ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/health" || true)
    if [ "$HTTP_CODE" = "200" ]; then ((COUNT++)); else ((FAIL++)); fi
    sleep 0.1
  done
  echo -e "Success: ${GREEN}${COUNT}${NC} | Failed: ${RED}${FAIL}${NC}"
fi

echo -e "\n${GREEN}✅ Load test selesai.${NC}"
