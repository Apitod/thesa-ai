-- ============================================================
-- THESA AI / RISETHUB BE — Complete Production Database Schema
-- Auto-migrated on startup or initialized via docker-entrypoint-initdb.d
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 0. Users & Authentication Tables
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(255) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `full_name` VARCHAR(255) NOT NULL,
  `institution` VARCHAR(255) DEFAULT '',
  `prodi` VARCHAR(255) DEFAULT '',
  `level` VARCHAR(50) DEFAULT 'S1',
  `tier` VARCHAR(50) DEFAULT 'gold',
  `role` VARCHAR(50) NOT NULL DEFAULT 'user',
  `credits` INT NOT NULL DEFAULT 1,
  `trust_score` INT DEFAULT 85,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_user_email` (`email`),
  INDEX `idx_user_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `token` VARCHAR(255) NOT NULL UNIQUE,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_session_token` (`token`),
  INDEX `idx_session_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 0.1 Payment Orders Table
CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` VARCHAR(100) NOT NULL UNIQUE,
  `user_id` INT NOT NULL,
  `user_email` VARCHAR(255) NOT NULL,
  `package_id` VARCHAR(50) NOT NULL,
  `package_name` VARCHAR(255) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `currency` VARCHAR(10) NOT NULL DEFAULT 'IDR',
  `status` VARCHAR(50) NOT NULL DEFAULT 'pending',
  `payment_type` VARCHAR(50) DEFAULT 'qris',
  `snap_token` VARCHAR(255) DEFAULT '',
  `snap_redirect_url` VARCHAR(500) DEFAULT '',
  `qris_url` TEXT,
  `settled_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_orders_user` (`user_id`),
  INDEX `idx_orders_status` (`status`),
  INDEX `idx_orders_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 0.2 Payment Transactions Callback Log Table
CREATE TABLE IF NOT EXISTS `payment_transactions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` VARCHAR(100) NOT NULL,
  `transaction_id` VARCHAR(100) DEFAULT '',
  `payment_type` VARCHAR(50) DEFAULT '',
  `gross_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `transaction_status` VARCHAR(50) NOT NULL,
  `fraud_status` VARCHAR(50) DEFAULT 'accept',
  `signature_key` VARCHAR(255) DEFAULT '',
  `raw_payload` LONGTEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_trx_order` (`order_id`),
  INDEX `idx_trx_status` (`transaction_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 0.3 LLM Usage & Cost Telemetry Table
CREATE TABLE IF NOT EXISTS `llm_usage_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT DEFAULT 0,
  `provider` VARCHAR(50) NOT NULL,
  `model` VARCHAR(100) NOT NULL,
  `task_type` VARCHAR(100) NOT NULL DEFAULT 'chat',
  `prompt_tokens` INT NOT NULL DEFAULT 0,
  `completion_tokens` INT NOT NULL DEFAULT 0,
  `total_tokens` INT NOT NULL DEFAULT 0,
  `latency_ms` INT NOT NULL DEFAULT 0,
  `cost_idr` DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
  `status` VARCHAR(50) NOT NULL DEFAULT 'success',
  `error_message` TEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_llm_provider` (`provider`),
  INDEX `idx_llm_created` (`created_at`),
  INDEX `idx_llm_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 0.4 Audit Logs Table (Security & Administrative Events)
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT DEFAULT 0,
  `user_email` VARCHAR(255) DEFAULT '',
  `ip_address` VARCHAR(100) NOT NULL DEFAULT '',
  `user_agent` VARCHAR(500) DEFAULT '',
  `action` VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(50) DEFAULT '',
  `entity_id` VARCHAR(100) DEFAULT '',
  `details` TEXT,
  `status` VARCHAR(50) NOT NULL DEFAULT 'success',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_audit_action` (`action`),
  INDEX `idx_audit_created` (`created_at`),
  INDEX `idx_audit_ip` (`ip_address`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1. Research Projects Table
CREATE TABLE IF NOT EXISTS `research_projects` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT DEFAULT 1,
  `title` VARCHAR(255) NOT NULL DEFAULT 'Untitled Project',
  `topic` TEXT,
  `current_stage` INT NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Project Stages Table
CREATE TABLE IF NOT EXISTS `project_stages` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT NOT NULL,
  `stage` VARCHAR(50) NOT NULL,
  `status` VARCHAR(50) NOT NULL DEFAULT 'pending',
  `notes` TEXT,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_project_stage` (`project_id`, `stage`),
  INDEX `idx_stage_status` (`stage`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Version Snapshots Table (Cascade & History Engine)
CREATE TABLE IF NOT EXISTS `version_snapshots` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT NOT NULL,
  `stage` VARCHAR(50) NOT NULL,
  `version` INT NOT NULL DEFAULT 1,
  `content` LONGTEXT,
  `data_json` LONGTEXT,
  `label` VARCHAR(255) DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_snap_proj_stage` (`project_id`, `stage`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Cascade Log Table
CREATE TABLE IF NOT EXISTS `cascade_log` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT NOT NULL,
  `source_stage` VARCHAR(50) NOT NULL,
  `action` VARCHAR(50) NOT NULL,
  `description` TEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_log_proj` (`project_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Skill Reflections Table (Academic Exercises & Insights)
CREATE TABLE IF NOT EXISTS `skill_reflections` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT NOT NULL,
  `reflection` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_reflection_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Thesa Outlines Table (Top-level Outline Records)
CREATE TABLE IF NOT EXISTS `thesa_outlines` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT NOT NULL,
  `outline_data` LONGTEXT NOT NULL,
  `version` INT NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_outline_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Thesis Outline Sections Table (Granular Section Tree)
CREATE TABLE IF NOT EXISTS `thesis_outline` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT NOT NULL,
  `parent_id` INT NOT NULL DEFAULT 0,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `target_words` INT NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(50) NOT NULL DEFAULT 'generated',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_outline_proj_parent` (`project_id`, `parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Research Topics Table
CREATE TABLE IF NOT EXISTS `research_topics` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT NOT NULL,
  `topic` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_topic_proj` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Thesa Projects Table
CREATE TABLE IF NOT EXISTS `thesa_projects` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `topic` TEXT NOT NULL,
  `description` TEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Thesa Gaps Table (Research Gap Analysis Persistence)
CREATE TABLE IF NOT EXISTS `thesa_gaps` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT NOT NULL,
  `gap_summary` LONGTEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_gap_proj` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Thesa Templates & Thesis Templates Tables
CREATE TABLE IF NOT EXISTS `thesa_templates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `institution` VARCHAR(255) DEFAULT '',
  `degree` VARCHAR(50) DEFAULT 'S1',
  `structure_data` LONGTEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `thesis_templates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `institution` VARCHAR(255) DEFAULT '',
  `degree` VARCHAR(50) DEFAULT 'S1',
  `structure_data` LONGTEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Research Papers Table (Local Catalog / Literature Cache)
CREATE TABLE IF NOT EXISTS `research_papers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(500) NOT NULL,
  `authors` TEXT,
  `abstract` LONGTEXT,
  `key_points` TEXT,
  `year` INT DEFAULT 2024,
  `doi` VARCHAR(255) DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_paper_year` (`year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- Default Initial Seed Templates (Idempotent Insert)
-- ============================================================
INSERT INTO `thesa_templates` (`id`, `name`, `institution`, `degree`, `structure_data`, `created_at`, `updated_at`)
VALUES (
  1,
  'Pedoman Penulisan Skripsi Standar Nasional (DIKTI)',
  'Universitas Standar Indonesia',
  'S1',
  '{"institution":"Standar Nasional","degree":"S1","format":"Skripsi Standar","sections":[{"id":1,"title":"BAB I PENDAHULUAN","description":"Latar belakang, rumusan masalah, tujuan, dan batasan penelitian","target_words":2500,"subsections":[{"id":11,"title":"1.1 Latar Belakang Masalah","description":"Konteks dan urgensi fenomena penelitian","target_words":1200},{"id":12,"title":"1.2 Rumusan Masalah","description":"Pertanyaan penelitian utama","target_words":300},{"id":13,"title":"1.3 Tujuan Penelitian","description":"Tujuan umum dan khusus","target_words":300},{"id":14,"title":"1.4 Manfaat Penelitian","description":"Manfaat teoritis dan praktis","target_words":400},{"id":15,"title":"1.5 Batasan Penelitian","description":"Ruang lingkup penelitian","target_words":300}]},{"id":2,"title":"BAB II TINJAUAN PUSTAKA","description":"Landasan teori, penelitian terdahulu, dan kerangka pemikiran","target_words":4000,"subsections":[{"id":21,"title":"2.1 Landasan Teori","description":"Konsep teoritis pendukung","target_words":2000},{"id":22,"title":"2.2 Penelitian Terdahulu / State of the Art","description":"Review literatur relevan","target_words":1200},{"id":23,"title":"2.3 Kerangka Pemikiran","description":"Alur logika teoritis","target_words":500},{"id":24,"title":"2.4 Hipotesis / Proposisi Penelitian","description":"Dugaan awal penelitian jika ada","target_words":300}]},{"id":3,"title":"BAB III METODOLOGI PENELITIAN","description":"Desain penelitian, data, instrumen, dan teknik analisis","target_words":3000,"subsections":[{"id":31,"title":"3.1 Desain dan Pendekatan Penelitian","description":"Kuantitatif / Kualitatif / Mixed Method","target_words":800},{"id":32,"title":"3.2 Populasi, Sampel, atau Sumber Data","description":"Subjek atau objek penelitian","target_words":800},{"id":33,"title":"3.3 Teknik Pengumpulan Data","description":"Prosedur dan instrumen riset","target_words":700},{"id":34,"title":"3.4 Teknik Analisis Data","description":"Metode analisis komputasi atau statistik","target_words":700}]},{"id":4,"title":"BAB IV HASIL DAN PEMBAHASAN","description":"Penyajian temuan, analisis mendalam, dan diskusi komparatif","target_words":5000,"subsections":[{"id":41,"title":"4.1 Gambaran Umum & Hasil Analisis","description":"Data temuan empiris","target_words":2500},{"id":42,"title":"4.2 Pembahasan & Diskusi Akademik","description":"Sintesis temuan dengan teori dan penelitian terdahulu","target_words":2500}]},{"id":5,"title":"BAB V KESIMPULAN DAN SARAN","description":"Sintesis akhir temuan dan rekomendasi penelitian lanjutan","target_words":1500,"subsections":[{"id":51,"title":"5.1 Kesimpulan","description":"Jawaban komprehensif atas rumusan masalah","target_words":800},{"id":52,"title":"5.2 Saran & Rekomendasi","description":"Saran praktis dan riset mendatang","target_words":700}]}]}',
  NOW(),
  NOW()
) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `structure_data` = VALUES(`structure_data`);

INSERT INTO `thesis_templates` (`id`, `name`, `institution`, `degree`, `structure_data`, `created_at`, `updated_at`)
VALUES (
  1,
  'Pedoman Penulisan Skripsi Standar Nasional (DIKTI)',
  'Universitas Standar Indonesia',
  'S1',
  '{"institution":"Standar Nasional","degree":"S1","format":"Skripsi Standar","sections":[{"id":1,"title":"BAB I PENDAHULUAN","description":"Latar belakang, rumusan masalah, tujuan, dan batasan penelitian","target_words":2500},{"id":2,"title":"BAB II TINJAUAN PUSTAKA","description":"Landasan teori, penelitian terdahulu, dan kerangka pemikiran","target_words":4000},{"id":3,"title":"BAB III METODOLOGI PENELITIAN","description":"Desain penelitian, data, instrumen, dan teknik analisis","target_words":3000},{"id":4,"title":"BAB IV HASIL DAN PEMBAHASAN","description":"Penyajian temuan, analisis mendalam, dan diskusi komparatif","target_words":5000},{"id":5,"title":"BAB V KESIMPULAN DAN SARAN","description":"Sintesis akhir temuan dan rekomendasi penelitian lanjutan","target_words":1500}]}',
  NOW(),
  NOW()
) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `structure_data` = VALUES(`structure_data`);

-- ============================================================
-- Seed Administrator Account (admin@thesa.id / thesaAdmin2026!)
-- ============================================================
INSERT INTO `users` (`id`, `email`, `password_hash`, `full_name`, `institution`, `prodi`, `level`, `tier`, `role`, `credits`, `trust_score`, `created_at`, `updated_at`)
VALUES (
  999,
  'admin@thesa.id',
  '08ef28ffab248882a17ffbb3b216ff062a49b6d859d096c4d7ec66d713c7ee80',
  'Thesa System Administrator',
  'Thesa AI Central Operations',
  'Engineering & Analytics',
  'SuperAdmin',
  'platinum',
  'admin',
  9999,
  100,
  NOW(),
  NOW()
) ON DUPLICATE KEY UPDATE `role` = 'admin', `tier` = 'platinum', `credits` = 9999;
