# 🚀 Thesa AI — Production Deployment Guide

Dokumen ini berisi panduan teknis langkah demi langkah untuk melakukan deploy Thesa AI (Backend Go + Database MySQL + Static Frontend) ke lingkungan produksi (VPS, Cloud Server, PaaS, atau Docker Stack).

---

## 🏗️ 1. Arsitektur Produksi

```mermaid
graph TD
    Client[Browser / User Client] -->|HTTPS :443 / HTTP :8080| NginxOrApp[Reverse Proxy / Thesa App Container]
    subgraph Thesa Production Stack
        NginxOrApp --> GoServer[Thesa Go Backend Engine]
        GoServer --> StaticWeb[Embedded Web Client : web/]
        GoServer --> DeepSeekAPI[DeepSeek AI Cloud API]
        GoServer -->|Auto-Migrate & Pool| MySQLDB[(MySQL 8.0 Database)]
    end
```

### Keunggulan Infra Saat Ini:
1. **Self-Bootstrapping Database**: Backend secara otomatis menjalankan auto-migrasi DDL (`schema.sql`) saat boot pertama kali.
2. **Resilience & Exponential Backoff**: Backend memiliki mekanisme retry 5x jika database butuh beberapa detik saat inisialisasi.
3. **Graceful Shutdown**: Menangani `SIGINT` dan `SIGTERM` dengan zero request dropping saat rolling update.
4. **Hardened Container**: Multi-stage build berbasis Alpine minimalis dan berjalan dengan non-root user `thesa`.

---

## ⚡ 2. Opsi Deployment

### Opsi A: VPS / Server Mandiri (Docker Compose) — *Paling Direkomendasikan*

Cocok untuk: DigitalOcean Droplet, AWS EC2, Hetzner, Alibaba Cloud, Linode, atau VM pribadi.

#### Langkah 1: Clone Repository di Server
```bash
git clone <URL_REPO_ANDA> thesa-ai
cd thesa-ai
```

#### Langkah 2: Siapkan Environment Variables
```bash
cp .env.example .env
nano .env
```
Isi variabel penting:
- `DEEPSEEK_API_KEY`: Masukkan API Key resmi DeepSeek Anda.
- `MYSQL_ROOT_PASSWORD`: Ganti dengan password database produksi yang kuat.
- `PORT`: 8080 (atau port yang diinginkan).

#### Langkah 3: Jalankan Stack
```bash
docker compose up -d --build
```

#### Langkah 4: Verifikasi Status
```bash
docker compose ps
docker compose logs -f thesa-app
```
Tes endpoint health:
```bash
curl http://localhost:8080/health
```
Output sukses:
```json
{
  "status": "ok",
  "app": "Thesa AI / Risethub BE",
  "version": "1.0.0",
  "database_connected": true,
  "deepseek_configured": true,
  "uptime_seconds": 12
}
```

---

### Opsi B: PaaS Cloud (Railway, Render, Fly.io, Coolify)

Jika Anda menggunakan platform cloud modern yang mengelola container secara otomatis:

#### 1. Buat Service MySQL:
- Buat instance MySQL di Railway / Render / PlanetScale / Aiven.
- Salin connection string yang disediakan (contoh: `mysql://root:password@roundhouse.proxy.rlwy.net:12345/railway`).

#### 2. Deploy Web Service Thesa:
- Hubungkan repository Git Anda ke platform.
- Platform akan otomatis mendeteksi `Dockerfile`.
- Tambahkan Environment Variables di dashboard platform:
  - `DATABASE_URL`: Masukkan URL koneksi MySQL dari langkah 1.
  - `DEEPSEEK_API_KEY`: Key DeepSeek Anda.
  - `PORT`: (Platform seperti Railway / Render akan otomatis menyetel port ini).
- Deploy! Backend akan otomatis membuat semua tabel (`schema.sql`) pada startup pertama.

---

### Opsi C: Nginx Reverse Proxy + SSL (Domain Publik)

Untuk menghubungkan domain kustom (contoh: `app.thesa.ai`) dengan sertifikat SSL gratis Let's Encrypt:

```nginx
server {
    server_name app.thesa.ai;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }
}
```
Aktifkan SSL dengan Certbot:
```bash
sudo certbot --nginx -d app.thesa.ai
```

---

## 🛠️ 3. Operasional & Maintenance

### Backup Database
Untuk membuat backup database berkala:
```bash
docker exec thesa_ai_db mysqldump -u root -p<MYSQL_ROOT_PASSWORD> risethub > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Restore Database
```bash
docker exec -i thesa_ai_db mysql -u root -p<MYSQL_ROOT_PASSWORD> risethub < backup_file.sql
```

### Update Versi Aplikasi (Rolling Restart)
```bash
git pull origin main
docker compose up -d --build --no-deps thesa-app
```
*(Server otomatis menangani `SIGTERM` secara graceful tanpa memutus koneksi user yang sedang aktif).*

---

## 🔍 4. Diagnostik & Monitoring Endpoint

### Sistem & Status:
- **`GET /health`**: Status koneksi database, kesiapan DeepSeek API, dan uptime sistem.
- **`GET /`**: Antarmuka web Thesa AI SPA.

### Autentikasi & Akun:
- **`POST /api/v1/auth/register`**: Registrasi akun mahasiswa/dosen (hashing SHA-256 + kalkulasi trust score).
- **`POST /api/v1/auth/login`**: Otentikasi dan penerbitan bearer token sesi 30 hari.
- **`GET /api/v1/auth/me`**: Verifikasi profil aktif via header `Authorization: Bearer <token>`.

### Modul Riset & AI:
- **`POST /api/literature/gap-analysis`**: Analisis novelty & kesenjangan riset berbasis DeepSeek + PubMed.
- **`GET /api/v1/template/list`**: Verifikasi query data dan ketersediaan template awal di database.
- **`POST /api/v1/outline/generate`**: Penataan bab dan alokasi target kata otomatis.
- **`POST /api/v1/supervisor/socratic-questions`**: Pertanyaan penguji sidang/supervisor sokratik.
- **`POST /api/v1/supervisor/examiner-simulate`**: Simulasi sidang skripsi interaktif (Dewan Penguji 3 Persona).
- **`POST /api/v1/cascade/calculate` & `snapshot`**: Engine sinkronisasi dependensi antar bab.

---

## 🧪 5. CI/CD Pipeline & Automated Quality Gate

Proyek ini telah dilengkapi dengan workflow otomatis **GitHub Actions** ([`.github/workflows/ci.yml`](file:///.github/workflows/ci.yml)):

### Alur Kerja CI:
1. **Quality Gate (`test-and-lint`)**:
   - Menjalankan `go vet ./...` untuk static analysis.
   - Menjalankan unit tests ber-coverage: `go test -v -race -coverprofile=coverage.out ./...`.
2. **Container Smoke Testing (`docker-smoke-test`)**:
   - Membangun container Docker multi-stage.
   - Melakukan live test ke endpoint `/health`, `/api/v1/auth/login`, `/api/v1/template/list`, dan `/api/v1/supervisor/examiner-simulate`.

### Menjalankan Smoke Test Mandiri (Lokal / Staging Server):
```bash
./scripts/smoke_test.sh http://localhost:8080
```
Jika seluruh endpoint berfungsi dengan baik, skrip akan mengembalikan status `ALL SMOKE TESTS PASSED` dengan *exit code 0*.


