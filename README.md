# 🎓 Thesa AI

> Platform AI untuk mahasiswa & peneliti — analisis gap literatur, generate outline skripsi, simulasi sidang, dan supervisi sokratik berbasis DeepSeek + Gemini.

[![CI](https://github.com/risalmr/thesa-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/risalmr/thesa-ai/actions/workflows/ci.yml)

---

## 🚀 Quick Start (Lokal)

```bash
# 1. Clone
git clone https://github.com/risalmr/thesa-ai.git && cd thesa-ai

# 2. Siapkan environment
cp .env.example .env
# Edit .env dan isi API keys (lihat bagian Environment Variables)

# 3. Jalankan stack (Docker wajib aktif)
docker compose up -d --build

# 4. Verifikasi
curl http://localhost:8080/health
```

---

## ⚙️ Environment Variables

Salin `.env.example` → `.env` dan isi nilai berikut:

| Variable | Keterangan | Wajib |
|---|---|---|
| `GEMINI_API_KEY` | API Key Google Gemini | ✅ |
| `DEEPSEEK_API_KEY` | API Key DeepSeek | Opsional |
| `AI_PRIMARY_PROVIDER` | `gemini` atau `deepseek` | ✅ |
| `MYSQL_ROOT_PASSWORD` | Password MySQL (min 16 karakter) | ✅ |
| `ADMIN_SECRET_KEY` | JWT Secret admin (min 32 chars) | ✅ |
| `CORS_ALLOWED_ORIGINS` | Domain frontend (mis. `https://thesa.ai`) | ✅ |
| `MIDTRANS_SERVER_KEY` | Server Key Midtrans | Opsional |
| `MIDTRANS_IS_PRODUCTION` | `true` untuk produksi | ✅ |

> **⚠️ JANGAN** commit file `.env` ke repository. File ini sudah terdaftar di `.gitignore`.

Generate secret key aman:
```bash
openssl rand -hex 32    # Untuk ADMIN_SECRET_KEY
openssl rand -base64 24 # Untuk MYSQL_ROOT_PASSWORD
```

---

## 🏗️ Arsitektur

```
Browser → Nginx/Reverse Proxy → Thesa Go Backend (port 8080)
                                      ├── DeepSeek / Gemini AI API
                                      ├── Embedded Web Frontend (web/)
                                      └── MySQL 8.0 Database
```

---

## 📡 API Endpoints Utama

| Method | Endpoint | Deskripsi |
|---|---|---|
| `GET` | `/health` | Status sistem & koneksi DB |
| `POST` | `/api/v1/auth/register` | Registrasi akun |
| `POST` | `/api/v1/auth/login` | Login & terima token |
| `GET` | `/api/v1/auth/me` | Profil user aktif |
| `POST` | `/api/literature/gap-analysis` | Analisis gap riset (AI) |
| `GET` | `/api/v1/template/list` | Daftar template institusi |
| `POST` | `/api/v1/outline/generate` | Generate outline skripsi |
| `POST` | `/api/v1/supervisor/socratic-questions` | Pertanyaan sokratik dosen |
| `POST` | `/api/v1/supervisor/examiner-simulate` | Simulasi sidang 3 penguji |
| `POST` | `/api/v1/cascade/calculate` | Sinkronisasi dependensi bab |

---

## 🧪 Testing

```bash
# Unit tests (butuh Go terinstall)
go test -v -race -coverprofile=coverage.out ./...

# Smoke test (butuh server berjalan)
./scripts/smoke_test.sh http://localhost:8080

# Load test (butuh server berjalan + 'hey' atau 'ab' terinstall)
./scripts/load_test.sh http://localhost:8080 30 20

# Security audit (dapat dijalankan tanpa server)
./scripts/security_audit.sh http://localhost:8080
```

---

## 📊 Monitoring

Jalankan monitoring stack (Prometheus + Grafana + Alertmanager):
```bash
docker compose -f docker-compose.monitor.yml up -d
```

| Service | URL | Kredensial |
|---|---|---|
| Grafana | http://localhost:3030 | admin / thesa_monitor |
| Prometheus | http://localhost:9090 | — |
| Alertmanager | http://localhost:9093 | — |

Untuk notifikasi alert via Telegram, edit `monitoring/alertmanager.yml` dan isi `bot_token` & `chat_id`.

---

## 💾 Backup & Restore Database

```bash
# Backup manual
./scripts/backup.sh              # Simpan ke ./backups/

# Backup ke direktori kustom
./scripts/backup.sh /mnt/external-disk/backups

# Restore
docker exec -i thesa_ai_db mysql -u root -p<MYSQL_ROOT_PASSWORD> risethub < backup_file.sql
```

**Backup otomatis via cron** (tambahkan ke `crontab -e`):
```cron
# Setiap hari jam 02:00 WIB
0 2 * * * cd /path/to/thesa-ai && ./scripts/backup.sh >> /var/log/thesa_backup.log 2>&1
```

---

## 🔄 Rollback & Update

```bash
# Update ke versi terbaru
git pull origin main
docker compose up -d --build --no-deps thesa-app

# Rollback ke commit sebelumnya
git log --oneline -10          # Lihat history
git reset --hard <COMMIT_HASH>
docker compose up -d --build --no-deps thesa-app
```

---

## 🚢 Deployment

Lihat [`DEPLOYMENT.md`](DEPLOYMENT.md) untuk panduan lengkap:
- **Opsi A**: VPS / Docker Compose (Hetzner, DigitalOcean, EC2)
- **Opsi B**: Koyeb Cloud (serverless, Singapore region)
- **Opsi C**: Vercel (frontend CDN)
- **Opsi D**: Render / Railway / Fly.io / Coolify

---

## 🔒 Security Checklist Pre-Launch

- [x] `ADMIN_SECRET_KEY` telah diubah dari nilai default (min 64 hex chars)
- [x] `MYSQL_ROOT_PASSWORD` telah diubah (min 16 chars, alphanumeric + simbol)
- [x] `.env` terdaftar di `.gitignore`
- [x] Midtrans mode production aktif
- [ ] `CORS_ALLOWED_ORIGINS` diisi domain spesifik (bukan `*`)
- [ ] SSL/HTTPS aktif di domain produksi
- [ ] Backup rutin terjadwal (cron)
- [ ] Monitoring aktif (Prometheus + Grafana)

---

## 📋 UAT Checklist

Sebelum go-live, verifikasi alur berikut dengan pengguna nyata:

- [ ] Registrasi akun mahasiswa
- [ ] Login dan mendapatkan token JWT
- [ ] Melihat daftar template institusi
- [ ] Generate outline skripsi (6 bab)
- [ ] Analisis gap literatur dengan judul riset
- [ ] Pertanyaan sokratik supervisor
- [ ] Simulasi sidang dengan 3 penguji
- [ ] Export dokumen

---

## 👥 Tim

Dikembangkan oleh **Risethub** untuk mendukung riset akademik mahasiswa Indonesia.
