#!/usr/bin/env bash
# ==============================================================================
# Thesa AI — Security Audit Checklist Script
# Usage: ./scripts/security_audit.sh [BASE_URL]
# ==============================================================================
set -uo pipefail

BASE_URL="${1:-http://localhost:8080}"
ENV_FILE="$(pwd)/.env"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
PASS=0; FAIL=0; WARN=0

check_pass() { echo -e "${GREEN}  ✅ PASS${NC}: $1"; ((PASS++)); }
check_fail() { echo -e "${RED}  ❌ FAIL${NC}: $1"; ((FAIL++)); }
check_warn() { echo -e "${YELLOW}  ⚠️  WARN${NC}: $1"; ((WARN++)); }

echo -e "\n${BLUE}======================================================${NC}"
echo -e "${BLUE}🔒 Thesa AI — Security Audit${NC}"
echo -e "${BLUE}======================================================${NC}\n"

# ----- ENV FILE CHECKS -------------------------------------------------------
echo -e "${BLUE}[1/4] Environment & Secrets${NC}"

if [ -f "$ENV_FILE" ]; then
  # ADMIN_SECRET_KEY tidak default
  KEY=$(grep -E "^ADMIN_SECRET_KEY=" "$ENV_FILE" | cut -d'=' -f2)
  if echo "$KEY" | grep -qiE "(thesa_super|change_in_prod|example|default|secret)"; then
    check_fail "ADMIN_SECRET_KEY masih menggunakan nilai default! Ganti sebelum go-live."
  else
    check_pass "ADMIN_SECRET_KEY telah diubah dari nilai default."
  fi

  # MYSQL_ROOT_PASSWORD tidak default
  DB_PASS=$(grep -E "^MYSQL_ROOT_PASSWORD=" "$ENV_FILE" | sed 's/^MYSQL_ROOT_PASSWORD=//')
  if echo "$DB_PASS" | grep -qiE "^(thesapassword|password|123456|root)$"; then
    check_fail "MYSQL_ROOT_PASSWORD masih lemah/default! Ganti dengan password kuat."
  else
    check_pass "MYSQL_ROOT_PASSWORD cukup kuat."
  fi

  # CORS tidak wildcard
  CORS=$(grep -E "^CORS_ALLOWED_ORIGINS=" "$ENV_FILE" | cut -d'=' -f2)
  if [ "$CORS" = "*" ]; then
    check_warn "CORS_ALLOWED_ORIGINS=* (wildcard). Batasi ke domain produksi Anda untuk keamanan optimal."
  else
    check_pass "CORS_ALLOWED_ORIGINS terbatas: $CORS"
  fi

  # MIDTRANS produksi
  MT_PROD=$(grep -E "^MIDTRANS_IS_PRODUCTION=" "$ENV_FILE" | cut -d'=' -f2)
  if [ "$MT_PROD" = "false" ]; then
    check_warn "MIDTRANS_IS_PRODUCTION=false (mode sandbox). Ubah ke true untuk production!"
  else
    check_pass "Midtrans sudah di mode production."
  fi

  # API Key tidak kosong
  GEMINI_KEY=$(grep -E "^GEMINI_API_KEY=" "$ENV_FILE" | cut -d'=' -f2)
  if [ -z "$GEMINI_KEY" ]; then
    check_fail "GEMINI_API_KEY kosong!"
  else
    check_pass "GEMINI_API_KEY terisi."
  fi
else
  check_fail ".env file tidak ditemukan!"
fi

# ----- GIT CHECKS ------------------------------------------------------------
echo -e "\n${BLUE}[2/4] Git / Source Control${NC}"

if git -C "$(pwd)" check-ignore .env >/dev/null 2>&1; then
  check_pass ".env terdaftar di .gitignore"
else
  check_fail ".env mungkin tidak di .gitignore! Jalankan: echo '.env' >> .gitignore"
fi

# ----- HTTP SECURITY HEADERS (jika server berjalan) --------------------------
echo -e "\n${BLUE}[3/4] HTTP Security Headers${NC}"

if curl -s --connect-timeout 3 "$BASE_URL/health" >/dev/null 2>&1; then
  HEADERS=$(curl -s -I "$BASE_URL/health" 2>&1)

  echo "$HEADERS" | grep -qi "X-Content-Type-Options" \
    && check_pass "X-Content-Type-Options header ada" \
    || check_warn "X-Content-Type-Options header tidak ditemukan"

  echo "$HEADERS" | grep -qi "X-Frame-Options" \
    && check_pass "X-Frame-Options header ada" \
    || check_warn "X-Frame-Options header tidak ditemukan"

  echo "$HEADERS" | grep -qi "Strict-Transport-Security" \
    && check_pass "HSTS (Strict-Transport-Security) header ada" \
    || check_warn "HSTS header tidak ada (wajar jika belum HTTPS)"

  echo "$HEADERS" | grep -qi "server:" \
    && check_warn "Server header exposed: $(echo "$HEADERS" | grep -i 'server:')" \
    || check_pass "Server header tidak exposed"
else
  check_warn "Server tidak berjalan di $BASE_URL — HTTP header check dilewati."
fi

# ----- GO STATIC ANALYSIS ----------------------------------------------------
echo -e "\n${BLUE}[4/4] Go Static Analysis${NC}"

if command -v go >/dev/null 2>&1; then
  if go vet ./... 2>&1 | grep -q "error"; then
    check_fail "go vet menemukan masalah. Jalankan 'go vet ./...' untuk detail."
  else
    check_pass "go vet lulus tanpa error."
  fi
else
  check_warn "Go tidak ditemukan di PATH — static analysis dilewati."
fi

# ----- SUMMARY ---------------------------------------------------------------
echo -e "\n${BLUE}======================================================${NC}"
echo -e "PASS: ${GREEN}${PASS}${NC} | FAIL: ${RED}${FAIL}${NC} | WARN: ${YELLOW}${WARN}${NC}"
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ Terdapat ${FAIL} item KRITIS yang harus diperbaiki sebelum go-live!${NC}"
  exit 1
else
  echo -e "${GREEN}✅ Security audit selesai. Tidak ada temuan kritis.${NC}"
fi
