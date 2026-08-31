# ✅ Thesa AI — UAT (User Acceptance Test) Checklist

**Tanggal UAT:** _______________  
**Versi:** 1.0.0  
**Tester:** _______________  
**Environment:** Staging / Production  
**Base URL:** _______________  

---

## 1. Autentikasi & Akun

| # | Skenario | Langkah | Expected Result | Status | Catatan |
|---|---|---|---|---|---|
| 1.1 | Registrasi akun baru | POST `/api/v1/auth/register` dengan email & password | Response `200` + `token` di body | ⬜ | |
| 1.2 | Login akun | POST `/api/v1/auth/login` | Response `200` + `token` | ⬜ | |
| 1.3 | Cek profil aktif | GET `/api/v1/auth/me` dengan Bearer token | Response `200` + data user | ⬜ | |
| 1.4 | Login email salah | POST `/api/v1/auth/login` email invalid | Response `401` | ⬜ | |
| 1.5 | Token expired/invalid | Request dengan token acak | Response `401` | ⬜ | |

---

## 2. Template & Outline

| # | Skenario | Langkah | Expected Result | Status | Catatan |
|---|---|---|---|---|---|
| 2.1 | Daftar template | GET `/api/v1/template/list` | Response `200` + array templates | ⬜ | |
| 2.2 | Generate outline 6 bab | POST `/api/v1/outline/generate` dengan judul skripsi | Response `200` + struktur bab lengkap | ⬜ | |
| 2.3 | Outline dengan tema khusus | Kirim tema "Kecerdasan Buatan untuk Pertanian" | Outline relevan dengan tema | ⬜ | |

---

## 3. Analisis Gap Literatur

| # | Skenario | Langkah | Expected Result | Status | Catatan |
|---|---|---|---|---|---|
| 3.1 | Gap analysis dasar | POST `/api/literature/gap-analysis` | Response `200` + `gaps` list | ⬜ | |
| 3.2 | Gap analysis dengan query spesifik | Kirim judul riset spesifik | Hasil relevan dengan query | ⬜ | |
| 3.3 | Waktu respon | Catat latency response | < 10 detik | ⬜ | |

---

## 4. Modul Supervisor

| # | Skenario | Langkah | Expected Result | Status | Catatan |
|---|---|---|---|---|---|
| 4.1 | Pertanyaan sokratik | POST `/api/v1/supervisor/socratic-questions` | Response `200` + daftar pertanyaan | ⬜ | |
| 4.2 | Simulasi sidang — Pertanyaan | POST `/api/v1/supervisor/examiner-simulate` mode `question` | Response `200` + `question_text` | ⬜ | |
| 4.3 | Simulasi sidang — 3 penguji berbeda | Panggil dengan `examiner.id` berbeda | Karakter & gaya bertanya berbeda | ⬜ | |
| 4.4 | Simulasi sidang — mode `evaluate` | Kirim jawaban mahasiswa | Response berisi evaluasi & feedback | ⬜ | |

---

## 5. Cascade & Sinkronisasi Bab

| # | Skenario | Langkah | Expected Result | Status | Catatan |
|---|---|---|---|---|---|
| 5.1 | Hitung cascade | POST `/api/v1/cascade/calculate` | Response `200` + dependensi antar bab | ⬜ | |
| 5.2 | Snapshot cascade | POST `/api/v1/cascade/snapshot` | Response `200` + snapshot tersimpan | ⬜ | |

---

## 6. Frontend & UX

| # | Skenario | Langkah | Expected Result | Status | Catatan |
|---|---|---|---|---|---|
| 6.1 | Landing page load | Buka URL utama | Landing page tampil dalam < 3 detik | ⬜ | |
| 6.2 | Responsivitas mobile | Buka di browser mobile (375px) | Tampilan tidak rusak, elemen terbaca | ⬜ | |
| 6.3 | Alur registrasi dari UI | Klik "Daftar" di landing, isi form | Berhasil login setelah daftar | ⬜ | |
| 6.4 | Aksi generate outline dari UI | Isi form → klik Generate | Outline muncul tanpa error | ⬜ | |
| 6.5 | Export dokumen | Klik tombol Export | File terdownload dengan konten benar | ⬜ | |

---

## 7. Keamanan & Edge Cases

| # | Skenario | Langkah | Expected Result | Status | Catatan |
|---|---|---|---|---|---|
| 7.1 | Rate limiting | Kirim > 60 request/menit | Response `429 Too Many Requests` | ⬜ | |
| 7.2 | Input terlalu panjang | Kirim body JSON > 1MB | Response `413` atau error terkontrol | ⬜ | |
| 7.3 | SQL injection | Kirim `'; DROP TABLE users; --` di field email | Error `400` bukan `500` | ⬜ | |
| 7.4 | XSS di input | Kirim `<script>alert(1)</script>` di field teks | Input disanitasi, tidak di-execute | ⬜ | |

---

## 8. Hasil UAT

| Kategori | Total | Lulus | Gagal |
|---|---|---|---|
| Autentikasi | 5 | | |
| Template & Outline | 3 | | |
| Gap Analysis | 3 | | |
| Supervisor | 4 | | |
| Cascade | 2 | | |
| Frontend | 5 | | |
| Keamanan | 4 | | |
| **TOTAL** | **26** | | |

---

## 9. Sign-off

**Go-Live disetujui oleh:**

| Nama | Jabatan | Tanda Tangan | Tanggal |
|---|---|---|---|
| | Product Owner | | |
| | Tech Lead | | |
| | QA | | |

**Catatan & Bug yang ditemukan selama UAT:**
1. 
2. 
3. 

---

> UAT dinyatakan **LULUS** jika seluruh item critical (1.x, 2.x, 3.x, 4.x) lulus dengan status ✅.
