#!/usr/bin/env bash
# ==============================================================================
# Thesa AI — Automated Smoke Test & Health Diagnostics Script
# Usage: ./scripts/smoke_test.sh [BASE_URL]
# Example: ./scripts/smoke_test.sh http://localhost:8080
# ==============================================================================

set -e

BASE_URL="${1:-http://localhost:8080}"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}🚀 Thesa AI — Automated Quality Gate & Smoke Test${NC}"
echo -e "${BLUE}Target URL:${NC} ${BASE_URL}"
echo -e "${BLUE}======================================================${NC}\n"

passed=0
total=0

run_test() {
  local name="$1"
  local cmd="$2"
  local match="$3"
  total=$((total + 1))

  echo -ne "Testing: ${YELLOW}${name}${NC}... "
  output=$(eval "$cmd" 2>&1 || true)

  if echo "$output" | grep -q "$match"; then
    echo -e "${GREEN}PASSED ✓${NC}"
    passed=$((passed + 1))
  else
    echo -e "${RED}FAILED ✗${NC}"
    echo -e "  ${RED}Expected to find:${NC} $match"
    echo -e "  ${RED}Actual Output:${NC} $(echo "$output" | head -n 3)"
  fi
}

# 1. Health Endpoint
run_test "GET /health (Diagnostics & DB)" \
  "curl -s -f '${BASE_URL}/health'" \
  "Thesa AI"

# 2. Static Web Root
run_test "GET / (Static Web Client)" \
  "curl -s -I '${BASE_URL}/'" \
  "HTTP"

# 3. Auth Register API
run_test "POST /api/v1/auth/register (New User)" \
  "curl -s -X POST '${BASE_URL}/api/v1/auth/register' -H 'Content-Type: application/json' -d '{\"email\":\"smoke.test@ui.ac.id\",\"password\":\"pass123\",\"name\":\"Smoke Tester\",\"institution\":\"UI\"}'" \
  "token"

# 4. Auth Login API
run_test "POST /api/v1/auth/login (Existing User)" \
  "curl -s -X POST '${BASE_URL}/api/v1/auth/login' -H 'Content-Type: application/json' -d '{\"email\":\"alif.awwaz@ui.ac.id\",\"password\":\"thesa2026\"}'" \
  "token"

# 5. Template List API
run_test "GET /api/v1/template/list (Institutional Templates)" \
  "curl -s '${BASE_URL}/api/v1/template/list'" \
  "templates"

# 6. Socratic Questions API
run_test "POST /api/v1/supervisor/socratic-questions (Supervisor Questions)" \
  "curl -s -X POST '${BASE_URL}/api/v1/supervisor/socratic-questions' -H 'Content-Type: application/json' -d '{\"document\":\"Latar belakang penelitian ini mengenai machine learning dan integrasi data.\"}'" \
  "questions"

# 7. Viva Voce Defense Examiner API
run_test "POST /api/v1/supervisor/examiner-simulate (Examiner Question)" \
  "curl -s -X POST '${BASE_URL}/api/v1/supervisor/examiner-simulate' -H 'Content-Type: application/json' -d '{\"mode\":\"question\",\"topic\":\"Kecerdasan Buatan\",\"difficulty\":\"standard\",\"turn\":1,\"examiner\":{\"id\":\"ex1\",\"name\":\"Prof. Hardi\",\"role\":\"Ketua Penguji\"}}'" \
  "question_text"

echo -e "\n${BLUE}======================================================${NC}"
if [ "$passed" -eq "$total" ]; then
  echo -e "${GREEN}🎉 ALL ${passed}/${total} SMOKE TESTS PASSED! Quality Gate verified.${NC}"
  echo -e "${BLUE}======================================================${NC}"
  exit 0
else
  echo -e "${RED}⚠️ ${passed}/${total} tests passed. Some endpoints failed.${NC}"
  echo -e "${BLUE}======================================================${NC}"
  exit 1
fi
