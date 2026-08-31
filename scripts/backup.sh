#!/usr/bin/env bash
# ==============================================================================
# Thesa AI — Automated Database Backup Script
# Usage: ./scripts/backup.sh [BACKUP_DIR]
# Default backup dir: ./backups
# Add to cron:  0 2 * * * /path/to/thesa-ai/scripts/backup.sh >> /var/log/thesa_backup.log 2>&1
# ==============================================================================
set -euo pipefail

BACKUP_DIR="${1:-$(pwd)/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/risethub_${TIMESTAMP}.sql.gz"

# Load env if present
if [ -f "$(pwd)/.env" ]; then
  export $(grep -v '^#' "$(pwd)/.env" | xargs) 2>/dev/null || true
fi

DB_PASSWORD="${MYSQL_ROOT_PASSWORD:-thesapassword}"
CONTAINER_NAME="thesa_ai_db"

GREEN='\033[0;32m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] Thesa AI — Database Backup${NC}"
echo "Backup target: $BACKUP_FILE"

# Create backup directory if not exists
mkdir -p "$BACKUP_DIR"

# Run mysqldump inside Docker container and compress
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  docker exec "$CONTAINER_NAME" mysqldump \
    -u root -p"${DB_PASSWORD}" \
    --single-transaction \
    --routines \
    --triggers \
    risethub | gzip > "$BACKUP_FILE"

  SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
  echo -e "${GREEN}✅ Backup sukses: ${BACKUP_FILE} (${SIZE})${NC}"

  # Keep only last 7 backups (rotate)
  ls -t "${BACKUP_DIR}"/risethub_*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm -v

  echo -e "${BLUE}Rotasi backup: hanya 7 backup terbaru yang disimpan.${NC}"
else
  echo -e "${RED}❌ Container '${CONTAINER_NAME}' tidak berjalan. Backup dibatalkan.${NC}"
  exit 1
fi
