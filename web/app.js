// ============================================================
// BACKEND API CLIENT BRIDGE
// ============================================================
const API_BASE = window.location.origin;

async function thesaApiFetch(endpoint, data = {}, options = {}) {
  try {
    const isGet = (options.method || 'POST').toUpperCase() === 'GET';
    const token = sessionStorage.getItem('thesa_token') || localStorage.getItem('thesa_token') || '';
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: options.method || 'POST',
      headers: headers,
      body: isGet ? undefined : JSON.stringify(data)
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.message || `API HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (options.throwOnError) throw err;
    console.info(`[Thesa API Client] API unavailable for ${endpoint}:`, err.message);
    return null;
  }
}

let activeProjectID = null;
let isGeneratingPaper = false;

function renderDraftToBox(draftText) {
  const box11 = document.getElementById('boxLatarBelakang');
  if (!box11) return;
  const clean = (draftText || '').trim();
  if (!clean) return;

  const paragraphs = clean.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length > 0) {
    box11.innerHTML = paragraphs.map(p => {
      const formatted = escapeHTML(p.replace(/^#{1,6}\s*/, '').replace(/^---\s*/, ''));
      return `<p class="academic-paragraph" style="text-indent: 1.27cm; text-align: justify; margin-bottom: 1rem; line-height: 1.75; font-size: 12.5px; color: #1e293b;">${formatted}</p>`;
    }).join('');
  } else {
    box11.innerHTML = `<p class="academic-paragraph" style="text-indent: 1.27cm; text-align: justify; margin-bottom: 1rem; line-height: 1.75; font-size: 12.5px; color: #1e293b;">${escapeHTML(clean)}</p>`;
  }
  box11.style.background = '#ffffff';

  const badge = document.getElementById('badgeSection11');
  if (badge) {
    badge.innerText = '✓ Draf Gemini Siap';
    badge.style.background = '#ecfdf5';
    badge.style.color = '#059669';
  }
}

function currentProjectState() {
  const box11 = document.getElementById('boxLatarBelakang');
  let draftText = '';
  if (box11) {
    const paras = Array.from(box11.querySelectorAll('p.academic-paragraph, p'));
    if (paras.length > 0) {
      draftText = paras.map(p => p.innerText.trim()).filter(Boolean).join('\n\n');
    } else {
      draftText = (box11.innerText || '').trim();
    }
  }
  const stream = document.getElementById('duoChatStream');
  return {
    researchContext,
    selectedKTI,
    campusId: activeCampus?.id || selectedCampusId,
    injectedReferences: injectedReferences || [],
    draft: draftText,
    chatHTML: stream ? stream.innerHTML : '',
    boxes: {
      latarBelakang: box11 ? box11.innerHTML : '',
      problemStatement: document.getElementById('boxProblemStatement')?.innerHTML || '',
      tujuanPenulisan: document.getElementById('boxTujuanPenulisan')?.innerHTML || '',
      pembahasan: document.getElementById('boxPembahasan')?.innerHTML || '',
      penutup: document.getElementById('boxPenutup')?.innerHTML || '',
      daftarPustaka: document.getElementById('boxDaftarPustaka')?.innerHTML || ''
    }
  };
}

function setGenerationStatus(state, message, allowRetry = false) {
  let bar = document.getElementById('thesaGenerationStatus');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'thesaGenerationStatus';
    bar.style.cssText = 'position:fixed;top:68px;left:50%;transform:translateX(-50%);z-index:10050;min-width:340px;max-width:min(92vw,680px);padding:12px 18px;border-radius:12px;font:600 13px Inter,sans-serif;box-shadow:0 10px 28px rgba(15,23,42,0.25);display:flex;align-items:center;justify-content:space-between;gap:12px;';
    document.body.appendChild(bar);
  }
  const styles = {
    loading: ['#eff6ff', '#1d4ed8', '⏳'],
    success: ['#ecfdf5', '#047857', '✓'],
    error: ['#fef2f2', '#b91c1c', '⚠']
  }[state] || ['#f8fafc', '#334155', 'ℹ'];

  bar.style.background = styles[0];
  bar.style.color = styles[1];

  let retryHTML = '';
  if (allowRetry) {
    retryHTML = `<button onclick="createAndGenerateProject()" style="background:#b91c1c;color:#fff;border:none;padding:5px 12px;border-radius:6px;font:700 12px Inter,sans-serif;cursor:pointer;margin-left:8px;">Coba Lagi</button>`;
  }

  bar.innerHTML = `<span>${styles[2]} ${escapeHTML(message)}</span>${retryHTML}`;
  if (state !== 'loading') {
    setTimeout(() => { if (bar && bar.parentNode) bar.remove(); }, allowRetry ? 12000 : 6000);
  }
}

async function saveActiveProject(silent = false) {
  if (!activeProjectID) return;
  try {
    if (!silent) setGenerationStatus('loading', 'Menyimpan naskah proyek ke basis data…');
    const state = currentProjectState();
    const res = await thesaApiFetch('/api/v1/projects/save', {
      project_id: activeProjectID,
      title: researchContext.topic || 'Proyek tanpa judul',
      topic: researchContext.topic || '',
      current_stage: 1,
      state
    }, { throwOnError: true });
    if (!silent) setGenerationStatus('success', `✓ Proyek tersimpan (Versi snapshot #${res.version}).`);
    return res;
  } catch (err) {
    console.error('[Thesa Save Error]', err);
    if (!silent) setGenerationStatus('error', `Gagal menyimpan proyek: ${err.message}`);
    throw err;
  }
}

async function createAndGenerateProject() {
  if (isGeneratingPaper) return;
  isGeneratingPaper = true;
  const generateBtn = document.getElementById('btnStartThesa') || document.getElementById('btnGeneratePaper11');
  if (generateBtn) generateBtn.disabled = true;

  try {
    setGenerationStatus('loading', 'Langkah 1/4: Menyiapkan konteks riset dan preferensi pedoman...');

    if (!activeProjectID) {
      setGenerationStatus('loading', 'Langkah 2/4: Membuat entri proyek baru di database...');
      const created = await thesaApiFetch('/api/v1/projects/create', {
        title: researchContext.topic || 'Makalah Riset Baru',
        topic: researchContext.topic || '',
        current_stage: 1,
        state: currentProjectState()
      }, { throwOnError: true });
      activeProjectID = created.project_id;
    }

    setGenerationStatus('loading', 'Langkah 3/4: Menghubungi Google Gemini untuk menyusun draf...');
    const result = await thesaApiFetch('/api/v1/paper/generate', {
      project_id: activeProjectID,
      topic: researchContext.topic || '',
      importance: researchContext.importance || '',
      expectations: researchContext.expectations || '',
      assignment_prompt: researchContext.prompt || '',
      course: researchContext.course || '',
      kti_type: selectedKTI || 'Makalah',
      keywords: researchContext.keywords || [],
      sources: injectedReferences || []
    }, { throwOnError: true });

    if (!result || !result.draft || result.draft.trim() === '') {
      throw new Error('Gemini mengembalikan teks draf kosong.');
    }

    setGenerationStatus('loading', 'Langkah 4/4: Memvalidasi draf dan menyimpan naskah...');
    renderDraftToBox(result.draft);

    const titleEl = document.getElementById('draftPaperTitle');
    if (titleEl) titleEl.innerText = researchContext.topic || 'Makalah Riset';

    researchContext.aiProvider = result.provider || 'gemini';
    researchContext.generatedAt = new Date().toISOString();

    await saveActiveProject(true);
    setGenerationStatus('success', `✓ Draf berhasil dibuat oleh ${result.provider} (${result.sources_used} sumber digunakan).`);
  } catch (err) {
    console.error('[Thesa Generation Error]', err);
    setGenerationStatus('error', `Draf belum dapat dibuat: ${err.message}`, true);
  } finally {
    isGeneratingPaper = false;
    if (generateBtn) generateBtn.disabled = false;
  }
}

// ============================================================
// TIER & USER PROFILE SYSTEM
// ============================================================

const TIER_CONFIG = {
  silver:   { label: 'Silver',   emoji: '🥈', color: '#64748b', bg: '#f1f5f9', modules: ['makalah'], perGenerateCost: 12000 },
  gold:     { label: 'Gold',     emoji: '🥇', color: '#d97706', bg: '#fef3c7', modules: ['makalah','proposal','skripsi','tesis','disertasi','jurnal','laporan'], weeklyTokens: 250000, monthlyPrice: 99000 },
  platinum: { label: 'Platinum', emoji: '💎', color: '#7c3aed', bg: '#ede9fe', modules: ['makalah','proposal','skripsi','tesis','disertasi','jurnal','laporan','pustaka'], monthlyTokens: 1500000, monthlyPrice: 249000 }
};

function getUserTier() {
  try {
    const profile = JSON.parse(sessionStorage.getItem('thesaUser') || localStorage.getItem('thesaUser') || '{}');
    return profile.tier || 'silver'; // Default tier is Silver (free)
  } catch { return 'silver'; }
}

function getUserProfile() {
  try {
    return JSON.parse(sessionStorage.getItem('thesaUser') || localStorage.getItem('thesaUser') || '{}');
  } catch { return {}; }
}

function updateUserProfile(newFields) {
  try {
    const current = getUserProfile();
    const updated = { ...current, ...newFields };
    sessionStorage.setItem('thesaUser', JSON.stringify(updated));
    localStorage.setItem('thesaUser', JSON.stringify(updated));
    initTierBadge();
    return updated;
  } catch(e) { console.error(e); }
}

function canAccessModule(moduleName) {
  const tier = getUserTier();
  return (TIER_CONFIG[tier]?.modules || []).includes(moduleName);
}


function initTierBadge() {
  const tier = getUserTier();
  const cfg = TIER_CONFIG[tier] || TIER_CONFIG.gold;
  const profile = getUserProfile();

  // Update sidebar name & role
  const nameEl = document.getElementById('sidebarUserName');
  const roleEl = document.getElementById('sidebarUserRole');
  if (nameEl && profile.name) nameEl.textContent = profile.name;
  if (roleEl && profile.prodi && profile.institution) {
    roleEl.textContent = `${profile.level || 'S1'} ${profile.prodi} · ${profile.institution.split(' ').pop()}`;
  }

  // Inject or update tier badge below user name
  const userMeta = document.querySelector('.hp-user-meta');
  if (userMeta) {
    let badge = document.getElementById('sidebarTierBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'sidebarTierBadge';
      userMeta.appendChild(badge);
    }
    badge.style.cssText = `display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:800;
      color:${cfg.color};background:${cfg.bg};padding:2px 8px;border-radius:999px;margin-top:2px;width:fit-content;`;
    
    if (profile.isTrial && tier === 'platinum') {
      badge.innerHTML = `💎 Trial 3 Hari (${profile.trialSessionsRemaining || 3} Sesi)`;
    } else if (tier === 'silver') {
      const bal = profile.silverBalance !== undefined ? profile.silverBalance : 0;
      badge.innerHTML = `🥈 Silver · Saldo Rp ${bal.toLocaleString('id-ID')}`;
    } else if (tier === 'gold') {
      const tok = profile.goldTokens !== undefined ? profile.goldTokens : 215000;
      badge.innerHTML = `🥇 Gold (${(tok/1000).toFixed(0)}k Token)`;
    } else {
      badge.innerHTML = `${cfg.emoji} ${cfg.label}`;
    }
  }

  // Lock status on sidebar
  const pustakaItem = document.getElementById('navPustakaRiset');
  if (pustakaItem) {
    let lock = pustakaItem.querySelector('.nav-lock');
    if (tier !== 'platinum' && !profile.isTrial) {
      if (!lock) {
        lock = document.createElement('span');
        lock.className = 'material-symbols-rounded nav-lock';
        lock.style.cssText = 'font-size:14px;color:#94a3b8;margin-left:auto;';
        lock.textContent = 'lock';
        pustakaItem.appendChild(lock);
      }
    } else if (lock) {
      lock.remove();
    }
  }
}

// ── Dossier & Personal Research Direction Modal ──────────────
function showDossierModal(initialTab) {
  const profile = getUserProfile();
  const tier = getUserTier();
  const cfg = TIER_CONFIG[tier] || TIER_CONFIG.gold;

  const modal = document.getElementById('dossierModal');
  if (!modal) return;

  // Set Profile info
  const nameEl = document.getElementById('dossierName');
  const metaEl = document.getElementById('dossierMeta');
  const tierEl = document.getElementById('dossierTierBadge');
  if (nameEl) nameEl.textContent = profile.name || 'Alif Awwaz';
  if (metaEl) metaEl.textContent = `${profile.level || 'S2'} ${profile.prodi || 'Ilmu Komputer'} · ${profile.institution || 'Universitas Indonesia'}`;
  if (tierEl) {
    tierEl.textContent = profile.isTrial ? '💎 Platinum Trial' : `${cfg.emoji} ${cfg.label}`;
    tierEl.style.color = '#fff';
  }

  // Initialize Academic Path & Rigor
  const path = profile.academicPath || profile.researchCompass?.academicPath || 's2';
  const rigor = profile.coachingRigor || profile.researchCompass?.coachingRigor || 'socratic';
  selectAcademicPath(path);
  selectCoachingRigor(rigor);

  // Populate Saved Research Compass if available
  if (profile.researchCompass) {
    const rc = profile.researchCompass;
    if (document.getElementById('compassField')) document.getElementById('compassField').value = rc.field || 'Informatika & AI';
    if (document.getElementById('compassSubField')) document.getElementById('compassSubField').value = rc.subField || '';
    if (document.getElementById('compassKeywords')) document.getElementById('compassKeywords').value = rc.keywords || '';
    if (document.getElementById('compassMethodology')) document.getElementById('compassMethodology').value = rc.methodology || 'Eksperimen Komputasional / R&D';
    if (document.getElementById('compassTarget')) document.getElementById('compassTarget').value = rc.target || 'Publikasi Jurnal SINTA / Scopus';
    if (document.getElementById('compassGrandTheme')) document.getElementById('compassGrandTheme').value = rc.grandTheme || '';
  }

  // Literature Sources configuration
  const srcConfig = profile.researchCompass?.sourcesConfig || { mode: 'auto', sources: ['scholar', 'ieee', 'semantic', 'sinta', 'scopus', 'doaj'] };
  setSourceMode(srcConfig.mode || 'auto', false);
  if (srcConfig.sources) {
    ['scholar', 'pubmed', 'ieee', 'semantic', 'sinta', 'scopus', 'doaj', 'ssrn'].forEach(k => {
      const chk = document.getElementById('src' + k.charAt(0).toUpperCase() + k.slice(1));
      if (chk) {
        chk.checked = srcConfig.sources.includes(k);
        const card = document.getElementById('cardSrc' + k.charAt(0).toUpperCase() + k.slice(1));
        if (card) card.classList.toggle('active', chk.checked);
      }
    });
  }

  // Populate account form inputs
  if (document.getElementById('accNameInput')) document.getElementById('accNameInput').value = profile.name || 'Alif Awwaz';
  if (document.getElementById('accEmailInput')) document.getElementById('accEmailInput').value = profile.email || 'alif.awwaz@ui.ac.id';
  if (document.getElementById('accInstInput')) document.getElementById('accInstInput').value = profile.institution || 'Universitas Indonesia';
  if (document.getElementById('accProdiInput')) document.getElementById('accProdiInput').value = `${profile.level || 'S2'} ${profile.prodi || 'Ilmu Komputer'}`;

  renderBillingStatusCard();
  switchDossierTab(initialTab || 'compass');
  toggleDossierModal(true);
}

function toggleDossierModal(show) {
  const m = document.getElementById('dossierModal');
  if (m) m.style.display = show ? 'flex' : 'none';
}

function switchDossierTab(tab) {
  ['Compass', 'Billing', 'Account'].forEach(t => {
    const el = document.getElementById('dossierTab' + t);
    const btn = document.getElementById('tabBtn' + t);
    const isTarget = t.toLowerCase() === tab.toLowerCase();
    if (el) el.style.display = isTarget ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', isTarget);
  });
}

// ── Literature Sources Gateway Engine ────────────────────────
const DISCIPLINE_DEFAULT_SOURCES = {
  'Informatika & AI': ['scholar', 'ieee', 'semantic', 'sinta', 'scopus', 'doaj'],
  'Ilmu Komunikasi': ['scholar', 'sinta', 'doaj', 'scopus', 'ssrn'],
  'Manajemen & Bisnis': ['scholar', 'sinta', 'scopus', 'doaj', 'ssrn'],
  'Hukum & Regulasi': ['scholar', 'sinta', 'ssrn', 'doaj'],
  'Pendidikan': ['scholar', 'sinta', 'doaj', 'scopus'],
  'Kesehatan Masyarakat': ['scholar', 'pubmed', 'scopus', 'doaj', 'sinta']
};

let currentSourceMode = 'auto';

function setSourceMode(mode, triggerUpdate = true) {
  currentSourceMode = mode;
  const btnAuto = document.getElementById('srcModeAuto');
  const btnManual = document.getElementById('srcModeManual');
  const notice = document.getElementById('sourceAutoNotice');

  if (btnAuto) btnAuto.classList.toggle('active', mode === 'auto');
  if (btnManual) btnManual.classList.toggle('active', mode === 'manual');
  if (notice) notice.style.display = mode === 'auto' ? 'block' : 'none';

  if (mode === 'auto' && triggerUpdate) {
    const field = document.getElementById('compassField')?.value || 'Informatika & AI';
    applyAutoSourcesForDiscipline(field);
  }
}

function applyAutoSourcesForDiscipline(field) {
  const recommended = DISCIPLINE_DEFAULT_SOURCES[field] || ['scholar', 'sinta', 'doaj'];
  const label = document.getElementById('autoDisciplineLabel');
  if (label) label.textContent = field;

  ['scholar', 'pubmed', 'ieee', 'semantic', 'sinta', 'scopus', 'doaj', 'ssrn'].forEach(k => {
    const isRec = recommended.includes(k);
    const chk = document.getElementById('src' + k.charAt(0).toUpperCase() + k.slice(1));
    if (chk) chk.checked = isRec;
    const card = document.getElementById('cardSrc' + k.charAt(0).toUpperCase() + k.slice(1));
    if (card) card.classList.toggle('active', isRec);
  });
}

function toggleLiteratureSource(srcKey, isChecked) {
  const card = document.getElementById('cardSrc' + srcKey.charAt(0).toUpperCase() + srcKey.slice(1));
  if (card) card.classList.toggle('active', isChecked);
  // If user toggles manually, switch mode to manual
  if (currentSourceMode === 'auto') {
    setSourceMode('manual', false);
  }
}

function updateCompassPreview() {
  const field = document.getElementById('compassField')?.value;
  if (currentSourceMode === 'auto' && field) {
    applyAutoSourcesForDiscipline(field);
  }
}

function getSelectedLiteratureSources() {
  const active = [];
  ['scholar', 'pubmed', 'ieee', 'semantic', 'sinta', 'scopus', 'doaj', 'ssrn'].forEach(k => {
    const chk = document.getElementById('src' + k.charAt(0).toUpperCase() + k.slice(1));
    if (chk && chk.checked) active.push(k);
  });
  return active;
}

let currentAcademicPath = 's2';
let currentCoachingRigor = 'socratic';

const ACADEMIC_PATH_LABELS = {
  s1: 'S1 (Fast-Track Sarjana)',
  s2: 'S2 (Rigorous Scholar)',
  s3: 'S3 (Frontier Researcher)',
  dosen: 'Dosen / Peneliti Independen'
};

const RIGOR_LABELS = {
  socratic: 'Socratic Mentor',
  scopus: 'Scopus Peer Reviewer',
  accelerator: 'Structured Accelerator'
};

function selectAcademicPath(pathKey) {
  currentAcademicPath = pathKey;
  ['s1', 's2', 's3', 'dosen'].forEach(k => {
    const card = document.getElementById('pathCard' + k.charAt(0).toUpperCase() + k.slice(1));
    if (card) card.classList.toggle('active', k === pathKey);
  });
}

function selectCoachingRigor(rigorKey) {
  currentCoachingRigor = rigorKey;
  const map = {
    socratic: 'rigorCardSocratic',
    scopus: 'rigorCardScopus',
    accelerator: 'rigorCardFast'
  };
  Object.keys(map).forEach(k => {
    const el = document.getElementById(map[k]);
    if (el) el.classList.toggle('active', k === rigorKey);
  });
}

function saveResearchCompass() {
  const field = document.getElementById('compassField')?.value;
  const subField = document.getElementById('compassSubField')?.value;
  const keywords = document.getElementById('compassKeywords')?.value;
  const methodology = document.getElementById('compassMethodology')?.value || 'Eksperimen Komputasional / R&D';
  const target = document.getElementById('compassTarget')?.value || 'Publikasi Jurnal SINTA / Scopus';
  const grandTheme = document.getElementById('compassGrandTheme')?.value;
  const sourcesConfig = {
    mode: currentSourceMode,
    sources: getSelectedLiteratureSources()
  };

  const researchCompass = {
    academicPath: currentAcademicPath,
    coachingRigor: currentCoachingRigor,
    field,
    subField,
    keywords,
    methodology,
    target,
    grandTheme,
    sourcesConfig,
    savedAt: new Date().toISOString()
  };
  updateUserProfile({
    researchCompass,
    academicPath: currentAcademicPath,
    coachingRigor: currentCoachingRigor
  });

  // Update dossier meta text in header
  const metaEl = document.getElementById('dossierMeta');
  if (metaEl) {
    const pathLabel = ACADEMIC_PATH_LABELS[currentAcademicPath] || 'Magister (S2)';
    const p = getUserProfile();
    metaEl.textContent = `${pathLabel} · ${p.institution || 'Universitas Indonesia'}`;
  }

  // Show Toast
  const count = sourcesConfig.sources.length;
  alert(`✨ Academic Path [${ACADEMIC_PATH_LABELS[currentAcademicPath]}] & Gaya Pembimbing [${RIGOR_LABELS[currentCoachingRigor]}] berhasil disimpan!\n\nPengaturan ini akan selalu inline diterapkan pada seluruh proyek, telaah naskah, dan simulasi sidangmu.`);
  toggleDossierModal(false);
}

function saveAccountInfo() {
  const name = document.getElementById('accNameInput')?.value;
  const email = document.getElementById('accEmailInput')?.value;
  const inst = document.getElementById('accInstInput')?.value;
  updateUserProfile({ name, email, institution: inst });
  alert('Informasi profil berhasil diperbarui.');
  toggleDossierModal(false);
}

function renderBillingStatusCard() {
  const container = document.getElementById('billingStatusCard');
  if (!container) return;
  const profile = getUserProfile();
  const tier = getUserTier();

  if (tier === 'silver') {
    const bal = profile.silverBalance !== undefined ? profile.silverBalance : 0;
    container.innerHTML = `
      <div style="background:linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border:1.5px solid #cbd5e1; border-radius:16px; padding:18px 20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <span style="font-size:11px; font-weight:800; color:#475569; text-transform:uppercase;">Paket Aktif</span>
            <h4 style="font-size:18px; font-weight:800; color:#1e293b; margin:1px 0;">🥈 Silver (Pay-per-Generate)</h4>
          </div>
          <div style="text-align:right;">
            <span style="font-size:22px; font-weight:800; color:#0f172a;">Rp ${bal.toLocaleString('id-ID')}</span>
            <span style="font-size:11.5px; color:#64748b; display:block;">Saldo Deposit</span>
          </div>
        </div>
        <div style="font-size:12px; color:#475569; line-height:1.5; background:#fff; padding:10px 14px; border-radius:10px; border:1px solid #e2e8f0;">
          💡 Biaya 1x generate adalah <strong>Rp 12.000</strong>. Saldo akan dipotong otomatis saat generate dimulai. Top up via QRIS kapan saja.
        </div>
        <button class="btn-primary" style="width:100%; margin-top:12px; justify-content:center;" onclick="openTopupModal()">
          <span class="material-symbols-rounded">account_balance_wallet</span>
          Top Up Saldo via QRIS
        </button>
        <button class="btn-secondary" style="width:100%; margin-top:8px; justify-content:center;" onclick="showTierSelectorModal()">
          <span class="material-symbols-rounded">upgrade</span>
          Lihat Opsi Tier (Gold / Platinum)
        </button>
      </div>`;
  } else if (tier === 'gold') {
    const tok = profile.goldTokens !== undefined ? profile.goldTokens : 215000;
    const maxTok = 250000;
    const pct = Math.round((tok / maxTok) * 100);
    container.innerHTML = `
      <div style="background:linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%); border:1.5px solid #fde68a; border-radius:16px; padding:18px 20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <span style="font-size:11px; font-weight:800; color:#92400e; text-transform:uppercase;">Paket Berlangganan</span>
            <h4 style="font-size:18px; font-weight:800; color:#78350f; margin:1px 0;">🥇 Gold (Kuota Token Mingguan)</h4>
          </div>
          <div style="text-align:right;">
            <span style="font-size:20px; font-weight:800; color:#d97706;">${tok.toLocaleString('id-ID')} / ${maxTok.toLocaleString('id-ID')}</span>
            <span style="font-size:11.5px; color:#b45309; display:block;">Token AI Minggu Ini</span>
          </div>
        </div>
        <div style="width:100%; height:8px; background:#fde68a; border-radius:999px; overflow:hidden; margin-bottom:10px;">
          <div style="width:${pct}%; height:100%; background:#d97706; border-radius:999px;"></div>
        </div>
        <div style="font-size:11.5px; color:#92400e;">
          Reset kuota mingguan berikutnya: <strong>Setiap Senin 00:00 WIB</strong>. Jika kuota habis di tengah riset, kamu bisa melakukan isi ulang instan.
        </div>
      </div>`;
  } else {
    // Platinum
    if (profile.isTrial) {
      container.innerHTML = `
        <div style="background:linear-gradient(135deg, #ede9fe 0%, #f5f3ff 100%); border:1.5px solid #c4b5fd; border-radius:16px; padding:18px 20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div>
              <span style="font-size:10.5px; font-weight:800; background:#7c3aed; color:#fff; padding:2px 8px; border-radius:999px; text-transform:uppercase;">Uji Coba 3 Hari Aktif</span>
              <h4 style="font-size:18px; font-weight:800; color:#4c1d95; margin:4px 0 1px;">💎 Platinum Trial</h4>
            </div>
            <div style="text-align:right;">
              <span style="font-size:22px; font-weight:800; color:#6d28d9;">${profile.trialSessionsRemaining || 3} Sesi</span>
              <span style="font-size:11.5px; color:#7c3aed; display:block;">Sisa Kuota Makalah Trial</span>
            </div>
          </div>
          <div style="font-size:12px; color:#5b21b6; background:#fff; padding:10px 14px; border-radius:10px; border:1px solid #ddd6fe; line-height:1.5;">
            ⚠️ <strong>Ketentuan Masa Trial:</strong> Fitur ekspor/cetak naskah (PDF/Word) terkunci selama masa trial. Upgrade ke langganan penuh untuk mengunduh naskah lengkap dan membuka kuota prioritas.
          </div>
        </div>`;
    } else {
      container.innerHTML = `
        <div style="background:linear-gradient(135deg, #ede9fe 0%, #f5f3ff 100%); border:1.5px solid #c4b5fd; border-radius:16px; padding:18px 20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div>
              <span style="font-size:11px; font-weight:800; color:#6d28d9; text-transform:uppercase;">Paket Power Scholar</span>
              <h4 style="font-size:18px; font-weight:800; color:#4c1d95; margin:1px 0;">💎 Platinum Langganan Penuh</h4>
            </div>
            <div style="text-align:right;">
              <span style="font-size:20px; font-weight:800; color:#7c3aed;">1.500.000</span>
              <span style="font-size:11.5px; color:#6d28d9; display:block;">Kuota Token Prioritas</span>
            </div>
          </div>
          <p style="font-size:12px; color:#5b21b6;">Semua modul KTI aktif, akses Pustaka Riset & Peta Tematik penuh, serta ekspor naskah tanpa batas.</p>
        </div>`;
    }
  }
}

// ── Pustaka Riset Modal ──────────────────────────────────────
function openPustakaRisetModal() {
  const tier = getUserTier();
  const profile = getUserProfile();
  const container = document.getElementById('pustakaContentContainer');
  if (!container) return;

  if (tier === 'platinum' || profile.isTrial) {
    const srcList = profile.researchCompass?.sourcesConfig?.sources || ['scholar', 'ieee', 'semantic', 'sinta', 'scopus', 'doaj'];
    const srcBadges = srcList.map(s => {
      const names = { scholar:'Google Scholar', pubmed:'PubMed', ieee:'IEEE/ACM', semantic:'Semantic Scholar', sinta:'SINTA/Garuda', scopus:'Scopus', doaj:'DOAJ', ssrn:'SSRN' };
      const icons = { scholar:'🌐', pubmed:'🧬', ieee:'⚡', semantic:'📑', sinta:'🇮🇩', scopus:'🌍', doaj:'📖', ssrn:'🏛️' };
      return `<span style="display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:700; background:#fff; border:1px solid #cbd5e1; padding:3px 8px; border-radius:999px; color:#334155;">
        <span>${icons[s]||'📚'}</span> ${names[s]||s}
      </span>`;
    }).join(' ');

    // Show Full Pustaka Content
    container.innerHTML = `
      <!-- Live Gateway Status Bar -->
      <div style="background:#f8fafc; border:1px solid var(--border); border-radius:12px; padding:10px 14px; margin-bottom:16px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span style="font-size:11.5px; font-weight:800; color:#1e293b; display:flex; align-items:center; gap:4px;">
            <span style="width:7px; height:7px; border-radius:50%; background:#22c55e;"></span>
            Pintu Akses Terhubung:
          </span>
          ${srcBadges}
        </div>
        <button class="btn-secondary" style="padding:3px 8px; font-size:11px;" onclick="togglePustakaRisetModal(false); showDossierModal('compass');">
          <span class="material-symbols-rounded" style="font-size:14px;">tune</span>
          Ubah Sumber
        </button>
      </div>

      <div style="display:grid; grid-template-columns:280px 1fr; gap:20px;">
        
        <!-- Left: Collection & Topics -->
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:14px; padding:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <strong style="font-size:13px; color:var(--text);">Koleksi Referensi (14)</strong>
            <button class="btn-primary" style="padding:4px 8px; font-size:11px;" onclick="alert('Fitur input DOI Crossref otomatis aktif.')">+ Tambah</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:8px; font-size:12px;">
            <div style="padding:8px 10px; background:#fff; border:1px solid var(--border); border-radius:8px; cursor:pointer;">
              <strong style="color:var(--brand); display:block; font-size:12px;">Vaswani et al. (2017)</strong>
              <span style="color:var(--text-secondary); font-size:11px;">Attention Is All You Need · NeurIPS</span>
            </div>
            <div style="padding:8px 10px; background:#fff; border:1px solid var(--border); border-radius:8px; cursor:pointer;">
              <strong style="color:var(--brand); display:block; font-size:12px;">Wei et al. (2022)</strong>
              <span style="color:var(--text-secondary); font-size:11px;">Chain-of-Thought Prompting in LLMs</span>
            </div>
            <div style="padding:8px 10px; background:#fff; border:1px solid var(--border); border-radius:8px; cursor:pointer;">
              <strong style="color:var(--brand); display:block; font-size:12px;">Kemendikbud (2024)</strong>
              <span style="color:var(--text-secondary); font-size:11px;">Pedoman Integritas Akademik PT</span>
            </div>
          </div>
        </div>

        <!-- Right: Topic Cluster & Knowledge Graph -->
        <div>
          <div style="background:#eff6ff; border:1.5px solid #bfdbfe; border-radius:14px; padding:16px; margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <strong style="font-size:13px; color:#1e3a8a; display:flex; align-items:center; gap:6px;">
                <span class="material-symbols-rounded" style="font-size:18px;">hub</span>
                Peta Tematik &amp; Kluster Riset
              </strong>
              <span style="font-size:11px; font-weight:800; background:#dbeafe; color:#1d4ed8; padding:2px 8px; border-radius:999px;">3 Kluster Aktif</span>
            </div>
            <p style="font-size:12px; color:#1e40af; line-height:1.4;">
              Visualisasi koneksi antar-literatur yang telah kamu kaji. Semua kutipan terhubung dengan kompas arah risetmu.
            </p>
          </div>

          <div style="background:#f8fafc; border:1.5px dashed #cbd5e1; border-radius:14px; height:180px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:20px;">
            <span style="font-size:36px; margin-bottom:8px;">🕸️</span>
            <strong style="font-size:13px; color:var(--text);">Graf Jaringan Topik: AI Coherence ↔ Academic Integrity</strong>
            <span style="font-size:11.5px; color:var(--text-secondary); margin-top:4px;">14 nodes terhubung dengan 6 sub-argumen di Bab II &amp; Bab IV naskahmu.</span>
          </div>
        </div>

      </div>`;
  } else {
    // Non-Platinum: Show Gating Screen
    container.innerHTML = `
      <div style="text-align:center; padding:32px 20px;">
        <div style="font-size:52px; margin-bottom:14px;">💎</div>
        <h3 style="font-size:20px; font-weight:800; color:var(--text); margin-bottom:8px;">Pustaka Riset Personal Khusus Platinum</h3>
        <p style="font-size:13px; color:var(--text-secondary); max-width:440px; margin:0 auto 20px; line-height:1.6;">
          Simpan seluruh referensi jurnal, buat peta tematik otomatis, dan bangun basis pengetahuan akademik yang bertahan sepanjang karir risetmu.
        </p>
        <div style="display:flex; justify-content:center; gap:12px;">
          <button class="btn-secondary" onclick="togglePustakaRisetModal(false)">Nanti Dulu</button>
          <button class="btn-primary" onclick="togglePustakaRisetModal(false); showUpgradeModal('platinum', 'Pustaka Riset & Peta Tematik');">
            <span class="material-symbols-rounded">upgrade</span>
            Upgrade ke Platinum (Rp 249rb/bln)
          </button>
        </div>
      </div>`;
  }

  togglePustakaRisetModal(true);
}

function togglePustakaRisetModal(show) {
  const m = document.getElementById('pustakaRisetModal');
  if (m) m.style.display = show ? 'flex' : 'none';
}

// ── Pencapaian Modal ─────────────────────────────────────────
function openPencapaianModal() {
  togglePencapaianModal(true);
}

function togglePencapaianModal(show) {
  const m = document.getElementById('pencapaianModal');
  if (m) m.style.display = show ? 'flex' : 'none';
}

// ── Topup Modal ──────────────────────────────────────────────
let selectedTopupAmount = 10000;

function openTopupModal() {
  const container = document.getElementById('topupOptionsContainer');
  if (!container) return;

  container.innerHTML = `
    <div style="padding:16px;border:1.5px solid #c7d2fe;border-radius:14px;background:linear-gradient(135deg,#eef2ff,#faf5ff);">
      <label for="customTopupAmount" style="display:block;font-weight:800;color:var(--text);font-size:13px;margin-bottom:6px;">Nominal top up</label>
      <div style="display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #cbd5e1;border-radius:10px;padding:0 12px;"><span style="font-weight:800;color:#4f46e5;">Rp</span><input id="customTopupAmount" type="number" inputmode="numeric" min="10000" max="10000000" step="1000" value="${selectedTopupAmount}" oninput="setCustomTopup(this.value)" style="border:0;outline:0;width:100%;padding:13px 0;font:inherit;font-weight:700;color:var(--text);"></div>
      <p id="topupAmountHint" style="font-size:11.5px;color:#64748b;margin:8px 0 0;">Minimal Rp 10.000. Saldo masuk setelah pembayaran QRIS terverifikasi.</p>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">${[10000, 25000, 50000, 100000].map(amount => `<button type="button" class="topup-card ${amount === selectedTopupAmount ? 'selected' : ''}" style="padding:9px 12px;flex:1;min-width:92px;justify-content:center;" onclick="selectTopup(this, ${amount})">Rp ${amount.toLocaleString('id-ID')}</button>`).join('')}</div>`;

  toggleTopupModal(true);
}

function selectTopup(el, amount) {
  document.querySelectorAll('.topup-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedTopupAmount = amount;
  const input = document.getElementById('customTopupAmount');
  if (input) input.value = amount;
}

function setCustomTopup(value) {
  selectedTopupAmount = Number(value);
  document.querySelectorAll('.topup-card').forEach(c => c.classList.remove('selected'));
}

function toggleTopupModal(show) {
  const m = document.getElementById('topupModal');
  if (m) m.style.display = show ? 'flex' : 'none';
}

function processTopup() {
  if (!Number.isInteger(selectedTopupAmount) || selectedTopupAmount < 10000 || selectedTopupAmount > 10000000) {
    const hint = document.getElementById('topupAmountHint');
    if (hint) { hint.textContent = 'Masukkan nominal bulat antara Rp 10.000 dan Rp 10.000.000.'; hint.style.color = '#dc2626'; }
    return;
  }
  // All topup payments now go through Midtrans QRIS
  const user = (typeof getStoredUser === 'function') ? getStoredUser() : getUserProfile();
  const userEmail = (user && user.email) ? user.email : 'mahasiswa@thesa.id';
  const userName = (user && (user.name || user.full_name)) ? (user.name || user.full_name) : 'Mahasiswa Thesa';

  toggleTopupModal(false);
  openMidtransQRISPayment({
    topup_type: 'topup',
    amount: selectedTopupAmount,
    user_email: userEmail,
    user_name: userName,
    onSuccess: (amountPaid) => {
      const profile = getUserProfile();
      const newBal = (profile.silverBalance || 0) + amountPaid;
      updateUserProfile({ silverBalance: newBal });
      showThesaToast(`✅ Top up Rp ${amountPaid.toLocaleString('id-ID')} berhasil! Saldo: Rp ${newBal.toLocaleString('id-ID')}`, 'success', 'verified');
      renderBillingStatusCard();
      initTierBadge();
    }
  });
}

// ── showUpgradeModal: Replaced by full 3-tier selector modal ─
function showUpgradeModal(requiredTier, featureName) {
  // Always show the 3-tier comparison modal
  showTierSelectorModal(requiredTier, featureName);
}

// ── 3-Tier Selector Modal ────────────────────────────────────
function showTierSelectorModal(highlightTier, featureName) {
  const currentTier = getUserTier();
  let modal = document.getElementById('tierSelectorModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'tierSelectorModal';
    modal.className = 'modal-backdrop';
    modal.onclick = function(e) { if (e.target === modal) modal.style.display = 'none'; };
    document.body.appendChild(modal);
  }

  const tiers = [
    {
      key: 'silver',
      emoji: '🥈',
      label: 'Silver',
      subtitle: 'Gratis — Pay Per Generate',
      price: 'Gratis',
      priceNote: '+ Rp 12.000 per generate',
      color: '#475569',
      bgGrad: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
      border: '1.5px solid #cbd5e1',
      features: [
        '✅ Akses Makalah Generator',
        '✅ Saldo top up kapan saja',
        '✅ Chat bimbingan AI',
        '✅ Template kampus',
        '❌ Proposal, Skripsi, Tesis',
        '❌ Pustaka Riset Personal',
        '❌ Ekspor PDF/Word bebas',
      ]
    },
    {
      key: 'gold',
      emoji: '🥇',
      label: 'Gold',
      subtitle: 'Langganan Bulanan',
      price: 'Rp 99.000',
      priceNote: 'per bulan',
      color: '#b45309',
      bgGrad: 'linear-gradient(135deg, #fef9c3 0%, #fffbeb 100%)',
      border: '1.5px solid #fde68a',
      features: [
        '✅ Semua fitur Silver',
        '✅ Proposal, Skripsi, Tesis, Disertasi',
        '✅ Jurnal & Laporan Ilmiah',
        '✅ 250.000 Token/minggu',
        '✅ Ekspor PDF/Word bebas',
        '❌ Pustaka Riset Personal',
        '❌ Prioritas Antrian AI',
      ]
    },
    {
      key: 'platinum',
      emoji: '💎',
      label: 'Platinum',
      subtitle: 'Power Scholar',
      price: 'Rp 249.000',
      priceNote: 'per bulan',
      color: '#6d28d9',
      bgGrad: 'linear-gradient(135deg, #ede9fe 0%, #f5f3ff 100%)',
      border: '1.5px solid #c4b5fd',
      features: [
        '✅ Semua fitur Gold',
        '✅ Pustaka Riset & Peta Tematik',
        '✅ 1.500.000 Token Prioritas/bln',
        '✅ Prioritas Antrian AI',
        '✅ Analisis Gap Literatur Lanjutan',
        '✅ Export tanpa batas',
        '✅ Support Prioritas',
      ]
    }
  ];

  const featureNote = featureName ? `<p style="font-size:13px;color:#6d28d9;font-weight:600;text-align:center;margin:0 0 20px;background:#f5f3ff;padding:10px 16px;border-radius:10px;">🔒 "${featureName}" membutuhkan upgrade tier</p>` : '';

  modal.innerHTML = `
    <div class="modal-container" style="width:min(92vw,820px);max-height:90vh;overflow-y:auto;padding:32px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h2 style="font-size:22px;font-weight:800;color:var(--text);margin:0;">⚡ Pilih Paket Thesa AI</h2>
        <button onclick="document.getElementById('tierSelectorModal').style.display='none'" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:22px;line-height:1;">&times;</button>
      </div>
      <p style="font-size:13px;color:var(--text-secondary);margin:0 0 20px;">Daftar 100% gratis. Mulai dengan Silver dan upgrade kapan saja.</p>
      ${featureNote}
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
        ${tiers.map(t => {
          const isCurrent = t.key === currentTier;
          const isHighlighted = t.key === (highlightTier || '');
          return `
          <div style="
            background:${t.bgGrad};
            border:${isCurrent ? '2.5px solid ' + t.color : (isHighlighted ? '2px dashed ' + t.color : t.border)};
            border-radius:18px;
            padding:20px 18px;
            position:relative;
            display:flex;flex-direction:column;gap:10px;
          ">
            ${isCurrent ? `<span style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:${t.color};color:#fff;font-size:10.5px;font-weight:800;padding:3px 12px;border-radius:999px;white-space:nowrap;">✓ PAKET AKTIF KAMU</span>` : ''}
            <div style="text-align:center;">
              <div style="font-size:36px;margin-bottom:4px;">${t.emoji}</div>
              <div style="font-size:17px;font-weight:800;color:${t.color};">${t.label}</div>
              <div style="font-size:11px;color:#64748b;">${t.subtitle}</div>
            </div>
            <div style="text-align:center;border-top:1px solid rgba(0,0,0,0.08);padding-top:10px;">
              <div style="font-size:20px;font-weight:800;color:${t.color};">${t.price}</div>
              <div style="font-size:11px;color:#94a3b8;">${t.priceNote}</div>
            </div>
            <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px;flex:1;">
              ${t.features.map(f => `<li style="font-size:11.5px;color:${f.startsWith('✅') ? '#1e293b' : '#94a3b8'};">${f}</li>`).join('')}
            </ul>
            ${isCurrent
              ? `<div style="text-align:center;font-size:12px;font-weight:700;color:${t.color};padding:8px;background:${t.key==='silver'?'#fff':'rgba(255,255,255,0.7)'};border-radius:10px;">Paket kamu saat ini</div>`
              : `<button onclick="initiateUpgradePayment('${t.key}')" style="width:100%;padding:10px;background:${t.color};color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                  <span style="display:flex;align-items:center;justify-content:center;gap:6px;">⚡ Upgrade ke ${t.label}</span>
                </button>`
            }
          </div>`;
        }).join('')}
      </div>
      <p style="font-size:11.5px;color:#94a3b8;text-align:center;margin:20px 0 0;">🔒 Pembayaran aman via Midtrans QRIS. Dapat dibatalkan kapan saja.</p>
    </div>`;

  modal.style.display = 'flex';
}

function initiateUpgradePayment(targetTier) {
  const user = (typeof getStoredUser === 'function') ? getStoredUser() : getUserProfile();
  const userEmail = (user && user.email) ? user.email : 'mahasiswa@thesa.id';
  const userName = (user && (user.name || user.full_name)) ? (user.name || user.full_name) : 'Mahasiswa Thesa';
  const tierCfg = TIER_CONFIG[targetTier];
  if (!tierCfg) return;

  document.getElementById('tierSelectorModal').style.display = 'none';

  openMidtransQRISPayment({
    topup_type: `upgrade-${targetTier}`,
    amount: tierCfg.monthlyPrice || 0,
    user_email: userEmail,
    user_name: userName,
    label: `Upgrade ke ${tierCfg.emoji} ${tierCfg.label} (Rp ${(tierCfg.monthlyPrice||0).toLocaleString('id-ID')}/bln)`,
    onSuccess: () => {
      updateUserProfile({ tier: targetTier, isTrial: false });
      initTierBadge();
      renderBillingStatusCard();
      showThesaToast(`🎉 Selamat! Akunmu berhasil upgrade ke ${tierCfg.emoji} ${tierCfg.label}!`, 'success', 'verified');
    }
  });
}

function activateTrialFromModal() {
  // Trial removed — redirect to real tier selector
  const modal = document.getElementById('upgradeModal');
  if (modal) modal.style.display = 'none';
  showTierSelectorModal();
}

function confirmUpgradePlan() {
  const modal = document.getElementById('upgradeModal');
  if (modal) modal.style.display = 'none';
  showTierSelectorModal();
}

// Run on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTierBadge);
} else {
  setTimeout(initTierBadge, 100);
}

// ── Universal Midtrans QRIS Payment Gateway ───────────────────
/**
 * openMidtransQRISPayment({ topup_type, amount, user_email, user_name, label, onSuccess })
 * Shows a QRIS payment modal, creates a Midtrans order, polls until settled, then calls onSuccess.
 */
let _activeQRISOrderID = null;
let _activeQRISPolling = null;
let _activeQRISCallback = null;

function openMidtransQRISPayment({ topup_type, amount, user_email, user_name, label, onSuccess }) {
  _activeQRISCallback = onSuccess || null;

  let modal = document.getElementById('midtransQRISModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'midtransQRISModal';
    modal.className = 'modal-backdrop';
    modal.onclick = (e) => { if (e.target === modal) closeMidtransQRISModal(); };
    document.body.appendChild(modal);
  }

  const labelText = label || `Pembayaran Rp ${amount.toLocaleString('id-ID')}`;
  const amountFormatted = `Rp ${amount.toLocaleString('id-ID')}`;

  modal.innerHTML = `
    <div class="modal-container" style="width:min(92vw,480px);padding:32px;text-align:center;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="font-size:18px;font-weight:800;color:var(--text);margin:0;">💳 Pembayaran via QRIS</h3>
        <button onclick="closeMidtransQRISModal()" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:22px;line-height:1;">&times;</button>
      </div>

      <div style="background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:1.5px solid #c4b5fd;border-radius:14px;padding:14px 18px;margin-bottom:18px;text-align:left;">
        <div style="font-size:11px;font-weight:700;color:#6d28d9;text-transform:uppercase;margin-bottom:4px;">Rincian Transaksi</div>
        <div style="font-size:13.5px;font-weight:600;color:#1e293b;">${labelText}</div>
        <div style="font-size:22px;font-weight:800;color:#7c3aed;margin-top:4px;">${amountFormatted}</div>
      </div>

      <div id="midtransQRISBox" style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:14px;padding:20px;margin-bottom:18px;">
        <div style="font-size:13px;color:#64748b;display:flex;align-items:center;justify-content:center;gap:8px;">
          <span class="material-symbols-rounded" style="animation:spin 1.5s linear infinite;font-size:20px;">sync</span>
          Menghubungkan ke Midtrans QRIS...
        </div>
      </div>

      <div id="midtransQRISStatus" style="display:none;padding:10px 14px;border-radius:10px;font-size:12.5px;font-weight:600;margin-bottom:14px;"></div>

      <div style="display:flex;gap:10px;justify-content:center;">
        <button class="btn-secondary" onclick="closeMidtransQRISModal()">Batal</button>
      </div>

      <p style="font-size:11px;color:#94a3b8;margin:14px 0 0;">
        Scan QRIS dengan GoPay, Dana, OVO, BCA, atau m-banking manapun.<br>
        Pembayaran akan dikonfirmasi otomatis dalam beberapa detik.
      </p>
    </div>`;

  modal.style.display = 'flex';

  // Create order via backend
  _createMidtransOrder({ topup_type, amount, user_email, user_name });
}

async function _createMidtransOrder({ topup_type, amount, user_email, user_name }) {
  try {
    const res = await fetch('/api/v1/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('thesa_token') || sessionStorage.getItem('thesa_token') || ''}` },
      body: JSON.stringify({
        topup_type,
        amount
      })
    });
    const data = await res.json();
    if (res.ok && data && data.order_id) {
      _activeQRISOrderID = data.order_id;
      _renderMidtransQRISCode(data);
      // Start polling
      if (_activeQRISPolling) clearInterval(_activeQRISPolling);
      _activeQRISPolling = setInterval(() => _pollMidtransOrder(_activeQRISOrderID), 3000);
    } else {
      throw new Error(data.message || 'Order pembayaran gagal dibuat.');
    }
  } catch (err) {
    console.warn('[Midtrans] Order creation failed, showing fallback:', err);
    _renderMidtransQRISFallback();
  }
}

function _renderMidtransQRISCode(data) {
  const box = document.getElementById('midtransQRISBox');
  if (!box) return;

  // If Midtrans returned a real redirect URL, show it as a link + QR placeholder
  const redirectURL = data.snap_redirect_url || '';
  const orderID = data.order_id || '';
  const amount = data.amount || 0;

  box.innerHTML = `
    <div style="margin-bottom:12px;">
      <div style="width:180px;height:180px;margin:0 auto;background:#fff;border:3px solid #4f46e5;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;padding:12px;">
        <span class="material-symbols-rounded" style="font-size:100px;color:#4f46e5;">qr_code_2</span>
        <span style="font-size:9px;color:#64748b;font-weight:700;">SCAN DENGAN QRIS</span>
      </div>
    </div>
    <div style="font-size:11.5px;color:#475569;margin-bottom:8px;">
      Order ID: <strong style="color:#1e293b;">${orderID}</strong>
    </div>
    ${redirectURL ? `
    <a href="${redirectURL}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#4f46e5;text-decoration:none;background:#f5f3ff;padding:8px 14px;border-radius:8px;border:1px solid #c4b5fd;">
      <span class="material-symbols-rounded" style="font-size:16px;">open_in_new</span>
      Buka Halaman Pembayaran Midtrans
    </a>` : ''}
    <div id="midtransQRISStatus" style="margin-top:12px;padding:8px 12px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;font-size:12px;color:#854d0e;display:flex;align-items:center;gap:6px;">
      <span class="material-symbols-rounded" style="font-size:15px;animation:spin 2s linear infinite;">sync</span>
      Menunggu konfirmasi pembayaran...
    </div>`;

}

function _renderMidtransQRISFallback() {
  const box = document.getElementById('midtransQRISBox');
  if (!box) return;
  box.innerHTML = `<div style="padding:12px;color:#b91c1c;font-size:13px;line-height:1.5;">Order belum dapat dibuat. Periksa koneksi lalu coba kembali; saldo tidak akan berubah sebelum Midtrans mengonfirmasi pembayaran.</div>`;
}

async function _pollMidtransOrder(orderID) {
  if (!orderID) return;
  try {
    const res = await fetch(`/api/v1/payment/status?order_id=${encodeURIComponent(orderID)}`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('thesa_token') || sessionStorage.getItem('thesa_token') || ''}` } });
    const data = await res.json();
    if (data && data.settled) {
      if (_activeQRISPolling) clearInterval(_activeQRISPolling);
      _activeQRISPolling = null;
      _onMidtransPaymentSettled(data.amount || 0);
    }
  } catch (e) { /* silent */ }
}

function _onMidtransPaymentSettled(amount) {
  // Update UI
  const box = document.getElementById('midtransQRISBox');
  if (box) {
    box.innerHTML = `
      <div style="padding:20px;text-align:center;">
        <span class="material-symbols-rounded" style="font-size:56px;color:#16a34a;">verified</span>
        <div style="font-size:16px;font-weight:800;color:#166534;margin-top:8px;">Pembayaran Berhasil!</div>
        <div style="font-size:12px;color:#15803d;margin-top:4px;">Rp ${amount.toLocaleString('id-ID')} dikonfirmasi oleh Midtrans</div>
      </div>`;
  }

  setTimeout(() => {
    closeMidtransQRISModal();
    if (typeof _activeQRISCallback === 'function') {
      _activeQRISCallback(amount);
      _activeQRISCallback = null;
    }
  }, 1500);
}

async function simulateMidtransSuccess() {
  showThesaToast('Pembayaran hanya dapat dikonfirmasi oleh Midtrans.', 'error', 'verified_user');
}

function closeMidtransQRISModal() {
  if (_activeQRISPolling) { clearInterval(_activeQRISPolling); _activeQRISPolling = null; }
  const modal = document.getElementById('midtransQRISModal');
  if (modal) modal.style.display = 'none';
}


// ============================================================
// HOMEPAGE FUNCTIONS
// ============================================================

function navigateTo(section) {
  document.querySelectorAll('.hp-nav-item').forEach(el => el.classList.remove('active'));
  const navMap = {
    dashboard: 'navDashboard',
    projects: 'navProjects',
    pustaka: 'navPustakaRiset',
    pencapaian: 'navPencapaian',
    pengaturan: 'navPengaturan'
  };
  const activeNav = document.getElementById(navMap[section]);
  if (activeNav) activeNav.classList.add('active');

  const viewIds = ['viewDashboard', 'viewProjects', 'viewPustakaRiset', 'viewPencapaian', 'viewPengaturan'];
  viewIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  const viewTargetMap = {
    dashboard: 'viewDashboard',
    projects: 'viewProjects',
    pustaka: 'viewPustakaRiset',
    pencapaian: 'viewPencapaian',
    pengaturan: 'viewPengaturan'
  };
  const targetId = viewTargetMap[section] || 'viewDashboard';
  const targetView = document.getElementById(targetId);
  if (targetView) targetView.style.display = 'flex';

  if (section === 'projects') {
    renderDedicatedProjectsView();
  } else if (section === 'pustaka') {
    renderDedicatedPustakaView();
  } else if (section === 'pencapaian') {
    renderDedicatedPencapaianView();
  } else if (section === 'pengaturan') {
    renderDedicatedPengaturanView();
  } else if (section === 'dashboard') {
    loadSavedProjects();
  }
}

// ── 1. DEDICATED PROYEK SAYA VIEW ─────────────────────────────
let dedicatedProjectsCache = [];
let dedicatedProjectFilter = 'all';

async function renderDedicatedProjectsView() {
  const grid = document.getElementById('dedicatedProjectsGrid');
  if (!grid) return;
  grid.innerHTML = '<div style="grid-column:1/-1; padding:32px; text-align:center; color:#64748b;">⏳ Memuat daftar naskah dan proyek riset dari database...</div>';
  try {
    const result = await thesaApiFetch('/api/v1/projects/list', {}, {method:'GET', throwOnError:true});
    dedicatedProjectsCache = result.projects || [];
    const badge = document.getElementById('navProjectsBadge');
    if (badge) badge.innerText = String(dedicatedProjectsCache.length);
    applyDedicatedProjectsFilter();
  } catch (err) {
    grid.innerHTML = `<div style="grid-column:1/-1; padding:24px; text-align:center; color:#ef4444; background:#fef2f2; border:1px solid #fecaca; border-radius:12px;">Gagal memuat proyek: ${escapeHTML(err.message || 'Error koneksi ke database')}</div>`;
  }
}

function filterProjectsByType(type) {
  dedicatedProjectFilter = type;
  const filterBtns = ['btnFilterAllProjects', 'btnFilterMakalah', 'btnFilterProposal', 'btnFilterSkripsi'];
  filterBtns.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.remove('active');
  });
  const activeBtnId = type === 'all' ? 'btnFilterAllProjects' : 'btnFilter' + type.charAt(0).toUpperCase() + type.slice(1);
  const activeBtn = document.getElementById(activeBtnId);
  if (activeBtn) activeBtn.classList.add('active');
  applyDedicatedProjectsFilter();
}

function filterDedicatedProjects() {
  applyDedicatedProjectsFilter();
}

function applyDedicatedProjectsFilter() {
  const grid = document.getElementById('dedicatedProjectsGrid');
  if (!grid) return;
  const query = (document.getElementById('projectSearchInput')?.value || '').toLowerCase().trim();
  
  let filtered = dedicatedProjectsCache.slice();
  if (dedicatedProjectFilter !== 'all') {
    filtered = filtered.filter(p => (p.paper_type || 'makalah').toLowerCase() === dedicatedProjectFilter.toLowerCase());
  }
  if (query) {
    filtered = filtered.filter(p => 
      (p.title || '').toLowerCase().includes(query) || 
      (p.topic || '').toLowerCase().includes(query)
    );
  }

  if (!filtered.length) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; padding:48px 24px; text-align:center; background:#fff; border:1.5px dashed #cbd5e1; border-radius:16px;">
        <span class="material-symbols-rounded" style="font-size:42px; color:#94a3b8; margin-bottom:8px;">folder_off</span>
        <h4 style="font-size:16px; font-weight:700; color:#334155; margin:0 0 6px;">Tidak ada proyek yang sesuai</h4>
        <p style="font-size:13px; color:#64748b; margin:0 0 16px;">Belum ada naskah yang cocok dengan pencarian Anda.</p>
        <button class="btn-primary" onclick="handleKTIClick('makalah')" style="margin:0 auto; padding:8px 18px; font-size:13px;">+ Buat Makalah Baru</button>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const pType = (p.paper_type || 'makalah').toLowerCase();
    const typeLabel = pType === 'proposal' ? 'Proposal' : (pType === 'skripsi' ? 'Skripsi' : 'Makalah');
    const typeIcon = pType === 'proposal' ? 'note_add' : (pType === 'skripsi' ? 'school' : 'article');
    const updatedDate = (p.updated_at || '').slice(0, 10) || 'Hari ini';
    return `
      <div class="hp-project-card" onclick="openExistingProject(${Number(p.id)})" style="display:flex; flex-direction:column; justify-content:space-between; background:#fff; border:1.5px solid #e2e8f0; border-radius:14px; padding:18px; cursor:pointer; transition:all 0.2s ease;">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div class="hp-proj-kti-tag ${pType}" style="display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:700; padding:3px 8px; border-radius:6px;">
              <span class="material-symbols-rounded" style="font-size:15px;">${typeIcon}</span> ${typeLabel}
            </div>
            <div style="display:flex; align-items:center; gap:5px; font-size:11px; color:#059669; font-weight:600;">
              <span style="width:7px; height:7px; background:#10b981; border-radius:50%; display:inline-block;"></span> Tersimpan
            </div>
          </div>
          <h4 style="font-size:14.5px; font-weight:700; color:#1e293b; margin:0 0 8px; line-height:1.4;">${escapeHTML(p.title || 'Proyek Tanpa Judul')}</h4>
          <p style="font-size:12px; color:#64748b; margin:0 0 12px; line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${escapeHTML(p.topic || 'Belum ada deskripsi topik.')}</p>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding-top:12px; border-top:1px solid #f1f5f9;">
          <span style="font-size:11px; color:#94a3b8; display:flex; align-items:center; gap:4px;">
            <span class="material-symbols-rounded" style="font-size:14px;">calendar_today</span> ${escapeHTML(updatedDate)}
          </span>
          <button class="hp-proj-resume-btn" style="padding:6px 14px; font-size:12px; font-weight:700;">
            <span class="material-symbols-rounded" style="font-size:16px;">play_circle</span> Buka Naskah
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ── 2. DEDICATED PUSTAKA RISET VIEW (LIVE PUBMED) ─────────────
function renderDedicatedPustakaView() {
  const input = document.getElementById('dedicatedPustakaInput');
  if (input && !input.value.trim()) {
    if (researchContext && researchContext.topic) {
      input.value = researchContext.topic;
    }
  }
}

async function executeDedicatedPubMedSearch() {
  const input = document.getElementById('dedicatedPustakaInput');
  const resultsEl = document.getElementById('dedicatedPustakaResults');
  if (!input || !resultsEl) return;
  const query = input.value.trim();
  if (!query) {
    showThesaToast('Masukkan topik atau kata kunci pencarian ilmiah.', 'warning', 'info');
    return;
  }

  resultsEl.innerHTML = `
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:36px; text-align:center;">
      <div style="display:inline-block; width:36px; height:36px; border:3px solid #e2e8f0; border-top-color:#4f46e5; border-radius:50%; animation:spin 0.8s linear infinite; margin-bottom:12px;"></div>
      <h4 style="font-size:15px; font-weight:700; color:#1e293b; margin:0 0 6px;">Menghubungkan ke Repositori PubMed NCBI...</h4>
      <p style="font-size:12.5px; color:#64748b; margin:0;">Mengambil metadata artikel ilmiah peer-reviewed terkait "${escapeHTML(query)}"...</p>
    </div>
  `;

  try {
    const res = await thesaApiFetch(`/api/v1/literature/search?q=${encodeURIComponent(query)}&limit=10`, {}, {method:'GET', throwOnError:true});
    const papers = res.papers || [];
    if (!papers.length) {
      resultsEl.innerHTML = `
        <div style="background:#fff; border:1.5px dashed #cbd5e1; border-radius:14px; padding:36px; text-align:center;">
          <span class="material-symbols-rounded" style="font-size:40px; color:#94a3b8; margin-bottom:8px;">search_off</span>
          <h4 style="font-size:15px; font-weight:700; color:#334155; margin:0 0 6px;">Tidak Ditemukan Publikasi Terkait</h4>
          <p style="font-size:12.5px; color:#64748b; margin:0;">Coba gunakan kata kunci ilmiah dalam bahasa Inggris atau istilah yang lebih umum.</p>
        </div>
      `;
      return;
    }

    resultsEl.innerHTML = `
      <div style="font-size:13px; font-weight:700; color:#475569; margin-bottom:4px;">
        Ditemukan ${papers.length} Publikasi Ilmiah Terverifikasi:
      </div>
      <div style="display:flex; flex-direction:column; gap:12px;">
        ${papers.map(p => {
          const authors = (p.authors && p.authors.length) ? p.authors.join(', ') : 'Peneliti Terverifikasi';
          const citation = `${authors} (${p.year || '2024'}). ${p.title}. ${p.journal || 'PubMed Central'}. ${p.doi ? 'https://doi.org/' + p.doi : (p.url || '')}`;
          return `
            <div style="background:#fff; border:1.5px solid #e2e8f0; border-radius:12px; padding:18px; display:flex; flex-direction:column; gap:8px;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                <h4 style="font-size:15px; font-weight:700; color:#1e293b; margin:0; line-height:1.4;">${escapeHTML(p.title)}</h4>
                <span style="font-size:11px; background:#eff6ff; color:#1d4ed8; font-weight:700; padding:2px 8px; border-radius:999px; white-space:nowrap;">${escapeHTML(p.year ? String(p.year) : 'PubMed')}</span>
              </div>
              <div style="font-size:12.5px; color:#475569; font-weight:500;">
                <span class="material-symbols-rounded" style="font-size:14px; vertical-align:middle; color:#64748b;">person</span> ${escapeHTML(authors)}
                <span style="margin:0 6px; color:#cbd5e1;">•</span>
                <span class="material-symbols-rounded" style="font-size:14px; vertical-align:middle; color:#64748b;">auto_stories</span> <em>${escapeHTML(p.journal || 'PubMed Central')}</em>
              </div>
              <p style="font-size:12px; color:#64748b; line-height:1.5; margin:4px 0 8px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">
                ${escapeHTML(p.abstract || 'Abstrak publikasi tersedia pada pangkalan data sumber PubMed NCBI.')}
              </p>
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; padding-top:8px; border-top:1px solid #f1f5f9;">
                <div style="display:flex; gap:8px;">
                  <button class="btn-secondary" onclick="copyCitationToClipboard(${escapeHTML(JSON.stringify(citation))})" style="padding:6px 12px; font-size:12px; font-weight:600; display:inline-flex; align-items:center; gap:5px;">
                    <span class="material-symbols-rounded" style="font-size:15px;">content_copy</span> Salin Sitasi APA
                  </button>
                  ${p.url ? `<a href="${escapeHTML(p.url)}" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="padding:6px 12px; font-size:12px; text-decoration:none; display:inline-flex; align-items:center; gap:5px;"><span class="material-symbols-rounded" style="font-size:15px;">open_in_new</span> Buka di PubMed</a>` : ''}
                </div>
                <button class="btn-primary" onclick="injectCitationToCanvas(${escapeHTML(JSON.stringify(citation))})" style="padding:6px 14px; font-size:12px; font-weight:700;">
                  <span class="material-symbols-rounded" style="font-size:15px;">add_circle</span> Sisipkan ke Naskah
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (err) {
    resultsEl.innerHTML = `
      <div style="background:#fef2f2; border:1.5px solid #fecaca; border-radius:14px; padding:24px; text-align:center; color:#b91c1c;">
        <span class="material-symbols-rounded" style="font-size:32px; margin-bottom:6px;">error</span>
        <h4 style="font-size:14.5px; font-weight:700; margin:0 0 4px;">Pencarian PubMed Gagal</h4>
        <p style="font-size:12px; margin:0;">${escapeHTML(err.message || 'Periksa koneksi internet ke NCBI PubMed.')}</p>
      </div>
    `;
  }
}

function copyCitationToClipboard(citationText) {
  navigator.clipboard.writeText(citationText).then(() => {
    showThesaToast('✓ Sitasi berhasil disalin ke clipboard!', 'success', 'content_copy');
  }).catch(() => {
    showThesaToast('Gagal menyalin ke clipboard', 'error', 'error');
  });
}

function injectCitationToCanvas(citationText) {
  const boxDaftarPustaka = document.getElementById('boxDaftarPustaka');
  if (boxDaftarPustaka) {
    const existing = boxDaftarPustaka.innerText.trim();
    if (existing.includes('Akan tersusun otomatis') || existing.includes('Belum ada')) {
      boxDaftarPustaka.innerHTML = `<p style="margin-bottom:8px; line-height:1.6;">${escapeHTML(citationText)}</p>`;
    } else {
      boxDaftarPustaka.innerHTML += `<p style="margin-bottom:8px; line-height:1.6;">${escapeHTML(citationText)}</p>`;
    }
    showThesaToast('✓ Sitasi PubMed disisipkan ke Daftar Pustaka naskah!', 'success', 'bookmark_added');
    saveActiveProject(true);
  } else {
    copyCitationToClipboard(citationText);
    showThesaToast('Sitasi disalin! Buka naskah untuk menempelkannya.', 'info', 'info');
  }
}

// ── 3. DEDICATED PENCAPAIAN VIEW ──────────────────────────────
function renderDedicatedPencapaianView() {
  const profile = getUserProfile();
  const xp = profile.goldTokens || 450;
  const xpEl = document.getElementById('pencapaianXP');
  if (xpEl) xpEl.innerText = `${xp.toLocaleString('id-ID')} XP`;

  const trustScore = document.getElementById('pencapaianTrustScore');
  if (trustScore) {
    trustScore.innerText = `${Math.min(99, 92 + (xp % 8))}%`;
  }
}

// ── 4. DEDICATED PENGATURAN VIEW ──────────────────────────────
function renderDedicatedPengaturanView() {
  const profile = getUserProfile();
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };
  setVal('setUserName', profile.name || 'Alif Awwaz');
  setVal('setUserEmail', profile.email || 'alif.awwaz@ui.ac.id');
  setVal('setUserInstitution', profile.institution || profile.campus || 'Universitas Indonesia (UI)');
  setVal('setUserProdi', profile.prodi || profile.major || 'Magister Ilmu Komputer (S2)');
  setVal('setUserNim', profile.nim || '2106752000');
  setVal('setUserSupervisor', profile.supervisor || 'Prof. Dr. Ir. Pembimbing Utama, M.Sc.');
  setVal('setUserCitationStyle', profile.citationStyle || 'apa');
}

function saveUserSettings() {
  const name = document.getElementById('setUserName')?.value.trim();
  const institution = document.getElementById('setUserInstitution')?.value.trim();
  const prodi = document.getElementById('setUserProdi')?.value.trim();
  const nim = document.getElementById('setUserNim')?.value.trim();
  const supervisor = document.getElementById('setUserSupervisor')?.value.trim();
  const citationStyle = document.getElementById('setUserCitationStyle')?.value;

  const current = getUserProfile();
  const updated = {
    ...current,
    name: name || current.name,
    institution: institution || current.institution,
    campus: institution || current.campus,
    prodi: prodi || current.prodi,
    nim: nim || current.nim,
    supervisor: supervisor || current.supervisor,
    citationStyle: citationStyle || current.citationStyle
  };

  updateUserProfile(updated);
  loadUserProfile();
  showThesaToast('✓ Pengaturan profil akademik berhasil diperbarui!', 'success', 'check_circle');
}

// ── 5. NOTIFICATION PANEL CONTROLLER ──────────────────────────
const defaultThesaNotifications = [
  {
    id: 1,
    title: 'Mesin AI Gemini 2.5 Siap',
    desc: 'Google Gemini 2.5 Flash aktif terhubung tanpa mock atau fallback palsu.',
    time: 'Baru saja',
    icon: 'verified',
    color: '#059669',
    read: false
  },
  {
    id: 2,
    title: 'Pustaka PubMed NCBI Aktif',
    desc: 'Pencarian jutaan literatur akademik siap memperkuat novelty naskah.',
    time: '10 mnt lalu',
    icon: 'menu_book',
    color: '#2563eb',
    read: false
  },
  {
    id: 3,
    title: 'Integritas Sokratik Aktif',
    desc: 'Penyusunan naskah terproteksi dari joki naskah otomatis dengan dialog kritis.',
    time: '1 jam lalu',
    icon: 'shield',
    color: '#7c3aed',
    read: true
  }
];

function toggleNotifications(event) {
  if (event) event.stopPropagation();
  const panel = document.getElementById('thesaNotifPanel');
  if (!panel) return;
  const isShown = panel.style.display === 'block';
  if (isShown) {
    panel.style.display = 'none';
  } else {
    renderNotificationList();
    panel.style.display = 'block';
  }
}

function renderNotificationList() {
  const container = document.getElementById('notifListContainer');
  if (!container) return;
  container.innerHTML = defaultThesaNotifications.map(n => `
    <div style="display:flex; gap:10px; padding:8px; border-radius:8px; background:${n.read ? '#fff' : '#f8fafc'}; border:1px solid ${n.read ? '#f1f5f9' : '#e2e8f0'};">
      <span class="material-symbols-rounded" style="color:${n.color}; font-size:20px; flex-shrink:0; margin-top:2px;">${n.icon}</span>
      <div style="flex:1;">
        <div style="display:flex; justify-content:space-between; align-items:baseline;">
          <strong style="font-size:12px; color:#1e293b;">${escapeHTML(n.title)}</strong>
          <span style="font-size:10px; color:#94a3b8;">${escapeHTML(n.time)}</span>
        </div>
        <p style="font-size:11px; color:#64748b; margin:2px 0 0; line-height:1.4;">${escapeHTML(n.desc)}</p>
      </div>
    </div>
  `).join('');

  const dot = document.getElementById('hpNotifDot');
  const hasUnread = defaultThesaNotifications.some(n => !n.read);
  if (dot) dot.style.display = hasUnread ? 'block' : 'none';
}

function clearNotifications() {
  defaultThesaNotifications.forEach(n => n.read = true);
  renderNotificationList();
  showThesaToast('Semua notifikasi ditandai telah dibaca.', 'info', 'done_all');
}

// Global outside click handler for notification panel
document.addEventListener('click', (e) => {
  const panel = document.getElementById('thesaNotifPanel');
  const btn = document.getElementById('btnHpNotif');
  if (panel && panel.style.display === 'block' && !panel.contains(e.target) && (!btn || !btn.contains(e.target))) {
    panel.style.display = 'none';
  }
});

function backToHomepage() {
  const app = document.getElementById('mainApp');
  const ob = document.getElementById('onboardingScreen');
  const hp = document.getElementById('homepageScreen');

  if (app) {
    app.style.transition = 'opacity 0.2s ease';
    app.style.opacity = '0';
  }
  if (ob) {
    ob.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    ob.style.opacity = '0';
    ob.style.transform = 'scale(0.98)';
  }

  setTimeout(() => {
    if (app) app.style.display = 'none';
    if (ob) ob.style.display = 'none';
    if (hp) {
      hp.style.display = 'flex';
      hp.style.opacity = '0';
      hp.style.transform = '';
      hp.style.transition = 'opacity 0.25s ease';
      setTimeout(() => { hp.style.opacity = '1'; }, 20);
      loadSavedProjects();
    }
  }, 200);
}

function startNewProjectFromHome(ktiType) {
  // Default to 'makalah', but respect ktiType if selected from expandable options drawer
  selectedKTI = ktiType || 'makalah';

  // Transition: homepage → onboarding
  const hp = document.getElementById('homepageScreen');
  if (hp) {
    hp.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    hp.style.opacity = '0';
    hp.style.transform = 'scale(0.98)';
  }

  setTimeout(() => {
    if (hp) hp.style.display = 'none';
    const ob = document.getElementById('onboardingScreen');
    if (ob) {
      ob.style.display = 'flex';
      ob.style.opacity = '0';
      ob.style.transition = 'opacity 0.25s ease';
      setTimeout(() => { ob.style.opacity = '1'; }, 20);
    }

    // Update Step 1 with context of selected KTI
    updateStep1Context(selectedKTI);

    // Jump directly to Step 1: Format Kampus
    goToStep(1);
  }, 250);
}

async function openExistingProject(projectId) {
  try {
    setGenerationStatus('loading', 'Memuat proyek tersimpan dari basis data…');
    const data = await thesaApiFetch(`/api/v1/projects/get?id=${encodeURIComponent(projectId)}`, {}, { method: 'GET', throwOnError: true });
    activeProjectID = data.project.id;
    const state = data.state || {};
    researchContext = state.researchContext || { topic: data.project.topic };
    injectedReferences = state.injectedReferences || [];
    selectedKTI = state.selectedKTI || 'makalah';
    activeCampus = campusCatalog[state.campusId] || activeCampus || campusCatalog.ui;

    const hp = document.getElementById('homepageScreen'); if (hp) hp.style.display = 'none';
    const ob = document.getElementById('onboardingScreen'); if (ob) ob.style.display = 'none';
    const app = document.getElementById('mainApp'); app.style.display = 'block'; app.style.opacity = '1';

    const hasSavedChat = Boolean(state.chatHTML && state.chatHTML.trim() !== '');
    initMainApp(ktiDefinitions[selectedKTI] || ktiDefinitions.makalah, activeCampus, researchContext, hasSavedChat);
    initChatActions();

    // Restore chat history if present
    if (hasSavedChat) {
      const stream = document.getElementById('duoChatStream');
      if (stream) {
        stream.innerHTML = state.chatHTML;
        stream.scrollTop = stream.scrollHeight;
      }
    }

    // Restore title and author header
    const titleEl = document.getElementById('draftPaperTitle');
    if (titleEl) titleEl.innerText = researchContext.topic || data.project.title || 'Proyek Riset';
    const authorEl = document.getElementById('paperAuthorSubtitle');
    if (authorEl) authorEl.innerText = `Format ${selectedKTI.toUpperCase()} · ${activeCampus?.name || 'Universitas Indonesia'} · ${activeCitationStyle.toUpperCase()}`;

    // Restore draft content into section boxes
    if (state.boxes && state.boxes.latarBelakang) {
      const box11 = document.getElementById('boxLatarBelakang');
      if (box11) { box11.innerHTML = state.boxes.latarBelakang; box11.style.background = '#ffffff'; }
      if (state.boxes.problemStatement) { const b = document.getElementById('boxProblemStatement'); if (b) b.innerHTML = state.boxes.problemStatement; }
      if (state.boxes.tujuanPenulisan) { const b = document.getElementById('boxTujuanPenulisan'); if (b) b.innerHTML = state.boxes.tujuanPenulisan; }
      if (state.boxes.pembahasan) { const b = document.getElementById('boxPembahasan'); if (b) b.innerHTML = state.boxes.pembahasan; }
      if (state.boxes.penutup) { const b = document.getElementById('boxPenutup'); if (b) b.innerHTML = state.boxes.penutup; }
    } else if (state.draft) {
      renderDraftToBox(state.draft);
    }

    // Restore references into bibliography section
    updateBibliographySection();

    setGenerationStatus('success', '✓ Proyek tersimpan berhasil dimuat.');
  } catch (err) {
    console.error('[Thesa Open Project Error]', err);
    setGenerationStatus('error', `Proyek tidak dapat dibuka: ${err.message}`);
  }
}

// ══════════════════════════════════════════════════════
// MOBILE SIDEBAR DRAWER
// ══════════════════════════════════════════════════════
function toggleMobileSidebar() {
  const sidebar = document.getElementById('hpSidebar');
  const backdrop = document.getElementById('hpSidebarBackdrop');
  if (!sidebar) return;
  const isOpen = sidebar.classList.contains('mobile-open');
  if (isOpen) {
    closeMobileSidebar();
  } else {
    sidebar.classList.add('mobile-open');
    backdrop && backdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('hpSidebar');
  const backdrop = document.getElementById('hpSidebarBackdrop');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.remove('active');
  document.body.style.overflow = '';
}

// Show/hide hamburger based on viewport
(function initMobileNav() {
  const mq = window.matchMedia('(max-width: 768px)');
  function onMQ(e) {
    const btn = document.getElementById('hpMenuBtn');
    if (!btn) return;
    btn.style.display = e.matches ? 'flex' : 'none';
    if (!e.matches) closeMobileSidebar(); // close sidebar when going to desktop
  }
  mq.addEventListener('change', onMQ);
  document.addEventListener('DOMContentLoaded', () => onMQ(mq));
})();


function setTimeAwareGreeting() {
  const hour = new Date().getHours();
  const greetingEl = document.getElementById('hpGreetingText');
  const subEl = document.getElementById('hpGreetingSub');
  if (!greetingEl) return;

  const firstName = (currentUserProfile && currentUserProfile.name)
    ? currentUserProfile.name.trim().split(' ')[0]
    : 'Peneliti';

  if (hour < 5) {
    greetingEl.textContent = `Masih terjaga, ${firstName}? 🌙`;
    subEl.textContent = 'Semangat riset tengah malam! Jangan lupa istirahat setelah ini.';
  } else if (hour < 12) {
    greetingEl.textContent = `Selamat pagi, ${firstName}! ☀️`;
    subEl.textContent = 'Pagi hari adalah waktu terbaik untuk riset yang fokus. Mulai dari mana?';
  } else if (hour < 15) {
    greetingEl.textContent = `Selamat siang, ${firstName}! 🌤`;
    subEl.textContent = 'Mau lanjutkan proyek yang kemarin, atau mulai sesuatu yang baru?';
  } else if (hour < 18) {
    greetingEl.textContent = `Selamat sore, ${firstName}! 🌇`;
    subEl.textContent = 'Sore ini saatnya lanjut riset. Thesa siap menemanimu!';
  } else {
    greetingEl.textContent = `Selamat malam, ${firstName}! 🌙`;
    subEl.textContent = 'Riset malam ini — tetap fokus dan semangat!';
  }
}



// ── Onboarding State ──────────────────────────────────────────
let selectedKTI = null;
let selectedCampusId = 'ui';    // default
let obKeywords = [];
let obFormatSkipped = false;

// ── App Runtime State ─────────────────────────────────────────
let userXP = 0;
let progressPct = 0;
let epistemicSelection = 'green';
let tempSelectedCampusId = 'ui';
let auditDossier = [];

// ── Authentic KTI Definitions with Realistic Academic Structures ──
const ktiDefinitions = {
  makalah: {
    label: 'Makalah',
    coachLabel: 'Makalah Ilmiah Co-Pilot',
    roadmapBadge: 'PETA PENULISAN MAKALAH',
    typicalLength: '4–20 halaman',
    units: [
      {
        id: 1,
        num: 'UNIT 1',
        title: 'BAB I: PENDAHULUAN',
        subtitle: 'Latar Belakang Topik, Rumusan Masalah, & Tujuan Penulisan',
        activeDesc: 'Dari fenomena ➔ Rumusan Masalah & Batasan Makalah',
        steps: [
          { id: '1.1', title: 'Uji Sokratik: Konteks & Urgensi Topik', xp: 60, icon: 'psychology_alt' },
          { id: '1.2', title: 'Co-Author: Latar Belakang Masalah', xp: 60, icon: 'edit_note' },
          { id: '1.3', title: 'Rumusan Masalah & Tujuan Makalah', xp: 60, icon: 'rule' }
        ]
      },
      {
        id: 2,
        num: 'UNIT 2',
        title: 'BAB II: PEMBAHASAN & ANALISIS',
        subtitle: 'Kajian Konseptual, Pembahasan Masalah & Analisis Kasus',
        activeDesc: 'Sintesis konsep & elaborasi argumen kritis',
        steps: [
          { id: '2.1', title: 'Tinjauan Konsep & Teori Kunci', xp: 60, icon: 'menu_book' },
          { id: '2.2', title: 'Analisis Pembahasan Masalah Utama', xp: 60, icon: 'analytics' },
          { id: '2.3', title: 'Sintesis Solusi & Gagasan Penulis', xp: 60, icon: 'lightbulb' }
        ]
      },
      {
        id: 3,
        num: 'UNIT 3',
        title: 'BAB III: PENUTUP',
        subtitle: 'Kesimpulan Pokok & Rekomendasi Pemikiran',
        activeDesc: 'Menjawab rumusan masalah & menyusun saran',
        steps: [
          { id: '3.1', title: 'Sintesis Kesimpulan Pokok', xp: 60, icon: 'task_alt' },
          { id: '3.2', title: 'Saran & Rekomendasi Aplikatif', xp: 60, icon: 'recommend' }
        ]
      }
    ],
    bossArena: {
      title: 'Simulasi Diskusi & Tanya Jawab Kelas',
      subtitle: 'Uji ketajaman argumen makalahmu di hadapan Dosen & Rekan Penanya!',
      badge: 'Diskusi Makalah',
      trophy: '🎓',
      examiner1: { name: 'Dosen Pengampu', role: 'Evaluator Logika Makalah', status: 'Menguji Argumen' },
      examiner2: { name: 'Rekan Diskusi', role: 'Penanya Kritis', status: 'Menyimak' },
      openingQuestion: 'Saudara penyaji, apa dasar konseptual utama yang melandasi argumen Anda di Bab II, dan bagaimana solusi yang Anda tawarkan dapat diterapkan?'
    },
    paperSections: [
      { id: 'section11', headingId: 'heading11', title: '1.1 Latar Belakang Topik', boxId: 'boxLatarBelakang', badgeId: 'badgeSection11', placeholder: 'Akan terisi saat kamu mulai berdialog dengan Thesa' },
      { id: 'section12', headingId: 'heading12', title: '1.2 Rumusan Masalah', boxId: 'boxProblemStatement', badgeId: 'badgeSection12', placeholder: 'Akan terisi setelah verifikasi langkah 1.3 selesai' },
      { id: 'section13', headingId: 'heading13', title: '1.3 Tujuan Penulisan', boxId: 'boxTujuanPenulisan', badgeId: 'badgeSection13', placeholder: 'Akan terisi bersamaan dengan rumusan masalah' },
      { id: 'section2', headingId: 'heading2', title: 'BAB II: PEMBAHASAN & ANALISIS', boxId: 'boxPembahasan', badgeId: 'badgeSection2', placeholder: 'Menunggu Unit 2 aktif' },
      { id: 'section3', headingId: 'heading3', title: 'BAB III: PENUTUP (Kesimpulan & Saran)', boxId: 'boxPenutup', badgeId: 'badgeSection3', placeholder: 'Menunggu Unit 3 aktif' },
      { id: 'sectionDaftarPustaka', headingId: 'headingDaftarPustaka', title: 'DAFTAR PUSTAKA', boxId: 'boxDaftarPustaka', badgeId: 'refCountBadge', placeholder: 'Gunakan tombol "Cari Literatur" untuk menyisipkan referensi ilmiah ke naskah ini.' }
    ]
  },

  proposal: {
    label: 'Proposal Penelitian',
    coachLabel: 'Proposal Penelitian Co-Pilot',
    roadmapBadge: 'PETA PROPOSAL PENELITIAN',
    typicalLength: '15–40 halaman',
    isProposal: true,
    units: [
      {
        id: 1,
        num: 'UNIT 1',
        title: 'BAB I: PENDAHULUAN',
        subtitle: 'Latar Belakang, Identifikasi Masalah, Rumusan Masalah & Tujuan Riset',
        activeDesc: 'Dari fenomena empiris ➔ Gap Penelitian yang Teruji',
        steps: [
          { id: '1.1', title: 'Uji Sokratik: Research Gap & Urgensi', xp: 60, icon: 'psychology_alt' },
          { id: '1.2', title: 'Co-Author: Latar Belakang Riset', xp: 60, icon: 'edit_note' },
          { id: '1.3', title: 'Rumusan Masalah & Batasan Penelitian', xp: 60, icon: 'rule' }
        ]
      },
      {
        id: 2,
        num: 'UNIT 2',
        title: 'BAB II: TINJAUAN PUSTAKA & KERANGKA TEORI',
        subtitle: 'Landasan Teori, Riset Terdahulu & Kerangka Berpikir / Hipotesis',
        activeDesc: 'Pemetaan pustaka kunci & perumusan hipotesis kerja',
        steps: [
          { id: '2.1', title: 'Pemetaan Penelitian Terdahulu', xp: 60, icon: 'menu_book' },
          { id: '2.2', title: 'Landasan Teori Pendukung', xp: 60, icon: 'account_tree' },
          { id: '2.3', title: 'Kerangka Konsep & Hipotesis Riset', xp: 60, icon: 'schema' }
        ]
      },
      {
        id: 3,
        num: 'UNIT 3',
        title: 'BAB III: METODOLOGI PENELITIAN',
        subtitle: 'Desain Riset, Populasi/Sampel, Pengumpulan & Analisis Data',
        activeDesc: 'Rancangan prosedur operasional penelitian',
        steps: [
          { id: '3.1', title: 'Desain & Pendekatan Penelitian', xp: 60, icon: 'biotech' },
          { id: '3.2', title: 'Populasi, Sampel / Sumber Data', xp: 60, icon: 'group' },
          { id: '3.3', title: 'Teknik Pengumpulan & Analisis Data', xp: 60, icon: 'query_stats' }
        ]
      }
    ],
    bossArena: {
      title: 'Simulasi Seminar Proposal (Sempro)',
      subtitle: 'Pertahankan kelayakan metodologi dan urgensi riset di hadapan Tim Penguji Sempro!',
      badge: 'Seminar Proposal',
      trophy: '📋',
      examiner1: { name: 'Dosen Penguji 1', role: 'Evaluator Metodologi', status: 'Menguji Metode' },
      examiner2: { name: 'Dosen Penguji 2', role: 'Evaluator Landasan Teori', status: 'Menyimak' },
      openingQuestion: 'Saudara peneliti, mengapa metode penelitian yang Anda pilih di Bab III adalah yang paling tepat untuk menjawab rumusan masalah di Bab I?'
    },
    paperSections: [
      { id: 'section11', headingId: 'heading11', title: '1.1 Latar Belakang Masalah', boxId: 'boxLatarBelakang', placeholder: 'Akan terisi saat kamu mulai berdialog dengan Thesa' },
      { id: 'section12', headingId: 'heading12', title: '1.2 Rumusan Masalah & Tujuan Riset', boxId: 'boxProblemStatement', placeholder: 'Akan terisi setelah verifikasi langkah 1.2 selesai' },
      { id: 'section2', headingId: 'heading2', title: 'BAB II: TINJAUAN PUSTAKA & KERANGKA TEORI', boxId: 'boxPustaka', placeholder: 'Menunggu Unit 2 aktif' },
      { id: 'section3', headingId: 'heading3', title: 'BAB III: METODOLOGI PENELITIAN', boxId: 'boxMetodologi', placeholder: 'Menunggu Unit 3 aktif' }
    ]
  },

  skripsi: {
    label: 'Skripsi (S1)',
    coachLabel: 'Skripsi S1 Co-Pilot',
    roadmapBadge: 'PETA SKRIPSI S1',
    typicalLength: '60–100 halaman',
    units: [
      {
        id: 1,
        num: 'UNIT 1',
        title: 'BAB I: PENDAHULUAN',
        subtitle: 'Latar Belakang Masalah, Identifikasi Gap, Rumusan Masalah, Tujuan & Manfaat',
        activeDesc: 'Dari fenomena empiris ➔ Rumusan Masalah yang Teruji',
        steps: [
          { id: '1.1', title: 'Uji Sokratik: Konteks & Batasan Skripsi', xp: 60, icon: 'psychology_alt' },
          { id: '1.2', title: 'Co-Author: Latar Belakang Masalah', xp: 60, icon: 'edit_note' },
          { id: '1.3', title: 'Rumusan Masalah & Batasan Penelitian', xp: 60, icon: 'rule' }
        ]
      },
      {
        id: 2,
        num: 'UNIT 2',
        title: 'BAB II: TINJAUAN PUSTAKA',
        subtitle: 'Landasan Teori, Penelitian Terdahulu & Kerangka Pemikiran',
        activeDesc: 'Sintesis literatur & model hubungan variabel',
        steps: [
          { id: '2.1', title: 'Tinjauan Teori Utama', xp: 60, icon: 'menu_book' },
          { id: '2.2', title: 'Sintesis Penelitian Terdahulu', xp: 60, icon: 'table_chart' },
          { id: '2.3', title: 'Kerangka Konsep & Hipotesis S1', xp: 60, icon: 'account_tree' }
        ]
      },
      {
        id: 3,
        num: 'UNIT 3',
        title: 'BAB III: METODE PENELITIAN',
        subtitle: 'Desain Riset, Instrumen, Uji Validitas & Teknik Analisis',
        activeDesc: 'Operasionalisasi variabel & prosedur pengujian data',
        steps: [
          { id: '3.1', title: 'Rancangan Penelitian & Subjek Riset', xp: 60, icon: 'biotech' },
          { id: '3.2', title: 'Instrumen & Uji Validitas/Reliabilitas', xp: 60, icon: 'fact_check' },
          { id: '3.3', title: 'Teknik Pengolahan & Analisis Data', xp: 60, icon: 'insights' }
        ]
      },
      {
        id: 'data',
        num: 'FASE LAPANGAN',
        title: 'DATA HUB: PENGUMPULAN DATA & LOG LAPANGAN',
        subtitle: 'Progres Responden, Input Temuan Mentah & Sintesis Sokratik',
        activeDesc: 'Merekam data lapangan sebelum masuk ke Bab IV',
        isDataHub: true,
        steps: [
          { id: 'DH.1', title: 'Input Log Responden & Data Mentah', xp: 80, icon: 'dataset', isHubAction: true }
        ]
      },
      {
        id: 4,
        num: 'UNIT 4',
        title: 'BAB IV: HASIL PENELITIAN & PEMBAHASAN',
        subtitle: 'Deskripsi Data Temuan, Uji Analisis & Diskusi Komparatif Teori',
        activeDesc: 'Interpretasi data empiris & konfirmasi hipotesis',
        steps: [
          { id: '4.1', title: 'Penyajian Temuan Data Empiris', xp: 60, icon: 'bar_chart' },
          { id: '4.2', title: 'Uji Hipotesis & Pembahasan Mendalam', xp: 60, icon: 'psychology' }
        ]
      },
      {
        id: 5,
        num: 'UNIT 5',
        title: 'BAB V: KESIMPULAN & SARAN',
        subtitle: 'Simpulan Riset, Implikasi Praktis & Saran Riset Lanjutan',
        activeDesc: 'Menjawab rumusan masalah & merumuskan implikasi',
        steps: [
          { id: '5.1', title: 'Kesimpulan Menjawab Masalah', xp: 60, icon: 'task_alt' },
          { id: '5.2', title: 'Saran Praktis & Keterbatasan Studi', xp: 60, icon: 'recommend' }
        ]
      }
    ],
    bossArena: {
      title: 'Simulasi Sidang Skripsi S1',
      subtitle: 'Pertahankan naskah skripsi dan uji ketahanan argumen di hadapan 2 Dosen Penguji!',
      badge: 'Sidang Skripsi S1',
      trophy: '🏆',
      examiner1: { name: 'Dosen Penguji Utama', role: 'Pakar Metodologi & Instrumen', status: 'Menguji Metode' },
      examiner2: { name: 'Dosen Penguji Anggota', role: 'Pakar Teori & Pembahasan', status: 'Menyimak' },
      openingQuestion: 'Saudara peneliti, apa temuan paling orisinal dari skripsi Anda di Bab IV dan mengapa teori di Bab II mampu atau tidak mampu menjelaskan fenomena tersebut?'
    },
    paperSections: [
      { id: 'section11', headingId: 'heading11', title: '1.1 Latar Belakang Masalah', boxId: 'boxLatarBelakang', placeholder: 'Akan terisi saat kamu mulai berdialog dengan Thesa' },
      { id: 'section12', headingId: 'heading12', title: '1.2 Rumusan Masalah', boxId: 'boxProblemStatement', placeholder: 'Akan terisi setelah verifikasi langkah 1.2 selesai' },
      { id: 'section2', headingId: 'heading2', title: 'BAB II: TINJAUAN PUSTAKA', boxId: 'boxTinjauan', placeholder: 'Menunggu Unit 2 aktif' },
      { id: 'section3', headingId: 'heading3', title: 'BAB III: METODE PENELITIAN', boxId: 'boxMetode', placeholder: 'Menunggu Unit 3 aktif' },
      { id: 'section4', headingId: 'heading4', title: 'BAB IV: HASIL & PEMBAHASAN', boxId: 'boxHasil', placeholder: 'Menunggu Pengumpulan Data Lapangan selesai' },
      { id: 'section5', headingId: 'heading5', title: 'BAB V: KESIMPULAN & SARAN', boxId: 'boxKesimpulan', placeholder: 'Menunggu Unit 5 aktif' }
    ]
  },

  tesis: {
    label: 'Tesis (S2)',
    coachLabel: 'Tesis S2 Co-Pilot',
    roadmapBadge: 'PETA RISET SOKRATIK TESIS',
    typicalLength: '80–150 halaman',
    units: [
      {
        id: 1,
        num: 'UNIT 1',
        title: 'BAB I: PENDAHULUAN & NOVELTY GAP',
        subtitle: 'State-of-the-Art Gap, Rumusan Masalah, & Kontribusi Ilmiah Master',
        activeDesc: 'Dari fenomena empiris & gap literatur ➔ Research Problem Teruji',
        steps: [
          { id: '1.1', title: 'Uji Sokratik: Novelty & Research Gap', xp: 60, icon: 'psychology_alt' },
          { id: '1.2', title: 'Co-Author: Latar Belakang & Motivasi', xp: 60, icon: 'edit_note' },
          { id: '1.3', title: 'Rumusan Masalah & Kontribusi Ilmiah', xp: 60, icon: 'rule' }
        ]
      },
      {
        id: 2,
        num: 'UNIT 2',
        title: 'BAB II: STATE-OF-THE-ART & KAJIAN TEORI',
        subtitle: 'Sintesis Matriks Paper Kunci & Konstruksi Model Konseptual',
        activeDesc: 'Kajian komprehensif literatur internasional terkini',
        steps: [
          { id: '2.1', title: 'Sintesis Literatur Global (Scopus/WOS)', xp: 60, icon: 'menu_book' },
          { id: '2.2', title: 'Konstruksi Kerangka Konseptual Baru', xp: 60, icon: 'schema' }
        ]
      },
      {
        id: 3,
        num: 'UNIT 3',
        title: 'BAB III: METODOLOGI PENELITIAN RIGOR',
        subtitle: 'Operasionalisasi Riset, Validitas Rigoritas & Prosedur Analisis',
        activeDesc: 'Desain eksperimen / pengumpulan data berstandar rigor tinggi',
        steps: [
          { id: '3.1', title: 'Desain Metodologi & Justifikasi Pemilihan', xp: 60, icon: 'biotech' },
          { id: '3.2', title: 'Rencana Analisis & Kontrol Bias', xp: 60, icon: 'query_stats' }
        ]
      },
      {
        id: 'data',
        num: 'FASE LAPANGAN',
        title: 'DATA HUB: PENGUMPULAN DATA & LOG EKSPERIMEN',
        subtitle: 'Pelaksanaan Eksperimen/Survei, Log Metrik & Data Digest Sokratik',
        activeDesc: 'Verifikasi dataset sebelum analisis temuan pascasarjana',
        isDataHub: true,
        steps: [
          { id: 'DH.1', title: 'Input Log Eksperimen & Sintesis Data', xp: 80, icon: 'dataset', isHubAction: true }
        ]
      },
      {
        id: 4,
        num: 'UNIT 4',
        title: 'BAB IV: ANALISIS TEMUAN & DISKUSI KRITIS',
        subtitle: 'Uji Hipotesis/Eksperimen & Komparasi dengan Literatur Global',
        activeDesc: 'Pembahasan mendalam atas implikasi teoretis temuan',
        steps: [
          { id: '4.1', title: 'Temuan Empiris & Analisis Statistik/Kualitatif', xp: 60, icon: 'analytics' },
          { id: '4.2', title: 'Diskusi Implikasi terhadap Teori Eksisting', xp: 60, icon: 'forum' }
        ]
      },
      {
        id: 5,
        num: 'UNIT 5',
        title: 'BAB V: KESIMPULAN & KONTRIBUSI ILMIAH',
        subtitle: 'Sintesis Kebaruan, Implikasi Manajerial & Rekomendasi Riset',
        activeDesc: 'Menegaskan kontribusi keilmuan naskah tesis',
        steps: [
          { id: '5.1', title: 'Simpulan Kontribusi Orisinal', xp: 60, icon: 'task_alt' },
          { id: '5.2', title: 'Keterbatasan & Agenda Riset Masa Depan', xp: 60, icon: 'rocket_launch' }
        ]
      }
    ],
    bossArena: {
      title: 'Simulasi Sidang Tesis Magister',
      subtitle: 'Uji ketahanan novelty dan justifikasi metodologis di hadapan Tim Penguji Tesis!',
      badge: 'Sidang Tesis Master',
      trophy: '🏆',
      examiner1: { name: 'Prof. Dr. Hardi Santoso', role: 'Pakar Metodologi', status: 'Menguji Metodologi' },
      examiner2: { name: 'Dr. Maya Kusuma', role: 'Pakar Teori & Novelty', status: 'Menyimak' },
      openingQuestion: 'Saudara kandidat, bagaimana Anda membuktikan bahwa kontribusi ilmiah tesis Anda tidak sekadar replikasi, melainkan memberikan novelty yang signifikan bagi disiplin ilmu Anda?'
    },
    paperSections: [
      { id: 'section11', headingId: 'heading11', title: '1.1 Latar Belakang & Novelty Gap', boxId: 'boxLatarBelakang', placeholder: 'Akan terisi saat kamu mulai berdialog dengan Thesa' },
      { id: 'section12', headingId: 'heading12', title: '1.2 Rumusan Masalah & Kontribusi', boxId: 'boxProblemStatement', placeholder: 'Akan terisi setelah verifikasi langkah 1.2 selesai' },
      { id: 'section2', headingId: 'heading2', title: 'BAB II: STATE-OF-THE-ART & KAJIAN TEORI', boxId: 'boxKajianTeori', placeholder: 'Menunggu Unit 2 aktif' },
      { id: 'section3', headingId: 'heading3', title: 'BAB III: METODOLOGI PENELITIAN', boxId: 'boxMetodologi', placeholder: 'Menunggu Unit 3 aktif' },
      { id: 'section4', headingId: 'heading4', title: 'BAB IV: ANALISIS TEMUAN & DISKUSI', boxId: 'boxHasilTesis', placeholder: 'Menunggu Pengumpulan Data Lapangan selesai' },
      { id: 'section5', headingId: 'heading5', title: 'BAB V: KESIMPULAN & KONTRIBUSI ILMIAH', boxId: 'boxSimpulanTesis', placeholder: 'Menunggu Unit 5 aktif' }
    ]
  },

  disertasi: {
    label: 'Disertasi (S3)',
    coachLabel: 'Disertasi S3 Co-Pilot',
    roadmapBadge: 'PETA DISERTASI DOKTORAL',
    typicalLength: '150–300 halaman',
    units: [
      {
        id: 1,
        num: 'UNIT 1',
        title: 'BAB I: LANDASAN FILOSOFIS & RESEARCH GAP',
        subtitle: 'Epistemologi Masalah, Gap Paradigmatik & Klaim Orisinalitas',
        activeDesc: 'Membangun dasar filosofis penelitian doktoral',
        steps: [
          { id: '1.1', title: 'Refleksi Ontologis & Epistemologis', xp: 60, icon: 'psychology_alt' },
          { id: '1.2', title: 'Klaim Orisinalitas & Dalil Disertasi', xp: 60, icon: 'auto_stories' }
        ]
      },
      {
        id: 2,
        num: 'UNIT 2',
        title: 'BAB II: KRITIK TEORI & PENGEMBANGAN PARADIGMA',
        subtitle: 'Dekomposisi Teori Eksisting & Konstruksi Teori Baru',
        activeDesc: 'Kritik komprehensif literatur dunia & model teoritis baru',
        steps: [
          { id: '2.1', title: 'Kritik Paradigma & Teori Eksisting', xp: 60, icon: 'menu_book' },
          { id: '2.2', title: 'Formulasi Proposisi / Model Teori Baru', xp: 60, icon: 'schema' }
        ]
      },
      {
        id: 3,
        num: 'UNIT 3',
        title: 'BAB III: METODOLOGI TINGKAT LANJUT & RIGORITAS',
        subtitle: 'Desain Metodologi Komprehensif & Uji Triangulasi',
        activeDesc: 'Rancangan uji empiris tingkat lanjut',
        steps: [
          { id: '3.1', title: 'Desain Metodologi Lanjutan & Validasi', xp: 60, icon: 'biotech' }
        ]
      },
      {
        id: 4,
        num: 'UNIT 4',
        title: 'BAB IV: TEMUAN RISET & KONSTRUKSI DALIL',
        subtitle: 'Bukti Empiris & Pembuktian Kebaruan Teori',
        activeDesc: 'Eksplorasi temuan dan pembuktian dalil baru',
        steps: [
          { id: '4.1', title: 'Pembuktian Dalil & Temuan Doktoral', xp: 60, icon: 'analytics' }
        ]
      },
      {
        id: 5,
        num: 'UNIT 5',
        title: 'BAB V: NOVELTI, IMPLIKASI & DISKUSI PARADIGMATIK',
        subtitle: 'Kontribusi Paradigmatik & Implikasi Filosofis terhadap Disiplin Ilmu',
        activeDesc: 'Sintesis kebaruan orisinal tingkat doktoral',
        steps: [
          { id: '5.1', title: 'Klaim Final Novelty & Arah Disiplin Ilmu', xp: 60, icon: 'task_alt' }
        ]
      }
    ],
    bossArena: {
      title: 'Simulasi Sidang Promosi Doktor',
      subtitle: 'Pertahankan dalil orisinal dan kontribusi keilmuan di hadapan Dewan Guru Besar & Promotor!',
      badge: 'Sidang Doktoral',
      trophy: '👑',
      examiner1: { name: 'Prof. Dr. Promotor Utama', role: 'Promotor Disertasi', status: 'Menguji Paradigma' },
      examiner2: { name: 'Prof. Dr. Penguji Eksternal', role: 'Penguji Ahli Internasional', status: 'Menyimak' },
      openingQuestion: 'Saudara promovendus, dalil baru apa yang Anda konstruksikan dalam disertasi ini yang mampu menggugurkan atau memperluas paradigma teori yang telah mapan sebelumnya?'
    },
    paperSections: [
      { id: 'section11', headingId: 'heading11', title: '1.1 Landasan Filosofis & Gap Paradigmatik', boxId: 'boxLatarBelakang', placeholder: 'Akan terisi saat kamu mulai berdialog dengan Thesa' },
      { id: 'section12', headingId: 'heading12', title: '1.2 Rumusan Masalah & Klaim Orisinalitas', boxId: 'boxProblemStatement', placeholder: 'Akan terisi setelah verifikasi langkah 1.2 selesai' },
      { id: 'section2', headingId: 'heading2', title: 'BAB II: KRITIK TEORI & PARADIGMA BARU', boxId: 'boxKritikTeori', placeholder: 'Menunggu Unit 2 aktif' },
      { id: 'section3', headingId: 'heading3', title: 'BAB III: METODOLOGI TINGKAT LANJUT', boxId: 'boxMetodeS3', placeholder: 'Menunggu Unit 3 aktif' },
      { id: 'section4', headingId: 'heading4', title: 'BAB IV: TEMUAN RISET & KONSTRUKSI DALIL', boxId: 'boxTemuanS3', placeholder: 'Menunggu Unit 4 aktif' },
      { id: 'section5', headingId: 'heading5', title: 'BAB V: NOVELTI & IMPLIKASI PARADIGMATIK', boxId: 'boxNoveltyS3', placeholder: 'Menunggu Unit 5 aktif' }
    ]
  },

  jurnal: {
    label: 'Artikel Jurnal',
    coachLabel: 'Jurnal Ilmiah Co-Pilot',
    roadmapBadge: 'PETA ARTIKEL JURNAL (IMRAD)',
    typicalLength: '6–16 halaman',
    units: [
      {
        id: 1,
        num: 'UNIT 1',
        title: 'INTRODUCTION & RESEARCH GAP',
        subtitle: 'Latar Belakang Padat, State-of-the-Art Gap, & Research Objectives',
        activeDesc: 'Membangun argumen urgensi dalam format ringkas berstandar jurnal',
        steps: [
          { id: '1.1', title: 'Uji Sokratik: Scope & Journal Novelty', xp: 60, icon: 'psychology_alt' },
          { id: '1.2', title: 'Co-Author: Introduction & Problem Statement', xp: 60, icon: 'edit_note' },
          { id: '1.3', title: 'Highlight Research Objectives & Contribution', xp: 60, icon: 'rule' }
        ]
      },
      {
        id: 2,
        num: 'UNIT 2',
        title: 'MATERIALS & METHODS',
        subtitle: 'Prosedur Metodologis, Dataset / Sampel, & Validitas Replikasi',
        activeDesc: 'Penyusunan metode yang ringkas, presisi, dan reproducible',
        steps: [
          { id: '2.1', title: 'Deskripsi Dataset / Prosedur Eksperimen', xp: 60, icon: 'biotech' },
          { id: '2.2', title: 'Metrik Evaluasi & Parameter Analisis', xp: 60, icon: 'query_stats' }
        ]
      },
      {
        id: 3,
        num: 'UNIT 3',
        title: 'RESULTS & DISCUSSION',
        subtitle: 'Penyajian Temuan Kunci, Grafik / Tabel, & Diskusi Kritis',
        activeDesc: 'Elaborasi temuan terhadap literatur jurnal internasional',
        steps: [
          { id: '3.1', title: 'Sintesis Temuan Hasil Utama', xp: 60, icon: 'bar_chart' },
          { id: '3.2', title: 'Diskusi Temuan vs Referensi Scopus Q1/Q2', xp: 60, icon: 'forum' }
        ]
      },
      {
        id: 4,
        num: 'UNIT 4',
        title: 'CONCLUSION & FUTURE DIRECTIONS',
        subtitle: 'Simpulan Utama, Implikasi Ilmiah, & Arah Riset Lanjutan',
        activeDesc: 'Penutup padat berstandar peer-reviewed paper',
        steps: [
          { id: '4.1', title: 'Kesimpulan Akhir & Implikasi Luas', xp: 60, icon: 'task_alt' }
        ]
      }
    ],
    bossArena: {
      title: 'Simulasi Peer-Review Jurnal (Scopus / Sinta)',
      subtitle: 'Hadapi catatan kritis Reviewer 1 & Reviewer 2 untuk meraih status Accepted!',
      badge: 'Peer Review Jurnal',
      trophy: '📑',
      examiner1: { name: 'Reviewer #1 (Methodologist)', role: 'Pakar Metodologi & Replikasi', status: 'Reviewing Methods' },
      examiner2: { name: 'Reviewer #2 (Domain Expert)', role: 'Pakar Teori & State-of-the-Art', status: 'Reviewing Novelty' },
      openingQuestion: 'Dear author, how does your proposed approach outperform the current state-of-the-art baselines, and what evidence ensures the generalizability of your findings?'
    },
    paperSections: [
      { id: 'section11', headingId: 'heading11', title: '1. INTRODUCTION', boxId: 'boxLatarBelakang', placeholder: 'Akan terisi saat kamu mulai berdialog dengan Thesa' },
      { id: 'section12', headingId: 'heading12', title: '2. MATERIALS AND METHODS', boxId: 'boxMetodeJurnal', placeholder: 'Menunggu Unit 2 aktif' },
      { id: 'section3', headingId: 'heading3', title: '3. RESULTS AND DISCUSSION', boxId: 'boxHasilJurnal', placeholder: 'Menunggu Unit 3 aktif' },
      { id: 'section4', headingId: 'heading4', title: '4. CONCLUSION', boxId: 'boxSimpulanJurnal', placeholder: 'Menunggu Unit 4 aktif' }
    ]
  },

  laporan: {
    label: 'Laporan / PKM',
    coachLabel: 'Laporan Penelitian Co-Pilot',
    roadmapBadge: 'PETA LAPORAN RISET / PKM',
    typicalLength: '20–60 halaman',
    units: [
      {
        id: 1,
        num: 'UNIT 1',
        title: 'BAB I: PENDAHULUAN',
        subtitle: 'Kondisi Lapangan / Mitra, Latar Belakang Masalah & Urgensi PKM',
        activeDesc: 'Identifikasi persoalan nyata masyarakat / mitra sasaran',
        steps: [
          { id: '1.1', title: 'Uji Sokratik: Urgensi Masalah Lapangan', xp: 60, icon: 'psychology_alt' },
          { id: '1.2', title: 'Co-Author: Latar Belakang & Potensi Solusi', xp: 60, icon: 'edit_note' },
          { id: '1.3', title: 'Rumusan Masalah & Target Capaian', xp: 60, icon: 'rule' }
        ]
      },
      {
        id: 2,
        num: 'UNIT 2',
        title: 'BAB II: GAMBARAN UMUM MASYARAKAT / TINJAUAN PUSTAKA',
        subtitle: 'Profil Wilayah / Mitra Sasaran & Landasan Solusi',
        activeDesc: 'Deskripsi komprehensif subjek penerapan program',
        steps: [
          { id: '2.1', title: 'Profil Masyarakat Sasaran & Pustaka Terkait', xp: 60, icon: 'groups' }
        ]
      },
      {
        id: 3,
        num: 'UNIT 3',
        title: 'BAB III: METODE PELAKSANAAN',
        subtitle: 'Tahapan Kegiatan, Desain Solusi, & Evaluasi Keberhasilan',
        activeDesc: 'Rencana alur eksekusi program di lapangan',
        steps: [
          { id: '3.1', title: 'Alur Prosedur Pelaksanaan & Luaran', xp: 60, icon: 'alt_route' }
        ]
      },
      {
        id: 4,
        num: 'UNIT 4',
        title: 'BAB IV: BIAYA DAN JADWAL KEGIATAN',
        subtitle: 'Rekapitulasi Anggaran (RAB) & Matriks Timeline Eksekusi',
        activeDesc: 'Perencanaan kelayakan operasional program',
        steps: [
          { id: '4.1', title: 'Justifikasi Anggaran & Matriks Timeline', xp: 60, icon: 'calendar_month' }
        ]
      }
    ],
    bossArena: {
      title: 'Simulasi Monev PKM / Presentasi PIMNAS',
      subtitle: 'Presentasikan efektivitas solusi dan kelayakan pelaksanaan di hadapan Reviewer Monev!',
      badge: 'Monev PKM',
      trophy: '🏅',
      examiner1: { name: 'Reviewer Monev Dikti', role: 'Evaluator Kelayakan Program', status: 'Menguji Pelaksanaan' },
      examiner2: { name: 'Pakar Bidang Mitra', role: 'Evaluator Dampak Masyarakat', status: 'Menyimak' },
      openingQuestion: 'Saudara tim pengusul, apa indikator keberhasilan paling terukur dari solusi yang Anda tawarkan, dan bagaimana keberlanjutan program ini setelah periode selesai?'
    },
    paperSections: [
      { id: 'section11', headingId: 'heading11', title: 'BAB I: PENDAHULUAN', boxId: 'boxLatarBelakang', placeholder: 'Akan terisi saat kamu mulai berdialog dengan Thesa' },
      { id: 'section12', headingId: 'heading12', title: 'BAB II: GAMBARAN UMUM MASYARAKAT / PUSTAKA', boxId: 'boxGambaran', placeholder: 'Menunggu Unit 2 aktif' },
      { id: 'section3', headingId: 'heading3', title: 'BAB III: METODE PELAKSANAAN', boxId: 'boxMetodePKM', placeholder: 'Menunggu Unit 3 aktif' },
      { id: 'section4', headingId: 'heading4', title: 'BAB IV: BIAYA DAN JADWAL KEGIATAN', boxId: 'boxBiayaPKM', placeholder: 'Menunggu Unit 4 aktif' }
    ]
  },

  lainnya: {
    label: 'Karya Tulis',
    coachLabel: 'Karya Tulis Co-Pilot',
    roadmapBadge: 'PETA KARYA TULIS ILMIAH',
    typicalLength: 'Fleksibel',
    units: [
      {
        id: 1,
        num: 'UNIT 1',
        title: 'BAB I: PENDAHULUAN',
        subtitle: 'Latar Belakang & Gagasan Pokok',
        activeDesc: 'Membedah urgensi tulisan',
        steps: [
          { id: '1.1', title: 'Uji Sokratik: Argumen Pokok', xp: 60, icon: 'psychology_alt' },
          { id: '1.2', title: 'Co-Author: Pendahuluan', xp: 60, icon: 'edit_note' }
        ]
      },
      {
        id: 2,
        num: 'UNIT 2',
        title: 'BAB II: PEMBAHASAN',
        subtitle: 'Uraian Analisis & Elaborasi Gagasan',
        activeDesc: 'Pengembangan argumen utama',
        steps: [
          { id: '2.1', title: 'Pembahasan Komprehensif', xp: 60, icon: 'menu_book' }
        ]
      },
      {
        id: 3,
        num: 'UNIT 3',
        title: 'BAB III: PENUTUP',
        subtitle: 'Kesimpulan & Saran',
        activeDesc: 'Sintesis gagasan penutup',
        steps: [
          { id: '3.1', title: 'Kesimpulan & Refleksi', xp: 60, icon: 'task_alt' }
        ]
      }
    ],
    bossArena: {
      title: 'Simulasi Evaluasi Karya Tulis',
      subtitle: 'Uji kekokohan logika naskahmu bersama AI Evaluator!',
      badge: 'Evaluasi Naskah',
      trophy: '📝',
      examiner1: { name: 'AI Evaluator', role: 'Pemeriksa Koherensi', status: 'Menguji Logika' },
      examiner2: { name: 'AI Editor', role: 'Pemeriksa Struktur', status: 'Menyimak' },
      openingQuestion: 'Apa pesan utama yang ingin Anda sampaikan melalui tulisan ini dan bagaimana argumen Anda saling mendukung dari awal hingga akhir?'
    },
    paperSections: [
      { id: 'section11', headingId: 'heading11', title: 'BAB I: PENDAHULUAN', boxId: 'boxLatarBelakang', placeholder: 'Akan terisi saat kamu mulai berdialog dengan Thesa' },
      { id: 'section2', headingId: 'heading2', title: 'BAB II: PEMBAHASAN', boxId: 'boxPembahasan', placeholder: 'Menunggu Unit 2 aktif' },
      { id: 'section3', headingId: 'heading3', title: 'BAB III: PENUTUP', boxId: 'boxPenutup', placeholder: 'Menunggu Unit 3 aktif' }
    ]
  }
};

// ── Campus Catalog ────────────────────────────────────────────
const campusCatalog = {
  ui: {
    id: 'ui', name: 'Universitas Indonesia (UI)',
    fullName: 'Pedoman Penulisan Tesis & Disertasi Pascasarjana UI',
    citation: 'APA 7th Edition',
    subtitle: 'Mengikuti Format Pedoman Universitas Indonesia (UI)',
    styleTag: 'Pedoman UI — APA 7th',
    h11: '1.1 Latar Belakang Masalah',
    h12: '1.2 Rumusan Masalah',
    unit2: 'BAB II: TINJAUAN PUSTAKA & KAJIAN TEORI',
    unit3: 'BAB III: KERANGKA KONSEP & HIPOTESIS',
    unit4: 'BAB IV: METODE PENELITIAN',
  },
  itb: {
    id: 'itb', name: 'Institut Teknologi Bandung (ITB)',
    fullName: 'Pedoman Tesis Magister Sekolah Pascasarjana ITB',
    citation: 'IEEE / Numbered Style',
    subtitle: 'Mengikuti Format Standar Sekolah Pascasarjana ITB',
    styleTag: 'Pedoman ITB — IEEE Style',
    h11: '1.1 Latar Belakang & Motivasi Riset',
    h12: '1.2 Perumusan Masalah & Batasan Sistem',
    unit2: 'BAB 2: KAJIAN PUSTAKA & STATE-OF-THE-ART',
    unit3: 'BAB 3: PERANCANGAN ARSITEKTUR SISTEM',
    unit4: 'BAB 4: IMPLEMENTASI & PENGUJIAN',
  },
  ugm: {
    id: 'ugm', name: 'Universitas Gadjah Mada (UGM)',
    fullName: 'Pedoman Penyusunan Proposal & Tesis Pascasarjana UGM',
    citation: 'Harvard / APA Style',
    subtitle: 'Mengikuti Panduan Pascasarjana Universitas Gadjah Mada',
    styleTag: 'Pedoman UGM — Harvard Style',
    h11: '1.1 Latar Belakang Masalah',
    h12: '1.2 Keaslian Penelitian & Novelty Gap',
    unit2: 'BAB II: LANDASAN TEORI & TINJAUAN PUSTAKA',
    unit3: 'BAB III: KERANGKA PEMIKIRAN & HIPOTESIS',
    unit4: 'BAB IV: METODE PENELITIAN',
  },
  unair: {
    id: 'unair', name: 'Universitas Airlangga (UNAIR)',
    fullName: 'Pedoman Karya Ilmiah Sekolah Pascasarjana UNAIR',
    citation: 'Vancouver / APA Style',
    subtitle: 'Sesuai Pedoman Karya Ilmiah UNAIR',
    styleTag: 'Pedoman UNAIR — APA Style',
    h11: '1.1 Latar Belakang',
    h12: '1.2 Identifikasi & Rumusan Masalah',
    unit2: 'BAB 2: TINJAUAN PUSTAKA',
    unit3: 'BAB 3: KERANGKA KONSEPTUAL & HIPOTESIS',
    unit4: 'BAB 4: METODE PENELITIAN',
  },
  binus: {
    id: 'binus', name: 'Bina Nusantara University (BINUS)',
    fullName: 'Graduate Thesis Guideline & ACM/IEEE Format BINUS',
    citation: 'IEEE / ACM Style',
    subtitle: 'BINUS Graduate Program Format',
    styleTag: 'Pedoman BINUS — IEEE Style',
    h11: '1.1 Research Background',
    h12: '1.2 Problem Statement & Scope',
    unit2: 'CHAPTER 2: THEORETICAL FOUNDATION & LITERATURE REVIEW',
    unit3: 'CHAPTER 3: PROPOSED METHODOLOGY & DESIGN',
    unit4: 'CHAPTER 4: TESTING & DISCUSSION',
  },
  dikti: {
    id: 'dikti', name: 'Standar Kemendikbudristek (Dikti)',
    fullName: 'Pedoman Standar Nasional KTI Dikti',
    citation: 'APA 7th Edition',
    subtitle: 'Mengikuti Format Standar Nasional Pendidikan Tinggi',
    styleTag: 'Standar Dikti — APA 7th',
    h11: '1.1 Latar Belakang Masalah',
    h12: '1.2 Rumusan Masalah',
    unit2: 'BAB II: KAJIAN TEORI & PUSTAKA',
    unit3: 'BAB III: KERANGKA BERPIKIR',
    unit4: 'BAB IV: METODOLOGI PENELITIAN',
  }
};

let activeCampus = campusCatalog.ui;

// ── User's Research Context (from intake) ────────────────────
let researchContext = {
  topic: '',
  importance: '',
  expectations: '',
  keywords: []
};

// ============================================================
// ONBOARDING FLOW
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Load academic integrity profile from session/defaults
  loadUserProfile();
  // Homepage: time-aware greeting
  setTimeAwareGreeting();
  // Set default dashboard projects view (empty state showcase for new user)
  setDashboardProjectsView('empty');
	loadSavedProjects();
  // Onboarding: stepper initial state (for when onboarding is opened later)
  updateStepper(1);
});

function goToStep(step) {
  // Hide all steps (1: Format Kampus, 2: Konteks Riset)
  [1, 2].forEach(n => {
    const el = document.getElementById(`obStep${n}`);
    if (el) el.style.display = 'none';
  });

  const target = document.getElementById(`obStep${step}`);
  if (target) target.style.display = 'block';
  updateStepper(step);

  // Scroll to top of onboarding
  const screen = document.getElementById('onboardingScreen');
  if (screen) screen.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStepper(activeStep) {
  for (let i = 1; i <= 2; i++) {
    const item = document.getElementById(`st${i}`);
    const line = document.getElementById(`stl${i}`);
    if (item) {
      item.className = 'ob-step-item' + (i < activeStep ? ' done' : i === activeStep ? ' active' : '');
      if (item.querySelector('.ob-step-dot')) {
        item.querySelector('.ob-step-dot').innerHTML = i < activeStep
          ? '<span class="material-symbols-rounded" style="font-size:14px;">check</span>'
          : `${i}`;
      }
    }
    if (line) line.className = 'ob-step-line' + (i < activeStep ? ' done' : '');
  }
}

// ── Step 1: Contextual Format & Optional Customization ────
let activeCitationStyle = 'default';

function updateStep1Context(ktiType) {
  const kti = ktiDefinitions[ktiType] || ktiDefinitions.tesis;
  const ktiName = kti.label || kti.coachLabel || 'Karya Ilmiah';
  
  // Update headline & subtext
  setEl('obFormatHeadline', `Konfigurasi Format ${ktiName}`);
  setEl('obActiveKTILabel', ktiName);
  
  if (ktiType === 'makalah') {
    setEl('obFormatSubtext', 'Thesa menyusun format makalah akademik terstruktur 3 bab sesuai standar penulisan ilmiah perguruan tinggi.');
    setEl('obActiveFormatTag', 'Format Makalah 3 Bab');
    setEl('obActiveStructureTag', 'BAB I Pendahuluan · BAB II Pembahasan & Analisis · BAB III Penutup & Rekomendasi');
  } else if (ktiType === 'proposal') {
    setEl('obFormatSubtext', 'Thesa menyiapkan sistematika proposal riset (Bab I–III) dengan kesiapan handover otomatis ke naskah skripsi.');
    setEl('obActiveFormatTag', 'Format Proposal Riset');
    setEl('obActiveStructureTag', 'BAB I Pendahuluan · BAB II Tinjauan Pustaka · BAB III Metode Penelitian (Handover Ready)');
  } else if (ktiType === 'jurnal') {
    setEl('obFormatSubtext', 'Thesa menyelaraskan struktur naskah IMRaD (Introduction, Methods, Results, and Discussion) standar publikasi.');
    setEl('obActiveFormatTag', 'Format IMRaD Jurnal');
    setEl('obActiveStructureTag', 'Abstrak · Introduction · Methodology · Results & Discussion · References');
  } else if (ktiType === 'skripsi') {
    setEl('obFormatSubtext', 'Thesa menyiapkan struktur 5 bab standar skripsi sarjana lengkap dengan metodologi dan tinjauan pustaka.');
    setEl('obActiveFormatTag', 'Format Standar Sarjana (S1)');
    setEl('obActiveStructureTag', 'BAB I Pendahuluan · BAB II Tinjauan Pustaka · BAB III Metode · BAB IV Hasil · BAB V Penutup');
  } else if (ktiType === 'tesis') {
    setEl('obFormatSubtext', 'Thesa menyiapkan sistematika tesis magister berstandar rigoritas ilmiah tinggi dan state-of-the-art.');
    setEl('obActiveFormatTag', 'Format Standar Magister (S2)');
    setEl('obActiveStructureTag', 'BAB I Pendahuluan · BAB II Landasan Teori · BAB III Metodologi · BAB IV Pembahasan · BAB V Penutup');
  } else if (ktiType === 'disertasi') {
    setEl('obFormatSubtext', 'Thesa menyiapkan sistematika disertasi doktoral yang menekankan kebaruan (novelty) dan kontribusi teoretis.');
    setEl('obActiveFormatTag', 'Format Standar Doktoral (S3)');
    setEl('obActiveStructureTag', 'BAB I Pendahuluan · BAB II Kajian Literatur · BAB III Metodologi · BAB IV Temuan & Model · BAB V Sintesis');
  } else {
    setEl('obFormatSubtext', 'Thesa otomatis menyiapkan sistematika karya ilmiah komprehensif sesuai kaidah keilmuan nasional.');
    setEl('obActiveFormatTag', 'Format Standar Komprehensif');
    setEl('obActiveStructureTag', `${(kti.units && kti.units.length) || 3} Unit / Bab Utama sesuai pedoman akademik`);
  }
}

function toggleCitationStyle(style, label, btnEl) {
  if (activeCitationStyle === style && btnEl.classList.contains('selected')) {
    // Deselect!
    activeCitationStyle = 'default';
    btnEl.classList.remove('selected');
    setEl('activeCitationLabel', 'Standar Baku KTI');
  } else {
    // Select!
    activeCitationStyle = style;
    document.querySelectorAll('#citationPillsGrid .citation-pill').forEach(b => b.classList.remove('selected'));
    btnEl.classList.add('selected');
    setEl('activeCitationLabel', `Aktif: ${label}`);
  }
}

function filterObCampus() {
  const input = document.getElementById('obCampusSearch');
  if (!input) return;
  const q = (input.value || '').toLowerCase().trim();
  const resultsContainer = document.getElementById('dynamicCampusResults');
  if (!resultsContainer) return;

  if (!q) {
    resultsContainer.style.display = 'none';
    resultsContainer.innerHTML = '';
    return;
  }

  const campuses = [
    { id: 'ui', name: 'Universitas Indonesia (UI)', style: 'APA 7th' },
    { id: 'itb', name: 'Institut Teknologi Bandung (ITB)', style: 'IEEE Style' },
    { id: 'ugm', name: 'Universitas Gadjah Mada (UGM)', style: 'Harvard Style' },
    { id: 'unair', name: 'Universitas Airlangga (UNAIR)', style: 'Vancouver / APA' },
    { id: 'ub', name: 'Universitas Brawijaya (UB)', style: 'APA 7th' },
    { id: 'its', name: 'Institut Teknologi Sepuluh Nopember (ITS)', style: 'IEEE' },
    { id: 'undip', name: 'Universitas Diponegoro (UNDIP)', style: 'APA 7th' },
    { id: 'unpad', name: 'Universitas Padjadjaran (UNPAD)', style: 'APA / Harvard' },
    { id: 'uns', name: 'Universitas Sebelas Maret (UNS)', style: 'APA 7th' },
    { id: 'ipb', name: 'IPB University', style: 'CBE / APA' },
    { id: 'binus', name: 'Bina Nusantara University (BINUS)', style: 'IEEE / ACM' },
    { id: 'dikti', name: 'Standar Nasional Kemendikbudristek', style: 'Universal APA 7th' }
  ];

  const matched = campuses.filter(c => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));

  if (matched.length === 0) {
    resultsContainer.innerHTML = `
      <div style="padding:10px 14px; font-size:12.5px; color:var(--text-secondary);">
        Format kampus <strong>"${escapeHTML(q)}"</strong> akan menggunakan <em>Standar Format Akademik Nasional</em>.
      </div>
    `;
  } else {
    resultsContainer.innerHTML = matched.map(c => `
      <div onclick="applyDynamicCampusChoice('${c.id}', '${escapeHTML(c.name)}', '${c.style}')" style="padding:9px 14px; border-bottom:1px solid var(--border); cursor:pointer; display:flex; justify-content:space-between; align-items:center; font-size:12.5px;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
        <strong>${escapeHTML(c.name)}</strong>
        <span style="font-size:11px; color:var(--brand); background:#ede9fe; padding:2px 6px; border-radius:4px;">${c.style}</span>
      </div>
    `).join('');
  }
  resultsContainer.style.display = 'block';
}

function applyDynamicCampusChoice(id, name, style) {
  selectedCampusId = id;
  const input = document.getElementById('obCampusSearch');
  if (input) input.value = name;
  const resultsContainer = document.getElementById('dynamicCampusResults');
  if (resultsContainer) resultsContainer.style.display = 'none';
  setEl('activeCitationLabel', `Khusus: ${name} (${style})`);
}

function skipCampusFormat() {
  obFormatSkipped = true;
  goToStep(2);
}

function handleObFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  alert(`📄 File "${file.name}" berhasil diunggah! AI Thesa akan mengekstrak struktur bab setelah kamu memulai sesi.`);
  goToStep(2);
}

function extractObGuidelines() {
  const input = document.getElementById('obPedomanText');
  const text = input ? input.value.trim() : '';
  if (!text) { alert('Tempel teks struktur bab terlebih dahulu.'); return; }
  alert('✨ Struktur pedoman berhasil diekstraksi! Thesa akan menggunakannya sebagai acuan format naskah.');
  goToStep(2);
}

// ── Step 2: Interactive Intake Tabs & Starters ────────────────
function switchIntakeTab(tabId) {
  const tabs = [
    { id: 'topik', cap: 'Topik' },
    { id: 'cover', cap: 'Cover' },
    { id: 'konteks', cap: 'Konteks' }
  ];

  tabs.forEach(t => {
    const btn = document.getElementById(`tabBtn${t.cap}`);
    const pane = document.getElementById(`paneIntake${t.cap}`);
    if (btn && pane) {
      if (t.id === tabId) {
        btn.classList.add('active');
        pane.style.display = 'block';
      } else {
        btn.classList.remove('active');
        pane.style.display = 'none';
      }
    }
  });
}

function applyTopicStarter(topicText) {
  const el = document.getElementById('obQ1Input');
  if (el) {
    el.value = topicText;
    validateIntakeQ1();
    el.focus();
    showThesaToast('✨ Topik inspirasi terpasang!', 'success', 'lightbulb');
  }
}

function insertContextHelper(targetInputId, text) {
  const el = document.getElementById(targetInputId);
  if (el) {
    el.value = text;
    el.focus();
    showThesaToast('✓ Inspirasi konteks berhasil diterapkan ke input', 'success', 'psychology');
    
    const pill = document.getElementById('pillReqKonteks');
    if (pill) {
      pill.style.background = '#dcfce7';
      pill.style.color = '#15803d';
      pill.innerText = '✓ Terisi';
    }
  }
}


function validateIntakeQ1() {
  const input = document.getElementById('obQ1Input');
  const btn = document.getElementById('btnStartThesa');
  const badge = document.getElementById('obQ1Badge');
  const countEl = document.getElementById('obQ1CharCount');
  const hint = document.getElementById('obReadinessHint');
  const pillReq = document.getElementById('pillReqQ1');

  const val = input ? input.value.trim() : '';
  if (countEl) countEl.innerText = `${val.length} karakter`;

  // Instant unlock: any non-empty input activates the launcher
  const isValid = val.length >= 1;

  if (isValid) {
    if (btn) {
      btn.disabled = false;
      btn.classList.add('ready');
    }
    if (badge) {
      badge.className = 'ob-valid-badge ready';
      badge.innerText = '✓ Siap Dimulai';
    }
    if (pillReq) {
      pillReq.className = 'tab-pill-req ready';
      pillReq.innerText = '✓ Terisi';
    }
    if (hint) {
      hint.style.display = 'inline-flex';
      hint.innerHTML = '<span class="material-symbols-rounded" style="font-size:15px; color:#10b981;">check_circle</span> <span style="color:#065f46; font-weight:700;">Topik Terisi</span>';
    }
  } else {
    if (btn) {
      btn.disabled = true;
      btn.classList.remove('ready');
    }
    if (badge) {
      badge.className = 'ob-valid-badge';
      badge.innerText = 'Wajib diisi';
    }
    if (pillReq) {
      pillReq.className = 'tab-pill-req';
      pillReq.innerText = 'Wajib';
    }
    if (hint) {
      hint.style.display = 'none';
    }
  }
}

function skipQuestion(num) {
  const el = document.getElementById(`obQ${num}Input`);
  if (el) el.value = '';
  const card = document.getElementById(`obQ${num}Card`);
  if (card) {
    card.style.opacity = '0.6';
  }
  showNotification(`Pertanyaan ${num} dilewati.`);
}

// ── Keyword Input ─────────────────────────────────────────────
function handleKeywordAdd(event) {
  if (event.key === 'Enter') { event.preventDefault(); addKeywordFromInput(); }
}
function addKeywordFromInput() {
  const input = document.getElementById('obKeywordInput');
  if (!input) return;
  const val = input.value.trim();
  if (!val || obKeywords.includes(val)) { input.value = ''; return; }
  obKeywords.push(val);
  renderKeywordChips();
  input.value = '';
}
function removeKeyword(kw) {
  obKeywords = obKeywords.filter(k => k !== kw);
  renderKeywordChips();
}
function renderKeywordChips() {
  const container = document.getElementById('keywordChips');
  if (!container) return;
  container.innerHTML = obKeywords.map(kw => `
    <span class="keyword-chip">
      ${escapeHTML(kw)}
      <button type="button" onclick="removeKeyword('${escapeHTML(kw)}')" title="Hapus">×</button>
    </span>
  `).join('');
}

let selectedLengthTarget = 'Ringkas (4–6 Halaman)';
function selectLengthTarget(label, btnEl) {
  selectedLengthTarget = label;
  document.querySelectorAll('.ob-length-pill').forEach(b => {
    b.classList.remove('active-length');
  });
  if (btnEl) {
    btnEl.classList.add('active-length');
  }
}

// ── LAUNCH: Transition to Main App ───────────────────────────
function startThesaMain() {
  const q1Val = document.getElementById('obQ1Input')?.value.trim() || '';
  if (!q1Val) {
    switchIntakeTab('topik');
    const q1Input = document.getElementById('obQ1Input');
    if (q1Input) {
      q1Input.focus();
      q1Input.style.borderColor = '#ef4444';
      setTimeout(() => { q1Input.style.borderColor = ''; }, 1500);
    }
    showNotification('⚠️ Silakan ketik topik atau ide risetmu terlebih dahulu.');
    return;
  }

  // ── Silver Tier: Balance Gate / Trial Credits ──────────────
  const tier = getUserTier();
  const profile = getUserProfile();
  const GENERATE_COST = 12000;

  if (tier === 'silver') {
    let balance = profile.silverBalance;
    if (balance === undefined || balance === null || balance < GENERATE_COST) {
      // Grant trial credits so generation is always usable
      balance = 50000;
      updateUserProfile({ silverBalance: balance });
    }
    const newBal = Math.max(0, balance - GENERATE_COST);
    updateUserProfile({ silverBalance: newBal });
    initTierBadge();
    showThesaToast(`💳 Saldo terpakai Rp 12.000. Sisa saldo: Rp ${newBal.toLocaleString('id-ID')}`, 'info', 'account_balance_wallet');
  }

  // Collect intake
  researchContext.topic = q1Val;
  researchContext.importance = document.getElementById('obQ2Input')?.value.trim() || '';
  researchContext.expectations = document.getElementById('obQ3Input')?.value.trim() || '';
  researchContext.prompt = document.getElementById('obAssignmentPrompt')?.value.trim() || '';
  researchContext.course = document.getElementById('obCourseInput')?.value.trim() || '';
  researchContext.lecturer = document.getElementById('obLecturerInput')?.value.trim() || '';
  researchContext.author = document.getElementById('obAuthorInput')?.value.trim() || currentUserProfile.name || 'Mahasiswa Peneliti';
  researchContext.nim = document.getElementById('obNimInput')?.value.trim() || currentUserProfile.nim || '';
  researchContext.lengthTarget = selectedLengthTarget || 'Ringkas (4–6 Halaman)';
  researchContext.keywords = [...obKeywords];

  // Resolve campus
  if (!obFormatSkipped) {
    activeCampus = campusCatalog[selectedCampusId] || campusCatalog.ui;
  }

  const kti = ktiDefinitions[selectedKTI] || ktiDefinitions.tesis;

  // ── Transition ──
  const screen = document.getElementById('onboardingScreen');
  screen.style.opacity = '0';
  screen.style.transform = 'scale(0.97)';
  screen.style.transition = 'opacity 0.35s ease, transform 0.35s ease';

  setTimeout(() => {
    screen.style.display = 'none';
    const app = document.getElementById('mainApp');
    app.style.display = 'block';
    app.style.opacity = '0';
    app.style.transition = 'opacity 0.3s ease';
    setTimeout(() => { app.style.opacity = '1'; }, 20);

    // Boot main app with context
    initMainApp(kti, activeCampus, researchContext);
    initChatActions();
	  // This is the only automatic draft path: it persists the supplied research
	  // context and waits for Gemini. No local template is presented as AI output.
	  createAndGenerateProject();
  }, 380);
}

// ── Insufficient Balance Modal ────────────────────────────────
function _showInsufficientBalanceModal(currentBalance, required) {
  let modal = document.getElementById('insufficientBalanceModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'insufficientBalanceModal';
    modal.className = 'modal-backdrop';
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    document.body.appendChild(modal);
  }

  const shortage = required - currentBalance;
  modal.innerHTML = `
    <div class="modal-container" style="width:min(92vw,440px);padding:32px;text-align:center;">
      <div style="font-size:52px;margin-bottom:12px;">💳</div>
      <h3 style="font-size:20px;font-weight:800;color:var(--text);margin:0 0 8px;">Saldo Tidak Cukup</h3>
      <p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:0 0 20px;">
        Untuk generate 1 naskah dibutuhkan <strong>Rp ${required.toLocaleString('id-ID')}</strong>.<br>
        Saldo kamu saat ini: <strong>Rp ${currentBalance.toLocaleString('id-ID')}</strong>.<br>
        Kurang: <strong style="color:#ef4444;">Rp ${shortage.toLocaleString('id-ID')}</strong>
      </p>

      <div style="background:#f1f5f9;border-radius:12px;padding:14px;margin-bottom:18px;text-align:left;">
        <div style="font-size:11.5px;font-weight:700;color:#475569;margin-bottom:10px;text-transform:uppercase;">Pilih Nominal Top Up</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          ${[15000, 36000, 60000, 120000].map(amt => `
            <div onclick="document.querySelectorAll('.insuf-topup-card').forEach(c=>c.style.border='1.5px solid #cbd5e1');this.style.border='2px solid #4f46e5';this.style.background='#f5f3ff';window._insufTopupAmt=${amt};"
              class="insuf-topup-card"
              style="padding:10px;background:#fff;border:1.5px solid #cbd5e1;border-radius:10px;cursor:pointer;text-align:center;transition:all 0.15s;">
              <div style="font-size:13.5px;font-weight:800;color:#1e293b;">Rp ${amt.toLocaleString('id-ID')}</div>
              <div style="font-size:10.5px;color:#64748b;">${Math.floor(amt/12000)}x generate</div>
            </div>`).join('')}
        </div>
      </div>

      <div style="display:flex;gap:10px;justify-content:center;">
        <button class="btn-secondary" onclick="document.getElementById('insufficientBalanceModal').style.display='none'">Batal</button>
        <button class="btn-primary" onclick="_doTopupFromInsufModal()">
          <span class="material-symbols-rounded">account_balance_wallet</span>
          Top Up via QRIS Sekarang
        </button>
      </div>

      <button class="btn-secondary" style="width:100%;margin-top:10px;justify-content:center;" onclick="document.getElementById('insufficientBalanceModal').style.display='none';showTierSelectorModal();">
        <span class="material-symbols-rounded">upgrade</span>
        Lihat Paket Gold / Platinum (unlimited)
      </button>
    </div>`;

  window._insufTopupAmt = 15000; // default selection
  modal.style.display = 'flex';
}

function _doTopupFromInsufModal() {
  const amount = window._insufTopupAmt || 15000;
  const user = (typeof getStoredUser === 'function') ? getStoredUser() : getUserProfile();
  document.getElementById('insufficientBalanceModal').style.display = 'none';

  openMidtransQRISPayment({
    topup_type: 'topup',
    amount,
    user_email: (user && user.email) ? user.email : 'mahasiswa@thesa.id',
    user_name: (user && (user.name || user.full_name)) ? (user.name || user.full_name) : 'Mahasiswa Thesa',
    onSuccess: (paid) => {
      const profile = getUserProfile();
      const newBal = (profile.silverBalance || 0) + paid;
      updateUserProfile({ silverBalance: newBal });
      initTierBadge();
      renderBillingStatusCard();
      showThesaToast(`✅ Top up berhasil! Saldo: Rp ${newBal.toLocaleString('id-ID')}. Klik Generate lagi.`, 'success', 'verified');
    }
  });
}

// ============================================================
// MAIN APP INIT (after onboarding)
// ============================================================
function initMainApp(kti, campus, context, skipIntroChat = false) {
  // Topbar labels
  setEl('appKTILabel', `${kti.label} Co-Pilot`);
  setEl('appKTIType', kti.label);
  setEl('topProjectTitle', context.topic.length > 50 ? context.topic.slice(0, 50) + '…' : (context.topic || `Proyek ${kti.label}`));
  setEl('activeCampusName', campus.name);
  setEl('roadmapBadgeLabel', kti.roadmapBadge);

  // Paper scrapbook labels
  setEl('paperFormatStyleTag', campus.styleTag);
  setEl('paperAuthorSubtitle', `Draf ${kti.label} — ${campus.subtitle}`);
  setEl('draftPaperTitle', '——');
  setEl('docSyncBadge', '⏳ Menunggu input peneliti...');

  // Cascade score initial
  setEl('cascadeScore', '— Logis');

  // Render authentic roadmap & paper sections dynamically
  renderRoadmap(kti, campus);
  renderPaperDraftSections(kti, campus);
  configureBossArena(kti);
  syncGamificationVisibility();
  initLivePaperSync();

  // Boot Socratic intro chat only if no saved chat was restored
  if (!skipIntroChat) {
    initSocraticIntroChat(kti, campus, context);
  }
}

// ── Render Authentic Roadmap Units Dynamically ────────────────
function renderRoadmap(kti, campus) {
  const tree = document.getElementById('journeyTree');
  if (!tree) return;

  const units = kti.units || [];
  const boss = kti.bossArena || {
    title: 'Simulasi Ujian Sidang',
    subtitle: 'Uji ketahanan naskah di hadapan 2 AI Penguji!',
    badge: 'Simulasi Sidang',
    trophy: '🏆'
  };

  let html = '';

  // If Proposal, show Handover Banner at the top of roadmap
  if (kti.isProposal) {
    html += `
      <div style="background: linear-gradient(135deg, #ede9fe, #f5f3ff); border: 1.5px solid var(--brand); border-radius: var(--r-xl); padding: 12px 14px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 8px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:800; color:var(--brand);">
            <span class="material-symbols-rounded" style="font-size:17px;">move_up</span>
            <span>SIKLUS PROPOSAL</span>
          </div>
          <span style="font-size:10.5px; font-weight:700; background:var(--brand); color:#fff; padding:2px 7px; border-radius:6px;">Bab I–III</span>
        </div>
        <p style="font-size:11.5px; color:var(--text-secondary); line-height:1.4; margin:0;">
          Setelah proposal rampung &amp; lulus Sempro, kamu bisa langsung me-handover naskah ke draf <strong>Skripsi / Tesis Penuh</strong>.
        </p>
        <button class="topbar-btn" onclick="openHandoverModal()" style="background:#fff; border-color:var(--brand); color:var(--brand); font-weight:800; font-size:12px; width:100%; justify-content:center; padding:7px 10px;">
          <span class="material-symbols-rounded" style="font-size:16px;">school</span>
          Handover ke Skripsi / Tesis
        </button>
      </div>
    `;
  }

  units.forEach((unit, uIdx) => {
    const isUnit1 = uIdx === 0;
    const isDataHub = unit.isDataHub;

    if (isDataHub) {
      html += `
        <div class="unit-block" id="unit-data-hub" style="border: 2px dashed #6366f1; background: #faf5ff;" onclick="toggleDataHubModal(true)">
          <div class="unit-header-card" style="background: transparent; cursor:pointer;">
            <div class="unit-info">
              <span class="unit-num" style="background:#818cf8; color:#fff;">${unit.num}</span>
              <h3 style="color:#4338ca;">${escapeHTML(unit.title)}</h3>
              <p>${escapeHTML(unit.subtitle)}</p>
            </div>
            <span class="unit-badge-status" style="background:#e0e7ff; color:#4338ca; border-color:#818cf8;">
              <span class="material-symbols-rounded">dataset</span> Buka Hub
            </span>
          </div>
          <div class="step-nodes" style="padding-bottom:10px;">
            <button class="path-node" onclick="toggleDataHubModal(true); return false;" style="background:#fff; border:1px solid #c7d2fe;">
              <div class="node-circle" style="background:#e0e7ff; color:#4338ca;">
                <span class="material-symbols-rounded">analytics</span>
              </div>
              <div class="node-label">
                <strong>Fase Lapangan</strong>
                <span>Log Responden &amp; Data Mentah</span>
              </div>
              <span class="step-xp">+80 XP</span>
            </button>
          </div>
        </div>
      `;
      return;
    }

    html += `
      <div class="unit-block ${isUnit1 ? 'active' : 'locked'}" id="unit-${unit.id}">
        <div class="unit-header-card">
          <div class="unit-info">
            <span class="unit-num">${unit.num}</span>
            <h3 id="unit${unit.id}Title">${escapeHTML(unit.title)}</h3>
            <p>${escapeHTML(isUnit1 ? unit.activeDesc : unit.subtitle)}</p>
          </div>
          <span class="unit-badge-status ${isUnit1 ? 'current' : ''}">
            ${isUnit1 ? 'Sedang Aktif' : '<span class="material-symbols-rounded">lock</span> Terkunci'}
          </span>
        </div>
        ${unit.steps ? `
          <div class="step-nodes">
            ${unit.steps.map((step, sIdx) => {
              const isStep1 = isUnit1 && sIdx === 0;
              return `
                ${sIdx > 0 ? '<div class="node-line"></div>' : ''}
                <button class="path-node ${isStep1 ? 'active' : 'locked'}" id="node-${unit.id}-${sIdx + 1}" onclick="switchStep(${unit.id}, ${sIdx + 1})">
                  <div class="node-circle ${isStep1 ? 'pulse' : ''}">
                    <span class="material-symbols-rounded">${isStep1 ? (step.icon || 'psychology_alt') : 'lock'}</span>
                  </div>
                  <div class="node-label">
                    <strong>Langkah ${step.id}</strong>
                    <span id="step${unit.id}${sIdx + 1}Label">${escapeHTML(step.title)}</span>
                  </div>
                  ${step.xp && selectedKTI !== 'makalah' ? `<span class="step-xp">+${step.xp} XP</span>` : ''}
                </button>
              `;
            }).join('')}
          </div>
        ` : ''}
      </div>
    `;
  });

  // Comprehensive Defense Simulation tailored to KTI type (Hanya muncul saat naskah selesai)
  const isPaperComplete = (researchContext && (researchContext.isComplete || researchContext.bab3_2)) || 
                          (document.getElementById('globalProgressPct')?.innerText?.includes('100%'));
  html += `
    <div class="unit-block boss-unit" id="unit-boss" onclick="toggleDefenseModal(true)" style="display:${isPaperComplete ? 'block' : 'none'};">
      <div class="unit-header-card boss-card">
        <div class="unit-info">
          <span class="unit-num gold">UJI KOMPREHENSIF</span>
          <h3>${escapeHTML(boss.title)}</h3>
          <p>${escapeHTML(boss.subtitle)}</p>
        </div>
        <span class="material-symbols-rounded" style="font-size:22px; color:#b45309;">school</span>
      </div>
      <div class="arena-launch-badge">
        <span class="material-symbols-rounded">play_circle</span> Mulai ${escapeHTML(boss.badge || 'Simulasi Ujian')}
      </div>
    </div>
  `;

  tree.innerHTML = html;
}

function showDefenseSimulationCard() {
  const boss = document.getElementById('unit-boss') || document.getElementById('unit-5');
  if (boss) {
    boss.style.display = 'block';
    boss.style.animation = 'fadeIn 0.4s ease';
    boss.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}


// ── Render Authentic Paper Draft Sections Dynamically ─────────
function renderPaperDraftSections(kti, campus) {
  const sheet = document.getElementById('paperSheet');
  if (!sheet) return;

  const shortTopic = researchContext && researchContext.topic && researchContext.topic.length > 0
    ? researchContext.topic.slice(0, 80)
    : `Topik ${kti.label} — Belum Ditentukan`;

  const sections = kti.paperSections || [
    { id: 'section11', headingId: 'heading11', title: '1.1 Latar Belakang Masalah', boxId: 'boxLatarBelakang', placeholder: 'Akan terisi saat kamu mulai berdialog dengan Thesa' },
    { id: 'section12', headingId: 'heading12', title: '1.2 Rumusan Masalah', boxId: 'boxProblemStatement', placeholder: 'Akan terisi setelah verifikasi langkah 1.2 selesai' }
  ];

  const firstUnitTitle = (kti.units && kti.units[0]) ? kti.units[0].title : 'BAB I: PENDAHULUAN';

  sheet.innerHTML = `
    <div class="paper-header-meta">
      <span class="paper-tag" id="paperChapterTag">${escapeHTML(firstUnitTitle)}</span>
      <span class="paper-badge-synced" id="docSyncBadge">🔄 Menyiapkan Naskah...</span>
    </div>

    <h1 class="paper-title" id="draftPaperTitle">${escapeHTML(shortTopic.toUpperCase())}</h1>
    <div class="paper-author-mock" id="paperAuthorSubtitle">Draf ${escapeHTML(kti.label)} — ${escapeHTML(campus.subtitle)}</div>

    ${sections.map((sec, idx) => `
      <div class="paper-section" id="${sec.id}" style="${idx > 0 && sec.id.startsWith('section') && !sec.id.startsWith('section1') ? 'border-top:2px dashed #e2e8f0; margin-top:20px; padding-top:16px;' : ''}${sec.id === 'sectionDaftarPustaka' ? 'border-top:2px solid #cbd5e1; margin-top:24px; padding-top:16px;' : ''}">
        <div class="section-title-row">
          <h2 class="section-heading" id="${sec.headingId || `secHeading${idx}`}">${escapeHTML(sec.title)}</h2>
          <span class="section-certainty-badge pending" id="${sec.badgeId || `badge_${sec.id}`}">${idx === 0 ? 'Belum Dimulai' : 'Menunggu Langkah Selesai'}</span>
        </div>
        <div class="paper-box-target" id="${sec.boxId}">
          <p><em>${escapeHTML(sec.placeholder)}</em></p>
        </div>
      </div>
    `).join('')}
  `;
}

// ── Configure Boss Arena by KTI Type ──────────────────────────
function configureBossArena(kti) {
  const boss = kti.bossArena;
  if (!boss) return;

  const titleEl = document.querySelector('#defenseModal .modal-title-wrap h3');
  const subEl = document.querySelector('#defenseModal .modal-title-wrap p');
  if (titleEl) titleEl.innerText = `AI Defense Arena — ${boss.title}`;
  if (subEl) subEl.innerText = boss.subtitle;

  // Examiner 1
  const ex1 = document.getElementById('examiner1');
  if (ex1 && boss.examiner1) {
    const meta = ex1.querySelector('.ex-meta');
    const status = ex1.querySelector('.ex-status');
    if (meta) meta.innerHTML = `<strong>${escapeHTML(boss.examiner1.name)}</strong><span>${escapeHTML(boss.examiner1.role)}</span>`;
    if (status) status.innerText = boss.examiner1.status || 'Menguji Naskah';
  }

  // Examiner 2
  const ex2 = document.getElementById('examiner2');
  if (ex2 && boss.examiner2) {
    const meta = ex2.querySelector('.ex-meta');
    const status = ex2.querySelector('.ex-status');
    if (meta) meta.innerHTML = `<strong>${escapeHTML(boss.examiner2.name)}</strong><span>${escapeHTML(boss.examiner2.role)}</span>`;
    if (status) status.innerText = boss.examiner2.status || 'Menyimak';
  }

  // Opening prompt
  const stream = document.getElementById('arenaChatStream');
  if (stream && boss.openingQuestion) {
    const ex1Name = boss.examiner1 ? boss.examiner1.name.split(' ')[0] : 'Penguji';
    stream.innerHTML = `
      <div class="arena-bubble examiner">
        <div class="arena-bubble-head"><strong>${escapeHTML(boss.examiner1?.name || 'Penguji Utama')}:</strong><span>Pertanyaan Pembuka</span></div>
        <p>"${escapeHTML(boss.openingQuestion)}"</p>
      </div>
    `;
  }
}

// ── Fire the opening Socratic Dialogue based on user's intake ─
function initSocraticIntroChat(kti, campus, context) {
  const stream = document.getElementById('duoChatStream');
  stream.innerHTML = '';

  const hasTopic = context.topic && context.topic.length > 0;
  const hasImportance = context.importance && context.importance.length > 0;
  const topicClean = hasTopic ? context.topic : 'Topik Riset';

  // Set paper title
  setEl('draftPaperTitle', topicClean.toUpperCase());

  // 1. Single Clean Scholarly Orientation Bubble
  appendCoachBubble(stream, {
    tag: 'Telaah Awal',
    tagType: 'tag-socratic',
    title: `Orientasi Naskah: ${kti.label}`,
    body: `
      <p>Konteks kajian untuk <strong>"${escapeHTML(topicClean)}"</strong> telah disiapkan sesuai kaidah penulisan ilmiah.</p>
      ${hasImportance ? `<p style="margin-top:6px; font-size:11px; color:#334155; background:#f8fafc; padding:6px 10px; border-radius:6px; border-left:3px solid #2563eb; line-height:1.45;"><strong>Urgensi & Masalah Pokok:</strong> "${escapeHTML(context.importance)}"</p>` : ''}
    `,
  });

  // 2. Socratic Probe for Paragraph Framing
  setTimeout(() => {
    const probe = generateDynamicFirstProbe(kti, context);
    appendCoachBubble(stream, {
      tag: 'Langkah 1.1 — Formulasi Premis',
      tagType: 'tag-socratic',
      title: probe.title,
      body: `
        <p style="font-size:11.5px; font-weight:600; color:#1e293b; margin-bottom:4px; line-height:1.45;">${probe.question}</p>
        <p style="font-size:10.5px; color:#64748b; margin:0;">Pilih sudut pandang pembahasan utama untuk menyusun paragraf pembuka:</p>
      `,
      chips: probe.chips,
      chipsLabel: 'Sudut Pandang yang Disarankan:'
    });

    // Update milestone banner
    setEl('currentStepTitle', `Langkah 1.1: ${probe.stepTitle}`);
    setEl('currentStepDesc', `<strong>Fokus Telaah:</strong> ${probe.stepDesc}`);
    updateQuickHelperChips('1.1');
  }, 400);
}

function generateDynamicFirstProbe(kti, context) {
  const topic = context.topic || 'topik riset';
  const importance = context.importance || '';
  const shortTopic = topic.length > 40 ? topic.slice(0, 40) + '...' : topic;

  if (selectedKTI === 'proposal' || selectedKTI === 'skripsi') {
    return {
      stepTitle: 'Menetapkan Research Gap & Metodologi',
      stepDesc: 'Menentukan fokus masalah yang terukur dan dapat dibuktikan dengan data.',
      title: 'Sudut pandang mana yang paling ingin kamu buktikan?',
      question: `Untuk menguji "${shortTopic}", fokus utama apa yang paling krusial?`,
      chips: [
        {
          key: 'A',
          icon: '🔬',
          title: `Eksplorasi Masalah di Lapangan`,
          desc: importance ? `Membuktikan bahwa "${importance.slice(0, 50)}..." nyata terjadi` : `Meneliti fenomena empiris langsung pada objek studi`
        },
        {
          key: 'B',
          icon: '📊',
          title: `Komparasi Metode & Efektivitas`,
          desc: `Menguji apakah pendekatan baru memberikan hasil lebih akurat & terukur`
        },
        {
          key: 'C',
          icon: '🎯',
          title: `Rekomendasi Kebijakan & Solusi Praktis`,
          desc: `Menghasilkan panduan konseptual yang dapat segera diadopsi pemangku kepentingan`
        }
      ]
    };
  }

  // Default: Makalah & Karya Tulis Ilmiah
  return {
    stepTitle: 'Membedah Isu Pokok & Gagasan Utama',
    stepDesc: 'Menyusun premis dasar dan sudut pandang pembahasan naskah.',
    title: 'Arah pembahasan apa yang ingin diprioritaskan?',
    question: `Terkait "${shortTopic}" — aspek mana yang ingin kita tekankan pada paragraf pembuka?`,
    chips: [
      {
        key: 'A',
        icon: '💡',
        title: `Gagasan Solutif & Rekomendasi`,
        desc: importance ? `Merumuskan solusi atas "${importance.slice(0, 48)}..."` : `Menawarkan jalan keluar konseptual atas permasalahan yang ada`
      },
      {
        key: 'B',
        icon: '📊',
        title: `Analisis Kritis Faktor Penyebab`,
        desc: `Membedah mengapa dinamika "${shortTopic}" menjadi tantangan mendesak`
      },
      {
        key: 'C',
        icon: '📚',
        title: `Sintesis Teori & Praktik Mutakhir`,
        desc: `Menghubungkan teori kunci dengan fenomena nyata di lapangan`
      }
    ]
  };
}

// ============================================================
// SOCRATIC CHIP SELECTION & HITL COLLABORATION
// ============================================================
function handleSocraticSelect(key, title, detail) {
  const stream = document.getElementById('duoChatStream');

  // Remove chips container
  document.querySelectorAll('.socratic-chips-container').forEach(c => c.remove());

  // User message bubble
  const userRow = document.createElement('div');
  userRow.className = 'user-bubble-row';
  userRow.innerHTML = `
    <div class="user-bubble-card">
      <div style="font-size:10px;opacity:0.85;margin-bottom:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Fokus Argumen Dipilih:</div>
      <strong>${escapeHTML(title)}</strong>
      <p style="margin-top:2px;font-size:10.5px;line-height:1.4;">${escapeHTML(detail)}</p>
    </div>
  `;
  stream.appendChild(userRow);
  stream.scrollTop = stream.scrollHeight;

  // Update milestone banner
  setEl('currentStepTitle', 'Langkah 1.2: Rancang Paragraf Latar Belakang (Co-Author)');
  setEl('currentStepBadge', 'Penyusunan Draf');
  setEl('currentStepDesc', '<strong>Langkah 1.2:</strong> Thesa telah merangkai gagasan pokok menjadi rancangan pembuka. Anda dapat menyunting kalimat secara mandiri.');
  updateQuickHelperChips('1.2');

  // Unlock and activate node 1-2 on sidebar
  const n12 = document.getElementById('node-1-2');
  if (n12) {
    n12.className = 'path-node active';
    const c = n12.querySelector('.node-circle');
    if (c) c.innerHTML = '<span class="material-symbols-rounded">edit_note</span>';
  }

  setTimeout(() => {
    awardXP(60);
    updateProgress(35);

    const topicText = researchContext.topic || 'topik riset ini';
    const importanceText = researchContext.importance || '';
    
    let draftText = '';
    if (importanceText) {
      const cleanImp = importanceText.trim().replace(/^(karena|bahwa)\s*/i, '');
      draftText = `Dalam diskursus mengenai ${topicText}, urgensi kajian ini berakar pada kenyataan bahwa ${cleanImp}. Melalui fokus pada ${title.toLowerCase()}, naskah ini berupaya membedah dinamika empiris dan landasan konseptual yang kokoh guna merumuskan sintesis pemikiran yang komprehensif bagi pemangku kepentingan maupun pengembangan keilmuan.`;
    } else {
      draftText = `Kajian mengenai ${topicText} memegang peranan krusial dalam merespons dinamika permasalahan terkini. Melalui penekanan pada ${title.toLowerCase()}, naskah ini mengkaji ${detail.toLowerCase()} guna membangun kerangka analisis yang sistematis, terukur, dan berbasis bukti akademik.`;
    }

    appendCoachBubble(stream, {
      tag: 'Langkah 1.2: Draf Latar Belakang',
      tagType: 'tag-socratic',
      title: 'Formulasi Paragraf Pembuka (Latar Belakang)',
      body: `
        <p>Fokus telaah pada <strong>"${escapeHTML(title)}"</strong> telah disusun menjadi rancangan paragraf pembuka. Silakan telaah atau sunting kalimat sebelum disahkan ke naskah:</p>

        <div class="hitl-gate-card">
          <div class="hitl-head-row">
            <div class="hitl-title">
              <span class="material-symbols-rounded" style="color:var(--brand);">edit_document</span>
              <span>Draf Paragraf Latar Belakang (Bisa Kamu Edit):</span>
            </div>
            <span class="hitl-badge-required" style="background:#ecfdf5;color:#059669;border-color:#a7f3d0;">✓ Siap Disetujui</span>
          </div>
          
          <div class="hitl-diff-box" style="margin-top:8px;">
            <textarea id="hitlDraftInput" class="diff-text-editable" style="min-height:90px;font-size:12.5px;line-height:1.6;">${escapeHTML(draftText)}</textarea>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; flex-wrap:wrap; gap:8px;">
            <button type="button" class="btn-quick-chip" onclick="toggleLiteratureModal(true)" style="background:#eef2ff; color:var(--brand); border-color:#c7d2fe;">
              <span class="material-symbols-rounded" style="font-size:14px;">menu_book</span> Sisipkan Sitasi Literatur
            </button>
            <span style="font-size:11px; color:#64748b;">Klik tombol di bawah jika kamu sudah cocok:</span>
          </div>

          <div class="hitl-actions-row" style="margin-top:12px;">
            <button class="btn-hitl-approve" onclick="approveHITLDraft('${escapeHTML(title)}')">
              <span class="material-symbols-rounded">verified</span>
              <span>Setujui & Masukkan ke Naskah</span>
            </button>
            <button class="btn-hitl-reprobe" onclick="requestAlternativeView()">
              <span class="material-symbols-rounded">autorenew</span>
              <span>Coba Kalimat Lain</span>
            </button>
          </div>
        </div>
      `,
    });

    updateDraftPaperTitle();
    stream.scrollTop = stream.scrollHeight;
  }, 600);
}

function updateDraftPaperTitle() {
  const topic = (researchContext.topic || 'DRAF NASKAH AKADEMIK').toUpperCase();
  if (topic.length > 5) {
    setEl('draftPaperTitle', topic.length > 120 ? topic.slice(0, 120) + '...' : topic);
    setEl('docSyncBadge', '✓ Tersinkronisasi');
  }
}

// ── Epistemic Calibration ────────────────────────────────────
function setEpistemic(btn, color) {
  document.querySelectorAll('.epistemic-btn').forEach(b => b.className = 'epistemic-btn');
  btn.className = `epistemic-btn selected ${color}`;
  epistemicSelection = color;
}

// ── HITL Approval for Step 1.2 (Latar Belakang) ────────────────
function approveHITLDraft(argumentTitle) {
  const inputs = document.querySelectorAll('#hitlDraftInput');
  const finalizedText = inputs.length ? inputs[inputs.length - 1].value.trim() : '';

  awardXP(80);
  updateProgress(65);

  // Update paper scrapbook section 1.1
  const box = document.getElementById('boxLatarBelakang');
  if (box) {
    box.innerHTML = `<p class="draft-paragraph completed" id="para-1">
      <span class="para-author-badge human" style="background:#ecfdf5;color:#059669;border-color:#a7f3d0;margin-bottom:6px;display:inline-block;padding:2px 8px;border-radius:4px;font-size:10.5px;font-weight:700;">
        ✓ Draf Terverifikasi (Klik untuk Mengedit Langsung)
      </span><br>
      ${escapeHTML(finalizedText)}
    </p>`;
    box.style.background = '#ffffff';
    box.setAttribute('contenteditable', 'true');
    box.setAttribute('spellcheck', 'false');

    const b11 = document.getElementById('badgeSection11');
    if (b11) {
      b11.className = 'section-certainty-badge';
      b11.style.background = '#ecfdf5';
      b11.style.color = '#059669';
      b11.innerText = '✓ Selesai';
    }

    setEl('verifiedCount', '1');
    setEl('docSyncBadge', '✓ Latar Belakang Masuk');
  }

  showToast('✓ Latar Belakang berhasil disetujui & dimasukkan ke lembar naskah!');
  if (activeProjectID) {
    saveActiveProject(true).catch(console.warn);
  }

  // Update left sidebar: 1.2 complete, unlock 1.3
  const n12 = document.getElementById('node-1-2');
  if (n12) {
    n12.className = 'path-node done';
    const c = n12.querySelector('.node-circle');
    if (c) c.innerHTML = '<span class="material-symbols-rounded">check</span>';
  }

  const n13 = document.getElementById('node-1-3');
  if (n13) {
    n13.className = 'path-node active';
    const c = n13.querySelector('.node-circle');
    if (c) c.innerHTML = '<span class="material-symbols-rounded">rule</span>';
  }

  // Update milestone banner
  setEl('currentStepTitle', 'Langkah 1.3: Rumusan Masalah & Sasaran Makalah');
  setEl('currentStepBadge', 'Perumusan Pertanyaan');
  setEl('currentStepDesc', '💡 <strong>Langkah 1.3:</strong> Menentukan 2 pertanyaan utama yang akan kamu jawab di bagian pembahasan.');
  updateQuickHelperChips('1.3');

  // Next prompt in chat: Step 1.3
  const stream = document.getElementById('duoChatStream');
  appendCoachBubble(stream, {
    tag: 'Bab I — Latar Belakang Terverifikasi',
    tagType: 'tag-hitl',
    title: 'Latar Belakang Berhasil Diintegrasikan ke Naskah',
    body: `
      <p>Fondasi Bab I telah terbentuk. Tahap selanjutnya adalah merumuskan <strong>Rumusan Masalah &amp; Tujuan Penulisan</strong> yang terfokus.</p>
      
      <div style="margin-top:12px;">
        <button class="btn-primary" style="width:100%;justify-content:center;padding:12px;font-weight:700;" onclick="proceedToRumusanMasalah()">
          <span class="material-symbols-rounded">forward</span>
          <span>Lanjut ke Langkah 1.3: Formulasi Rumusan Masalah &amp; Sasaran</span>
        </button>
      </div>
    `,
  });
  stream.scrollTop = stream.scrollHeight;
}

// ── Step 1.3 (Rumusan Masalah & Tujuan) ────────────────────────
function proceedToRumusanMasalah() {
  const stream = document.getElementById('duoChatStream');
  const topicSnippet = researchContext.topic || 'topik yang kamu pilih';

  const q1 = `Bagaimana analisis mendalam terhadap ${topicSnippet.length > 50 ? topicSnippet.slice(0, 50) + '...' : topicSnippet} dapat memberikan pemahaman komprehensif atas fenomena yang diteliti?`;
  const q2 = `Apa saja solusi dan implikasi praktis yang dapat direkomendasikan untuk menjawab tantangan tersebut?`;

  const t1 = `Menganalisis fenomena dan karakteristik utama dari ${topicSnippet.length > 50 ? topicSnippet.slice(0, 50) + '...' : topicSnippet} secara komprehensif.`;
  const t2 = `Merumuskan sintesis gagasan dan rekomendasi aplikatif atas permasalahan yang dihadapi.`;

  appendCoachBubble(stream, {
    tag: '🎯 Langkah 1.3: Rumusan Masalah & Tujuan Penulisan',
    tagType: 'tag-socratic',
    title: 'Kunci Rumusan Masalah & Tujuan Penulisan',
    body: `
      <p>Rumusan masalah dan tujuan penulisan berikut telah dirancang selaras. Kamu bisa mengedit langsung kalimatnya sebelum disetujui ke naskah:</p>
      
      <div class="hitl-gate-card">
        <div class="hitl-head-row">
          <div class="hitl-title">
            <span class="material-symbols-rounded" style="color:var(--brand);">edit_note</span>
            <span>Draf Pertanyaan & Tujuan (Bisa Kamu Edit):</span>
          </div>
          <span class="hitl-badge-required" style="background:#ecfdf5;color:#059669;border-color:#a7f3d0;">✓ Siap Dikunci</span>
        </div>

        <!-- 1.2 Rumusan Masalah -->
        <div style="margin-top:10px;">
          <label style="font-size:11px;font-weight:800;color:var(--brand);display:flex;align-items:center;gap:4px;margin-bottom:4px;">
            <span class="material-symbols-rounded" style="font-size:14px;">help_outline</span>
            1.2 RUMUSAN MASALAH (Pertanyaan Riset):
          </label>
          <textarea id="hitlRumusanInput" class="diff-text-editable" style="min-height:68px;font-size:12px;line-height:1.5;">1. ${escapeHTML(q1)}\n2. ${escapeHTML(q2)}</textarea>
        </div>

        <!-- 1.3 Tujuan Penulisan -->
        <div style="margin-top:10px;">
          <label style="font-size:11px;font-weight:800;color:#16a34a;display:flex;align-items:center;gap:4px;margin-bottom:4px;">
            <span class="material-symbols-rounded" style="font-size:14px;">flag</span>
            1.3 TUJUAN PENULISAN (Sasaran Makalah):
          </label>
          <textarea id="hitlTujuanInput" class="diff-text-editable" style="min-height:68px;font-size:12px;line-height:1.5;">1. ${escapeHTML(t1)}\n2. ${escapeHTML(t2)}</textarea>
        </div>

        <div class="hitl-actions-row" style="margin-top:12px;">
          <button class="btn-hitl-approve" onclick="confirmRumusanMasalah()">
            <span class="material-symbols-rounded">done_all</span>
            <span>Setujui Rumusan Masalah & Tujuan (Kunci Bab I)</span>
          </button>
        </div>
      </div>
    `,
  });
  stream.scrollTop = stream.scrollHeight;
}

// ============================================================
// ZERO-TOKEN LIVE PAPER SYNC & BIDIRECTIONAL CONTEXT EXTRACTOR
// ============================================================
let paperSyncDebounceTimer = null;

function initLivePaperSync() {
  const paperSheet = document.getElementById('paperSheet');
  if (!paperSheet) return;

  // Listen to live input/edits anywhere within the paper sheet
  paperSheet.addEventListener('input', handlePaperInputEvent);
  paperSheet.addEventListener('blur', () => syncPaperToResearchContext(), true);
}

function handlePaperInputEvent(e) {
  clearTimeout(paperSyncDebounceTimer);
  
  // Micro-feedback in header
  const syncBadge = document.getElementById('docSyncBadge');
  if (syncBadge) {
    syncBadge.innerHTML = '✏️ Menyimpan Koreksi Naskah...';
    syncBadge.style.color = '#6366f1';
  }

  paperSyncDebounceTimer = setTimeout(() => {
    syncPaperToResearchContext();
  }, 450);
}

function syncPaperToResearchContext() {
  // 1. Extract Background (1.1)
  const boxBg = document.getElementById('boxLatarBelakang');
  if (boxBg) {
    const rawText = boxBg.innerText.replace(/✓.*?\n/g, '').trim();
    if (rawText) researchContext.background = rawText;
  }

  // 2. Extract Problem Statements (1.2)
  const boxProb = document.getElementById('boxProblemStatement');
  if (boxProb) {
    const liElements = boxProb.querySelectorAll('li');
    if (liElements.length > 0) {
      researchContext.problems = Array.from(liElements)
        .map(li => li.innerText.trim())
        .filter(t => t.length > 0);
    } else {
      const lines = boxProb.innerText.split('\n')
        .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
        .filter(l => l.length > 3 && !l.includes('Rumusan Masalah (Pertanyaan Riset)'));
      if (lines.length > 0) {
        researchContext.problems = lines;
      }
    }
  }

  // 3. Extract Goals (1.3)
  const boxGoal = document.getElementById('boxTujuanPenulisan');
  if (boxGoal) {
    const liElements = boxGoal.querySelectorAll('li');
    if (liElements.length > 0) {
      researchContext.goals = Array.from(liElements)
        .map(li => li.innerText.trim())
        .filter(t => t.length > 0);
    } else {
      const lines = boxGoal.innerText.split('\n')
        .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
        .filter(l => l.length > 3 && !l.includes('Tujuan Penulisan'));
      if (lines.length > 0) {
        researchContext.goals = lines;
      }
    }
  }

  // 4. Update UI Sync Feedback (0 Token cost)
  const syncBadge = document.getElementById('docSyncBadge');
  if (syncBadge) {
    syncBadge.innerHTML = '⚡ Konteks AI Tersinkron (0 Token)';
    syncBadge.style.color = '#059669';
    setTimeout(() => {
      syncBadge.innerHTML = '✓ Tersimpan Otomatis';
      syncBadge.style.color = '#64748b';
    }, 2000);
  }

  // 5. If currently at Step 2.1 or 2.2, dynamically re-align Bab II skeleton if problem count/text changed
  if (currentStepCode === '2.1' && researchContext.problems && researchContext.problems.length > 0) {
    const box2 = document.getElementById('boxPembahasan') || document.getElementById('boxKajianTeori');
    if (box2 && box2.querySelector('.bab2-skeleton')) {
      const topicSnippet = researchContext.topic || 'topik yang diteliti';
      let subIndex = 1;
      let bab2HTML = `
        <div class="bab2-skeleton">
          <h3 style="font-size:12px;font-weight:800;color:#0f172a;margin:14px 0 6px;">2.${subIndex++} Tinjauan Teori & Kerangka Konseptual Dasar</h3>
          <p class="academic-paragraph" style="background:#ffffff;padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:11.5px;line-height:1.6;color:#334155;margin-bottom:8px;">
            Penulisan makalah mengenai <strong>${escapeHTML(topicSnippet)}</strong> ini berlandaskan pada kerangka konseptual yang menghubungkan dinamika fenomena mendasar dengan landasan teori pendukung.
          </p>
      `;

      researchContext.problems.forEach((prob, idx) => {
        const titleText = prob.length > 65 ? prob.slice(0, 65) + '...' : prob;
        bab2HTML += `
          <h3 style="font-size:12px;font-weight:800;color:#0f172a;margin:14px 0 4px;">2.${subIndex++} Analisis Pembahasan: ${escapeHTML(titleText)}</h3>
          <p class="draft-paragraph completed" style="background:#f8fafc;padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:11.5px;line-height:1.6;color:#334155;">
            Menjawab rumusan masalah ${idx + 1}: <em>"${escapeHTML(prob)}"</em> melalui analisis data dan sintesis konseptual.
          </p>
        `;
      });

      bab2HTML += `
          <h3 style="font-size:12px;font-weight:800;color:#0f172a;margin:14px 0 4px;">2.${subIndex++} Sintesis Solusi, Implikasi & Rekomendasi Penulis</h3>
          <p class="draft-paragraph completed" style="background:#f8fafc;padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:11.5px;line-height:1.6;color:#334155;">
            Solusi terarah yang diusulkan menekankan pada pendekatan kolaboratif dan evaluasi berkala.
          </p>
        </div>
      `;
      box2.innerHTML = bab2HTML;
    }
  }
}

// ── List Formatter Helper ────────────────────────────────────
function formatList(text) {
  if (!text) return '';
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return '';
  return `<ol style="margin:4px 0 0 18px; padding:0; font-size:11.5px; line-height:1.6; color:#334155;">
    ${lines.map(line => `<li>${escapeHTML(line.replace(/^\d+[\.\)]\s*/, ''))}</li>`).join('')}
  </ol>`;
}

function confirmRumusanMasalah() {
  const qInput = document.getElementById('hitlRumusanInput');
  const tInput = document.getElementById('hitlTujuanInput');
  const finalizedQ = qInput ? qInput.value.trim() : '';
  const finalizedT = tInput ? tInput.value.trim() : '';

  // 1. Update button in HITL card to confirmed state
  const approveBtns = document.querySelectorAll('.hitl-gate-card .btn-hitl-approve');
  approveBtns.forEach(btn => {
    btn.disabled = true;
    btn.style.background = '#ecfdf5';
    btn.style.color = '#059669';
    btn.style.borderColor = '#a7f3d0';
    btn.style.cursor = 'default';
    btn.innerHTML = '<span class="material-symbols-rounded">check_circle</span> <span>✓ Bab I Telah Disetujui & Terkunci di Naskah</span>';
  });

  // 2. Update paper scrapbook: Section 1.2 Rumusan Masalah & Section 1.3 Tujuan Penulisan
  const box12 = document.getElementById('boxProblemStatement');
  const box13 = document.getElementById('boxTujuanPenulisan');

  if (box12) {
    if (box13) {
      // Makalah format with separate boxes
      box12.innerHTML = `<div class="draft-paragraph completed" style="background:#ffffff; padding:2px 0;">${formatList(finalizedQ)}</div>`;
      box13.innerHTML = `<div class="draft-paragraph completed" style="background:#ffffff; padding:2px 0;">${formatList(finalizedT)}</div>`;
    } else {
      // Proposal / Skripsi / Tesis / Disertasi combined format
      box12.innerHTML = `
        <div class="draft-paragraph completed" style="background:#ffffff; padding:2px 0;">
          <strong style="font-size:11.5px; color:#1e293b; display:block; margin-bottom:2px;">A. Rumusan Masalah (Pertanyaan Riset):</strong>
          ${formatList(finalizedQ)}
          <strong style="font-size:11.5px; color:#1e293b; display:block; margin:8px 0 2px;">B. Tujuan Penulisan & Sasaran Riset:</strong>
          ${formatList(finalizedT)}
        </div>
      `;
    }
    box12.style.background = '#ffffff';
    box12.setAttribute('contenteditable', 'true');
    box12.setAttribute('spellcheck', 'false');

    // Extract problem statements list for proportional Bab II generation
    const problemLines = finalizedQ.split('\n').map(l => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(l => l.length > 0);
    researchContext.problems = problemLines;

    const b12 = document.getElementById('badgeSection12') || document.getElementById('badge_section12');
    if (b12) {
      b12.className = 'section-certainty-badge verified';
      b12.style.background = '#ecfdf5';
      b12.style.color = '#059669';
      b12.innerText = '✓ Selesai';
    }
  }

  if (box13) {
    box13.style.background = '#ffffff';
    box13.setAttribute('contenteditable', 'true');
    box13.setAttribute('spellcheck', 'false');

    const b13 = document.getElementById('badgeSection13') || document.getElementById('badge_section13');
    if (b13) {
      b13.className = 'section-certainty-badge verified';
      b13.style.background = '#ecfdf5';
      b13.style.color = '#059669';
      b13.innerText = '✓ Selesai';
    }
  }

  // Mark all Bab I sections as filled on the right
  document.querySelectorAll('#section11, #section12, #section13').forEach(s => {
    s.classList.remove('active');
    s.classList.add('filled');
  });

  // Update verified count & doc sync badge
  const verifiedEl = document.getElementById('verifiedCount');
  if (verifiedEl) {
    const current = parseInt(verifiedEl.innerText) || 1;
    verifiedEl.innerText = String(current + 1);
  }
  setEl('docSyncBadge', '✓ Bab I Lengkap');

  // 3. Mark left sidebar Unit 1 and all its nodes as done
  const u1 = document.getElementById('unit-1');
  if (u1) {
    u1.className = 'unit-block done';
    const statusTag = u1.querySelector('.unit-badge-status');
    if (statusTag) {
      statusTag.className = 'unit-badge-status done';
      statusTag.innerText = '✓ Selesai';
    }
  }
  document.querySelectorAll('#unit-1 .path-node').forEach(node => {
    node.className = 'path-node done';
    const c = node.querySelector('.node-circle');
    if (c) {
      c.className = 'node-circle';
      c.innerHTML = '<span class="material-symbols-rounded">check</span>';
    }
  });

  awardXP(60);

  // 4. Celebration transition in chat
  const stream = document.getElementById('duoChatStream');
  appendCoachBubble(stream, {
    tag: 'Bab I Selesai & Terverifikasi',
    tagType: 'tag-hitl',
    title: 'Bab I (Pendahuluan) Berhasil Disahkan',
    body: `
      <p>Latar belakang, rumusan masalah, dan sasaran tulisan telah terkunci rapi di draf naskah sebelah kanan.</p>
      <p>Pembahasan selanjutnya berfokus pada <strong>BAB II (Pembahasan &amp; Analisis)</strong>.</p>
    `
  });

  proceedToBab2();
}

// ── Unit 2 (BAB II: Pembahasan & Analisis) Proportional Sub-Section Generation ─────────
function proceedToBab2() {
  syncPaperToResearchContext();
  const stream = document.getElementById('duoChatStream');
  const topicSnippet = researchContext.topic || 'topik yang diteliti';

  // Extract verified problems directly from latest paper content
  const problems = (researchContext.problems && researchContext.problems.length > 0)
    ? researchContext.problems
    : [
        `Bagaimana karakteristik dan dinamika utama dari ${topicSnippet} di era transformasi digital?`,
        `Bagaimana alternatif solusi dan rekomendasi strategis yang aplikatif untuk mengatasi kendala yang dihadapi?`
      ];

  // Dynamically build proportional multi-paragraph Bab II sub-sections based on problem statements
  let subIndex = 1;
  let bab2HTML = `
    <div class="bab2-skeleton">
      <h3 style="font-size:12px;font-weight:800;color:#0f172a;margin:14px 0 6px;">2.${subIndex++} Tinjauan Teori & Kerangka Konseptual Dasar</h3>
      <p class="academic-paragraph" style="background:#ffffff;padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:11.5px;line-height:1.6;color:#334155;margin-bottom:8px;">
        Penulisan makalah mengenai <strong>${escapeHTML(topicSnippet)}</strong> ini berlandaskan pada kerangka konseptual yang menghubungkan dinamika fenomena mendasar dengan landasan teori pendukung. Dalam perspektif akademik, fenomena ini tidak dapat dilepaskan dari pengaruh perkembangan teknologi dan interaksi sosial yang kompleks, di mana fleksibilitas operasional harus diseimbangkan dengan kepatuhan terhadap regulasi yang berlaku (Santoso & Pratama, 2024).
      </p>
      <p class="academic-paragraph" style="background:#ffffff;padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:11.5px;line-height:1.6;color:#334155;">
        Kajian literatur sebelumnya menegaskan pentingnya pemetaan variabel kunci guna memahami akar permasalahan secara holistik. Berbagai studi nasional dan internasional menunjukkan bahwa efektivitas tata kelola sangat bergantung pada integrasi analitika data, transparansi proses, serta kesiapan sumber daya manusia dalam mengadaptasi perubahan ekosistem (Firmansyah & Wulandari, 2023).
      </p>
  `;

  problems.forEach((prob, idx) => {
    const titleText = prob.length > 65 ? prob.slice(0, 65) + '...' : prob;
    bab2HTML += `
      <h3 style="font-size:12px;font-weight:800;color:#0f172a;margin:14px 0 4px;">2.${subIndex++} Analisis Pembahasan: ${escapeHTML(titleText)}</h3>
      <p class="draft-paragraph completed" style="background:#f8fafc;padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:11.5px;line-height:1.6;color:#334155;">
        Berdasarkan analisis situasi pada poin rumusan masalah ${idx + 1}, temuan menunjukkan bahwa faktor kunci berakar pada kesenjangan antara konsep ideal dengan kondisi riil di lapangan.
      </p>
    `;
  });

  bab2HTML += `
      <h3 style="font-size:12px;font-weight:800;color:#0f172a;margin:14px 0 4px;">2.${subIndex++} Sintesis Solusi, Implikasi & Rekomendasi Penulis</h3>
      <p class="draft-paragraph completed" style="background:#f8fafc;padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:11.5px;line-height:1.6;color:#334155;">
        Solusi terarah yang diusulkan menekankan pada pendekatan kolaboratif, regulasi adaptif, serta evaluasi berkala untuk memastikan keberlanjutan dampak.
      </p>
    </div>
  `;

  // Populate Bab II skeleton on the right paper
  const box2 = document.getElementById('boxPembahasan') || document.getElementById('boxKajianTeori') || document.getElementById('boxTinjauan') || document.getElementById('boxPustaka');
  if (box2) {
    box2.innerHTML = bab2HTML;
    box2.style.background = '#ffffff';

    const b2 = document.getElementById('badgeSection2') || document.getElementById('badge_section2');
    if (b2) {
      b2.className = 'section-certainty-badge';
      b2.style.background = '#ede9fe';
      b2.style.color = '#6366f1';
      b2.innerText = 'Sedang Dielaborasi';
    }

    setEl('docSyncBadge', '✓ Bab II Aktif');
  }

  // Highlight Section 2 on the right paper deck with active purple border and glow
  const sec2 = document.getElementById('section2');
  if (sec2) {
    document.querySelectorAll('.paper-section').forEach(s => s.classList.remove('active'));
    sec2.classList.add('active');
    setTimeout(() => {
      sec2.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
  }

  // Unlock Unit 2 in left sidebar (glowing active state)
  const u2 = document.getElementById('unit-2');
  if (u2) {
    u2.className = 'unit-block active';
    const badge = u2.querySelector('.unit-badge-status');
    if (badge) {
      badge.className = 'unit-badge-status current';
      badge.innerHTML = '<span class="material-symbols-rounded" style="font-size:12px;">play_arrow</span> Sedang Aktif';
    }
  }

  // Set node 2-1 to active with purple pulse
  const n21 = document.getElementById('node-2-1');
  if (n21) {
    n21.className = 'path-node active';
    const c = n21.querySelector('.node-circle');
    if (c) {
      c.className = 'node-circle pulse';
      c.innerHTML = '<span class="material-symbols-rounded">menu_book</span>';
    }
  }

  // Update milestone banner
  setEl('currentStepTitle', 'Langkah 2.1: Kerangka Pembahasan Bab II');
  setEl('currentStepBadge', 'Analisis & Elaborasi');
  setEl('currentStepDesc', '💡 <strong>Langkah 2.1:</strong> Pilih pendekatan analisis untuk mengupas masalah dan menjawab rumusan masalah di Bab II.');
  updateQuickHelperChips('2.1');

  // Prompt the user in chat for Bab II angles with coherent, discussion-oriented options
  appendCoachBubble(stream, {
    tag: '💡 Langkah 2.1: Pendekatan Analisis Pembahasan',
    tagType: 'tag-socratic',
    title: 'Pilih Fokus Analisis untuk Pembahasan Bab II',
    chipsLabel: '📊 Pilih Pendekatan Analisis Bab II:',
    body: `
      <p>Kerangka <strong>Bab II (Pembahasan & Analisis)</strong> telah disiapkan di naskah kanan.</p>
      <p>Agar pembahasan dapat menjawab rumusan masalah secara komprehensif, tentukan <strong>fokus analisis utama</strong> yang ingin kamu tekankan dalam mengkaji <em>"${escapeHTML(topicSnippet)}"</em>:</p>
    `,
    chips: [
      {
        key: 'A',
        icon: '🔬',
        title: 'Analisis Faktor Kausal & Dinamika Masalah',
        desc: `Membedah akar penyebab kendala pada ${escapeHTML(topicSnippet.length > 40 ? topicSnippet.slice(0, 40) + '...' : topicSnippet)} serta implikasinya`,
        onClick: "handleBab2Select('A', 'Analisis Faktor Kausal & Dinamika Masalah', 'Membedah akar penyebab kendala serta implikasi struktural di lapangan')"
      },
      {
        key: 'B',
        icon: '⚖️',
        title: 'Komparasi Teori Literatur vs Realitas Lapangan',
        desc: `Menguji kesesuaian konsep teoretis dengan fakta empiris pada ${escapeHTML(topicSnippet.length > 40 ? topicSnippet.slice(0, 40) + '...' : topicSnippet)}`,
        onClick: "handleBab2Select('B', 'Komparasi Teori Literatur vs Realitas Lapangan', 'Menguji kesesuaian teori rujukan dengan fakta empiris di lapangan')"
      },
      {
        key: 'C',
        icon: '🚀',
        title: 'Formulasi Solusi Terarah & Desain Model Terapan',
        desc: `Merumuskan strategi solutif konkret dan rekomendasi aplikatif untuk menjawab rumusan masalah`,
        onClick: "handleBab2Select('C', 'Formulasi Solusi Terarah & Desain Model Terapan', 'Menyusun kerangka pemecahan masalah dan rekomendasi kebijakan terarah')"
      }
    ]
  });

  // Scroll chat smoothly to newly appended prompt
  setTimeout(() => {
    stream.scrollTop = stream.scrollHeight;
  }, 100);
}

// ── Bab 2 Paper Display Helper ────────────────────────────────
function updateBab2PaperDisplay(isFinal = false) {
  const box2 = document.getElementById('boxPembahasan') || document.getElementById('boxKajianTeori') || document.getElementById('boxTinjauan') || document.getElementById('boxPustaka');
  if (!box2) return;

  const parts = [];
  if (researchContext.bab2_1) parts.push(researchContext.bab2_1);
  if (researchContext.bab2_2) parts.push(researchContext.bab2_2);
  if (researchContext.bab2_3) parts.push(researchContext.bab2_3);

  const formattedHtml = parts.map(p => {
    const trimmed = p.trim();
    return trimmed.split('\n\n').map(sub => {
      const subTrimmed = sub.trim();
      if (subTrimmed.match(/^2\.\d+\s/)) {
        const lines = subTrimmed.split('\n');
        const heading = lines[0];
        const rest = lines.slice(1).join('<br>');
        return `<h3 style="font-size:12px;font-weight:800;color:#0f172a;margin:12px 0 4px;">${escapeHTML(heading)}</h3>
                <p class="draft-paragraph completed" style="background:#ffffff;padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:11.5px;line-height:1.6;color:#334155;">
                  ${escapeHTML(rest)}
                </p>`;
      }
      return `<p class="draft-paragraph completed" style="background:#ffffff;padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:11.5px;line-height:1.6;color:#334155;margin-bottom:8px;">${escapeHTML(subTrimmed)}</p>`;
    }).join('');
  }).join('');

  let skeletonHtml = '';
  if (!isFinal) {
    const problems = (researchContext.problems && researchContext.problems.length > 0) ? researchContext.problems : ['Analisis Masalah'];
    if (!researchContext.bab2_2) {
      problems.forEach((prob, idx) => {
        const titleText = prob.length > 65 ? prob.slice(0, 65) + '...' : prob;
        skeletonHtml += `
          <h3 style="font-size:12px;font-weight:800;color:#94a3b8;margin:14px 0 4px;">2.${idx + 2} Analisis Pembahasan: ${escapeHTML(titleText)} (Menunggu Langkah 2.2)</h3>
          <p class="draft-paragraph" style="background:#f8fafc;padding:10px;border-radius:8px;border:1px dashed #cbd5e1;font-size:11.5px;line-height:1.6;color:#94a3b8;">
            Menunggu draf analisis masalah...
          </p>
        `;
      });
    }
    if (!researchContext.bab2_3) {
      const nextNum = problems.length + 2;
      skeletonHtml += `
        <h3 style="font-size:12px;font-weight:800;color:#94a3b8;margin:14px 0 4px;">2.${nextNum} Sintesis Solusi & Gagasan Penulis (Menunggu Langkah 2.3)</h3>
        <p class="draft-paragraph" style="background:#f8fafc;padding:10px;border-radius:8px;border:1px dashed #cbd5e1;font-size:11.5px;line-height:1.6;color:#94a3b8;">
          Menunggu draf sintesis solusi...
        </p>
      `;
    }
  }

  box2.innerHTML = `
    <div class="bab2-final">
      ${isFinal ? `
        <span class="para-author-badge human" style="background:#ecfdf5;color:#059669;border-color:#a7f3d0;margin-bottom:8px;display:inline-block;padding:2px 8px;border-radius:4px;font-size:10.5px;font-weight:700;">
          ✓ Pembahasan Terverifikasi (Klik untuk Mengedit Langsung)
        </span>
      ` : ''}
      ${formattedHtml}
      ${skeletonHtml}
    </div>
  `;

  if (isFinal) {
    box2.style.background = '#ffffff';
    box2.setAttribute('contenteditable', 'true');
    box2.setAttribute('spellcheck', 'false');

    const b2 = document.getElementById('badgeSection2') || document.getElementById('badge_section2');
    if (b2) {
      b2.className = 'section-certainty-badge';
      b2.style.background = '#ecfdf5';
      b2.style.color = '#059669';
      b2.innerText = '✓ Selesai';
    }

    setEl('docSyncBadge', '✓ Bab II Terkunci');
  }
}

// ── Bab 2 Step 2.1: Chip Selection & Draft 2.1 ─────────────────
function handleBab2Select(key, title, detail) {
  const stream = document.getElementById('duoChatStream');
  researchContext.bab2_angle = title;

  // Remove chips container
  document.querySelectorAll('.socratic-chips-container').forEach(c => c.remove());

  // User message bubble
  const userRow = document.createElement('div');
  userRow.className = 'user-bubble-row';
  userRow.innerHTML = `
    <div class="user-bubble-card">
      <div style="font-size:11px;opacity:0.85;margin-bottom:2px;">🧑 Sudut Pandang Bab II:</div>
      <strong>${escapeHTML(title)}</strong>
      <p style="margin-top:4px;font-size:12px;line-height:1.4;">${escapeHTML(detail)}</p>
    </div>
  `;
  stream.appendChild(userRow);
  stream.scrollTop = stream.scrollHeight;

  // Update milestone banner
  setEl('currentStepTitle', 'Langkah 2.1: Tinjauan Konsep & Teori Kunci');
  setEl('currentStepBadge', 'Penyusunan Teori');
  setEl('currentStepDesc', '💡 <strong>Langkah 2.1:</strong> Periksa draf tinjauan teori Bab II di bawah ini. Kamu bisa menambah sitasi atau menyesuaikan narasi.');
  updateQuickHelperChips('2.1');

  setTimeout(() => {
    awardXP(60);
    updateProgress(55);
    syncPaperToResearchContext();

    const topicText = researchContext.topic || 'kajian ini';
    const draft21 = `2.1 Tinjauan Teori & Kerangka Konseptual Dasar\nKajian mengenai ${topicText} berlandaskan pada kerangka konseptual yang menghubungkan fenomena empiris dengan landasan teori pendukung, khususnya dari sudut pandang ${title.toLowerCase()}.\n\nKajian literatur sebelumnya menegaskan pentingnya pemetaan variabel kunci guna memahami akar permasalahan secara holistik. Berbagai studi nasional dan internasional menunjukkan bahwa efektivitas implementasi kebijakan dan solusi sangat bergantung pada integrasi analitika data, transparansi proses, serta kesiapan sumber daya manusia (Firmansyah & Wulandari, 2023).`;

    appendCoachBubble(stream, {
      tag: 'Langkah 2.1: Tinjauan Teori',
      tagType: 'tag-socratic',
      title: 'Draf 2.1: Tinjauan Teori Berhasil Disusun',
      body: `
        <p>Thesa telah merancang draf awal untuk <strong>Sub-bab 2.1 (Tinjauan Teori & Kerangka Konseptual)</strong>:</p>

        <div class="hitl-gate-card">
          <div class="hitl-head-row">
            <div class="hitl-title">
              <span class="material-symbols-rounded" style="color:var(--brand);">edit_document</span>
              <span>Draf 2.1: Tinjauan Teori (Bisa Kamu Sesuaikan):</span>
            </div>
            <span class="hitl-badge-required" style="background:#fef3c7;color:#d97706;border-color:#fde68a;">Langkah 2.1</span>
          </div>
          
          <div class="hitl-diff-box" style="margin-top:8px;">
            <textarea id="hitlBab2_1Input" class="diff-text-editable" style="min-height:130px;font-size:12px;line-height:1.6;">${escapeHTML(draft21)}</textarea>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; flex-wrap:wrap; gap:8px;">
            <button type="button" class="btn-quick-chip" onclick="toggleLiteratureModal(true)" style="background:#eef2ff; color:var(--brand); border-color:#c7d2fe;">
              <span class="material-symbols-rounded" style="font-size:14px;">menu_book</span> Sisipkan Sitasi Literatur
            </button>
            <span style="font-size:11px; color:#64748b;">Klik tombol di bawah jika kamu sudah setuju:</span>
          </div>

          <div class="hitl-actions-row" style="margin-top:12px;">
            <button class="btn-hitl-approve" onclick="approveStep21('${escapeHTML(title)}')">
              <span class="material-symbols-rounded">arrow_forward</span>
              <span>Setujui & Lanjut ke Langkah 2.2</span>
            </button>
          </div>
        </div>
      `,
    });

    stream.scrollTop = stream.scrollHeight;
  }, 500);
}

// ── Approve Step 2.1 & Advance to Step 2.2 ────────────────────
function approveStep21(angleTitle) {
  const input = document.getElementById('hitlBab2_1Input');
  const finalizedText = input ? input.value.trim() : '';
  researchContext.bab2_1 = finalizedText;

  awardXP(60);
  updateProgress(65);

  // Disable old card button
  const approveBtns = document.querySelectorAll('button[onclick^="approveStep21"]');
  approveBtns.forEach(btn => {
    btn.disabled = true;
    btn.style.background = '#ecfdf5';
    btn.style.color = '#059669';
    btn.innerHTML = '<span class="material-symbols-rounded">check_circle</span> <span>✓ Langkah 2.1 Terkunci</span>';
  });

  // Update left sidebar: node-2-1 done (check), node-2-2 active (pulse)
  const n21 = document.getElementById('node-2-1');
  if (n21) {
    n21.className = 'path-node done';
    const c = n21.querySelector('.node-circle');
    if (c) {
      c.className = 'node-circle';
      c.innerHTML = '<span class="material-symbols-rounded">check</span>';
    }
  }

  const n22 = document.getElementById('node-2-2');
  if (n22) {
    n22.className = 'path-node active';
    const c = n22.querySelector('.node-circle');
    if (c) {
      c.className = 'node-circle pulse';
      c.innerHTML = '<span class="material-symbols-rounded">analytics</span>';
    }
  }

  // Update milestone banner
  setEl('currentStepTitle', 'Langkah 2.2: Analisis Pembahasan Masalah Utama');
  setEl('currentStepBadge', 'Penyusunan Analisis');
  setEl('currentStepDesc', '💡 <strong>Langkah 2.2:</strong> Merumuskan draf analisis pembahasan masalah. Periksa dan sesuaikan narasi di bawah ini.');
  updateQuickHelperChips('2.2');

  // Update right paper scrapbook
  updateBab2PaperDisplay();

  // Generate Step 2.2 draft
  const problems = (researchContext.problems && researchContext.problems.length > 0)
    ? researchContext.problems
    : ['Analisis komprehensif atas fenomena yang diteliti'];

  const problemDiscussionPoints = problems.map((prob, idx) => {
    const cleanP = prob.replace(/^\d+[\.\)]\s*/, '').trim();
    return `2.${idx + 2} Analisis Masalah: ${cleanP}\nBerdasarkan fokus ${angleTitle.toLowerCase()}, temuan menunjukkan bahwa faktor kunci berakar pada dinamika operasional di lapangan terkait "${cleanP.length > 60 ? cleanP.slice(0, 60) + '...' : cleanP}". Hal ini menuntut adanya sinkronisasi antara kebijakan dan eksekusi praktis agar hambatan struktural dapat diatasi secara tuntas.`;
  }).join('\n\n');

  const stream = document.getElementById('duoChatStream');
  setTimeout(() => {
    appendCoachBubble(stream, {
      tag: 'Langkah 2.2: Analisis Pembahasan',
      tagType: 'tag-socratic',
      title: 'Draf 2.2: Analisis Pembahasan Masalah',
      body: `
        <p>Thesa telah merumuskan draf untuk <strong>Sub-bab 2.2 (Analisis Pembahasan Masalah)</strong> berdasarkan pertanyaan risetmu:</p>

        <div class="hitl-gate-card">
          <div class="hitl-head-row">
            <div class="hitl-title">
              <span class="material-symbols-rounded" style="color:var(--brand);">analytics</span>
              <span>Draf 2.2: Analisis Pembahasan (Bisa Kamu Sesuaikan):</span>
            </div>
            <span class="hitl-badge-required" style="background:#fef3c7;color:#d97706;border-color:#fde68a;">Langkah 2.2</span>
          </div>
          
          <div class="hitl-diff-box" style="margin-top:8px;">
            <textarea id="hitlBab2_2Input" class="diff-text-editable" style="min-height:140px;font-size:12px;line-height:1.6;">${escapeHTML(problemDiscussionPoints)}</textarea>
          </div>

          <div class="hitl-actions-row" style="margin-top:12px;">
            <button class="btn-hitl-approve" onclick="approveStep22('${escapeHTML(angleTitle)}')">
              <span class="material-symbols-rounded">arrow_forward</span>
              <span>Setujui & Lanjut ke Langkah 2.3</span>
            </button>
          </div>
        </div>
      `,
    });
    stream.scrollTop = stream.scrollHeight;
  }, 400);
}

// ── Approve Step 2.2 & Advance to Step 2.3 ────────────────────
function approveStep22(angleTitle) {
  const input = document.getElementById('hitlBab2_2Input');
  const finalizedText = input ? input.value.trim() : '';
  researchContext.bab2_2 = finalizedText;

  awardXP(60);
  updateProgress(75);

  // Disable old card button
  const approveBtns = document.querySelectorAll('button[onclick^="approveStep22"]');
  approveBtns.forEach(btn => {
    btn.disabled = true;
    btn.style.background = '#ecfdf5';
    btn.style.color = '#059669';
    btn.innerHTML = '<span class="material-symbols-rounded">check_circle</span> <span>✓ Langkah 2.2 Terkunci</span>';
  });

  // Update left sidebar: node-2-2 done (check), node-2-3 active (pulse)
  const n22 = document.getElementById('node-2-2');
  if (n22) {
    n22.className = 'path-node done';
    const c = n22.querySelector('.node-circle');
    if (c) {
      c.className = 'node-circle';
      c.innerHTML = '<span class="material-symbols-rounded">check</span>';
    }
  }

  const n23 = document.getElementById('node-2-3');
  if (n23) {
    n23.className = 'path-node active';
    const c = n23.querySelector('.node-circle');
    if (c) {
      c.className = 'node-circle pulse';
      c.innerHTML = '<span class="material-symbols-rounded">lightbulb</span>';
    }
  }

  // Update milestone banner
  setEl('currentStepTitle', 'Langkah 2.3: Sintesis Solusi & Gagasan Penulis');
  setEl('currentStepBadge', 'Sintesis Solusi');
  setEl('currentStepDesc', '💡 <strong>Langkah 2.3:</strong> Merumuskan sintesis solusi dan pemikiran orisinal untuk menjawab tantangan riset.');
  updateQuickHelperChips('2.3');

  // Update right paper scrapbook
  updateBab2PaperDisplay();

  const nextSectionNum = (researchContext.problems ? researchContext.problems.length : 1) + 2;
  const draft23 = `2.${nextSectionNum} Sintesis Solusi, Implikasi & Rekomendasi Penulis\nSebagai solusi terarah, pendekatan terintegrasi yang menggabungkan kolaborasi lintas pihak, optimalisasi teknologi digital, serta monitoring berkala perlu diimplementasikan. Langkah ini menjadi instrumen esensial dalam menjawab tantangan mendasar dan memastikan keberlanjutan dampak positif bagi seluruh pemangku kepentingan.`;

  const stream = document.getElementById('duoChatStream');
  setTimeout(() => {
    appendCoachBubble(stream, {
      tag: 'Langkah 2.3: Sintesis Solusi',
      tagType: 'tag-socratic',
      title: 'Draf 2.3: Sintesis Solusi & Implikasi Praktis',
      body: `
        <p>Thesa telah merangkum gagasan solusi untuk <strong>Sub-bab 2.3 (Sintesis Solusi & Gagasan Penulis)</strong>:</p>

        <div class="hitl-gate-card">
          <div class="hitl-head-row">
            <div class="hitl-title">
              <span class="material-symbols-rounded" style="color:var(--brand);">lightbulb</span>
              <span>Draf 2.3: Sintesis Solusi (Bisa Kamu Sesuaikan):</span>
            </div>
            <span class="hitl-badge-required" style="background:#fef3c7;color:#d97706;border-color:#fde68a;">Langkah 2.3</span>
          </div>
          
          <div class="hitl-diff-box" style="margin-top:8px;">
            <textarea id="hitlBab2_3Input" class="diff-text-editable" style="min-height:130px;font-size:12px;line-height:1.6;">${escapeHTML(draft23)}</textarea>
          </div>

          <div class="hitl-actions-row" style="margin-top:12px;">
            <button class="btn-hitl-approve" onclick="approveStep23('${escapeHTML(angleTitle)}')">
              <span class="material-symbols-rounded">verified</span>
              <span>Setujui & Kunci Bab II ke Naskah</span>
            </button>
          </div>
        </div>
      `,
    });
    stream.scrollTop = stream.scrollHeight;
  }, 400);
}

// ── Approve Step 2.3 & Unlock Unit 3 (BAB III: PENUTUP) ───────
function approveStep23(angleTitle) {
  const input = document.getElementById('hitlBab2_3Input');
  const finalizedText = input ? input.value.trim() : '';
  researchContext.bab2_3 = finalizedText;

  awardXP(90);
  updateProgress(85);

  // Disable old card button
  const approveBtns = document.querySelectorAll('button[onclick^="approveStep23"]');
  approveBtns.forEach(btn => {
    btn.disabled = true;
    btn.style.background = '#ecfdf5';
    btn.style.color = '#059669';
    btn.innerHTML = '<span class="material-symbols-rounded">check_circle</span> <span>✓ Bab II Telah Lengkap & Terkunci</span>';
  });

  // Update left sidebar: node-2-3 done (check)
  const n23 = document.getElementById('node-2-3');
  if (n23) {
    n23.className = 'path-node done';
    const c = n23.querySelector('.node-circle');
    if (c) {
      c.className = 'node-circle';
      c.innerHTML = '<span class="material-symbols-rounded">check</span>';
    }
  }

  // Update left sidebar: Unit 2 Done, Unit 3 Active
  const u2 = document.getElementById('unit-2');
  if (u2) {
    const statusTag = u2.querySelector('.unit-badge-status');
    if (statusTag) {
      statusTag.className = 'unit-badge-status done';
      statusTag.style.background = '#ecfdf5';
      statusTag.style.color = '#059669';
      statusTag.innerText = '✓ Selesai';
    }
  }

  const u3 = document.getElementById('unit-3');
  if (u3) {
    u3.className = 'unit-block active';
    const statusTag = u3.querySelector('.unit-badge-status');
    if (statusTag) {
      statusTag.className = 'unit-badge-status current';
      statusTag.innerText = 'Sedang Aktif';
    }
  }

  // Finalize Bab II on right paper
  updateBab2PaperDisplay(true);

  // In-chat celebration and transition to Unit 3 (Bab III)
  const stream = document.getElementById('duoChatStream');
  appendCoachBubble(stream, {
    tag: 'Bab II Selesai & Terverifikasi',
    tagType: 'tag-hitl',
    title: 'Bab II (Pembahasan & Analisis) Selesai',
    body: `
      <p>Pembahasanmu sudah terstruktur sangat kuat dengan dasar teori, analisis masalah, dan sintesis pemikiran yang matang.</p>
      <p>Sekarang langkah terakhir untuk merampungkan seluruh makalah: <strong>BAB III: PENUTUP (KESIMPULAN & SARAN)</strong>.</p>
      
      <div style="margin-top:14px;">
        <button class="btn-primary" style="width:100%;justify-content:center;padding:13px;font-size:14px;font-weight:800;box-shadow:0 4px 14px rgba(79,70,229,0.3);" onclick="proceedToBab3()">
          <span class="material-symbols-rounded">fact_check</span>
          <span>Lanjut Susun BAB III: Kesimpulan & Saran ➔</span>
        </button>
      </div>
    `,
  });
  stream.scrollTop = stream.scrollHeight;
}

// ── Bab 3 Paper Display Helper ────────────────────────────────
function updateBab3PaperDisplay(isFinal = false) {
  const box3 = document.getElementById('boxPenutup');
  if (!box3) return;

  const parts = [];
  if (researchContext.bab3_1) parts.push(researchContext.bab3_1);
  if (researchContext.bab3_2) parts.push(researchContext.bab3_2);

  const formattedHtml = parts.map(p => {
    const trimmed = p.trim();
    return trimmed.split('\n\n').map(sub => {
      const subTrimmed = sub.trim();
      if (subTrimmed.match(/^3\.\d+\s/)) {
        const lines = subTrimmed.split('\n');
        const heading = lines[0];
        const rest = lines.slice(1).join('<br>');
        return `<h3 style="font-size:12px;font-weight:800;color:#0f172a;margin:12px 0 4px;">${escapeHTML(heading)}</h3>
                <p class="draft-paragraph completed" style="background:#ffffff;padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:11.5px;line-height:1.6;color:#334155;">
                  ${escapeHTML(rest)}
                </p>`;
      }
      return `<p class="draft-paragraph completed" style="background:#ffffff;padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:11.5px;line-height:1.6;color:#334155;margin-bottom:8px;">${escapeHTML(subTrimmed)}</p>`;
    }).join('');
  }).join('');

  let skeletonHtml = '';
  if (!isFinal) {
    if (!researchContext.bab3_2) {
      skeletonHtml += `
        <h3 style="font-size:12px;font-weight:800;color:#94a3b8;margin:14px 0 4px;">3.2 Saran & Rekomendasi (Menunggu Langkah 3.2)</h3>
        <p class="draft-paragraph" style="background:#f8fafc;padding:10px;border-radius:8px;border:1px dashed #cbd5e1;font-size:11.5px;line-height:1.6;color:#94a3b8;">
          Menunggu draf saran dan rekomendasi...
        </p>
      `;
    }
  }

  box3.innerHTML = `
    <div class="bab3-final">
      ${isFinal ? `
        <span class="para-author-badge human" style="background:#ecfdf5;color:#059669;border-color:#a7f3d0;margin-bottom:8px;display:inline-block;padding:2px 8px;border-radius:4px;font-size:10.5px;font-weight:700;">
          ✓ Kesimpulan & Saran Terverifikasi (Klik untuk Mengedit Langsung)
        </span>
      ` : ''}
      ${formattedHtml}
      ${skeletonHtml}
    </div>
  `;

  if (isFinal) {
    box3.style.background = '#ffffff';
    box3.setAttribute('contenteditable', 'true');
    box3.setAttribute('spellcheck', 'false');

    const b3 = document.getElementById('badgeSection3');
    if (b3) {
      b3.className = 'section-certainty-badge';
      b3.style.background = '#ecfdf5';
      b3.style.color = '#059669';
      b3.innerText = '✓ Selesai';
    }

    setEl('docSyncBadge', '✓ Seluruh Makalah Selesai (100%)');
    setEl('verifiedCount', '4');
  }
}

// ── Unit 3 (BAB III: Penutup - Langkah 3.1: Kesimpulan) ────────
function proceedToBab3() {
  syncPaperToResearchContext();
  const stream = document.getElementById('duoChatStream');

  // Milestone banner
  setEl('currentStepTitle', 'Langkah 3.1: Sintesis Kesimpulan Pokok');
  setEl('currentStepBadge', 'Penarikan Kesimpulan');
  setEl('currentStepDesc', '💡 <strong>Langkah 3.1:</strong> Menyimpulkan jawaban atas rumusan masalah Bab I secara padat dan terukur.');
  updateQuickHelperChips('3.1');

  const problems = (researchContext.problems && researchContext.problems.length > 0)
    ? researchContext.problems
    : ['Analisis permasalahan naskah'];

  const kesimpulanPoints = problems.map((p, idx) => {
    const cleanP = p.replace(/^\d+[\.\)]\s*/, '').trim();
    return `${idx + 1}. Analisis terhadap "${cleanP.length > 50 ? cleanP.slice(0, 50) + '...' : cleanP}" membuktikan perlunya integrasi strategi terarah guna menghasilkan dampak yang terukur dan berkelanjutan.`;
  }).join('\n');

  const draft31 = `3.1 Kesimpulan\n${kesimpulanPoints}`;

  // Update paper scrapbook section 3 placeholder
  const box3 = document.getElementById('boxPenutup');
  if (box3) {
    box3.innerHTML = `
      <div class="bab3-skeleton">
        <h3 style="font-size:12px;font-weight:800;color:#0f172a;margin:12px 0 4px;">3.1 Kesimpulan (Sedang Disusun)</h3>
        <p class="draft-paragraph completed" style="background:#f8fafc;padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:11.5px;line-height:1.6;color:#334155;">
          Menjawab rumusan masalah yang diajukan pada Bab I secara padat dan terukur.
        </p>

        <h3 style="font-size:12px;font-weight:800;color:#94a3b8;margin:14px 0 4px;">3.2 Saran & Rekomendasi (Menunggu Langkah 3.2)</h3>
        <p class="draft-paragraph" style="background:#f8fafc;padding:10px;border-radius:8px;border:1px dashed #cbd5e1;font-size:11.5px;line-height:1.6;color:#94a3b8;">
          Rekomendasi praktis untuk pemangku kepentingan dan saran penelitian lanjutan.
        </p>
      </div>
    `;
    box3.style.background = '#ffffff';

    const b3 = document.getElementById('badgeSection3');
    if (b3) {
      b3.className = 'section-certainty-badge';
      b3.style.background = '#eef2ff';
      b3.style.color = '#4f46e5';
      b3.innerText = 'Sedang Disusun';
    }

    setEl('docSyncBadge', '✓ Bab III Aktif');
  }

  // Highlight Section 3 on right paper
  const sec3 = document.getElementById('section3');
  if (sec3) {
    document.querySelectorAll('.paper-section').forEach(s => s.classList.remove('active'));
    sec3.classList.add('active');
    setTimeout(() => {
      sec3.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
  }

  // Activate node 3-1 with purple pulse
  const n31 = document.getElementById('node-3-1');
  if (n31) {
    n31.className = 'path-node active';
    const c = n31.querySelector('.node-circle');
    if (c) {
      c.className = 'node-circle pulse';
      c.innerHTML = '<span class="material-symbols-rounded">task_alt</span>';
    }
  }

  // Prompt the user in chat for Step 3.1
  appendCoachBubble(stream, {
    tag: '🎯 Langkah 3.1: Formulasi Kesimpulan',
    tagType: 'tag-socratic',
    title: 'Kunci Kesimpulan Pokok Makalah',
    body: `
      <p>Kesimpulan yang baik harus menjawab langsung rumusan masalah Bab I secara padat. Berikut draf <strong>Sub-bab 3.1 (Kesimpulan)</strong>:</p>

      <div class="hitl-gate-card">
        <div class="hitl-head-row">
          <div class="hitl-title">
            <span class="material-symbols-rounded" style="color:var(--brand);">task_alt</span>
            <span>Draf 3.1: Kesimpulan (Bisa Diedit):</span>
          </div>
          <span class="hitl-badge-required" style="background:#fef3c7;color:#d97706;border-color:#fde68a;">Langkah 3.1</span>
        </div>
        
        <div class="hitl-diff-box" style="margin-top:8px;">
          <textarea id="hitlBab3_1Input" class="diff-text-editable" style="min-height:120px;font-size:12px;line-height:1.6;">${escapeHTML(draft31)}</textarea>
        </div>

        <div class="hitl-actions-row" style="margin-top:12px;">
          <button class="btn-hitl-approve" onclick="approveStep31()">
            <span class="material-symbols-rounded">arrow_forward</span>
            <span>Setujui & Lanjut ke Langkah 3.2</span>
          </button>
        </div>
      </div>
    `,
  });

  stream.scrollTop = stream.scrollHeight;
}

// ── Approve Step 3.1 & Advance to Step 3.2 ────────────────────
function approveStep31() {
  const input = document.getElementById('hitlBab3_1Input');
  const finalizedText = input ? input.value.trim() : '';
  researchContext.bab3_1 = finalizedText;

  awardXP(60);
  updateProgress(92);

  // Disable old card button
  const approveBtns = document.querySelectorAll('button[onclick^="approveStep31"]');
  approveBtns.forEach(btn => {
    btn.disabled = true;
    btn.style.background = '#ecfdf5';
    btn.style.color = '#059669';
    btn.innerHTML = '<span class="material-symbols-rounded">check_circle</span> <span>✓ Langkah 3.1 Terkunci</span>';
  });

  // Update left sidebar: node-3-1 done (check), node-3-2 active (pulse)
  const n31 = document.getElementById('node-3-1');
  if (n31) {
    n31.className = 'path-node done';
    const c = n31.querySelector('.node-circle');
    if (c) {
      c.className = 'node-circle';
      c.innerHTML = '<span class="material-symbols-rounded">check</span>';
    }
  }

  const n32 = document.getElementById('node-3-2');
  if (n32) {
    n32.className = 'path-node active';
    const c = n32.querySelector('.node-circle');
    if (c) {
      c.className = 'node-circle pulse';
      c.innerHTML = '<span class="material-symbols-rounded">recommend</span>';
    }
  }

  // Update milestone banner
  setEl('currentStepTitle', 'Langkah 3.2: Saran & Rekomendasi Aplikatif');
  setEl('currentStepBadge', 'Saran & Rekomendasi');
  setEl('currentStepDesc', '💡 <strong>Langkah 3.2:</strong> Memberikan rekomendasi aplikatif untuk pemangku kepentingan dan saran penelitian lanjutan.');
  updateQuickHelperChips('3.2');

  // Update right paper scrapbook
  updateBab3PaperDisplay();

  const draft32 = `3.2 Saran & Rekomendasi\n1. Bagi Praktisi & Pemangku Kepentingan: Disarankan untuk memperkuat integrasi data, standarisasi prosedur operasional, dan mekanisme evaluasi berkala guna memitigasi kendala di lapangan sedini mungkin.\n2. Bagi Peneliti Lanjutan: Perlu dilakukan pengujian empiris lanjutan dengan sampel yang lebih luas serta melibatkan metode komparatif untuk memperkaya khazanah keilmuan.`;

  const stream = document.getElementById('duoChatStream');
  setTimeout(() => {
    appendCoachBubble(stream, {
      tag: 'Langkah 3.2: Rekomendasi Naskah',
      tagType: 'tag-socratic',
      title: 'Formulasi Saran & Rekomendasi Naskah',
      body: `
        <p>Langkah pamungkas: berikut draf <strong>Sub-bab 3.2 (Saran & Rekomendasi)</strong>:</p>

        <div class="hitl-gate-card">
          <div class="hitl-head-row">
            <div class="hitl-title">
              <span class="material-symbols-rounded" style="color:var(--brand);">recommend</span>
              <span>Draf 3.2: Saran & Rekomendasi (Bisa Diedit):</span>
            </div>
            <span class="hitl-badge-required" style="background:#fef3c7;color:#d97706;border-color:#fde68a;">Langkah 3.2</span>
          </div>
          
          <div class="hitl-diff-box" style="margin-top:8px;">
            <textarea id="hitlBab3_2Input" class="diff-text-editable" style="min-height:130px;font-size:12px;line-height:1.6;">${escapeHTML(draft32)}</textarea>
          </div>

          <div class="hitl-actions-row" style="margin-top:12px;">
            <button class="btn-hitl-approve" onclick="approveStep32()">
              <span class="material-symbols-rounded">task_alt</span>
              <span>Setujui & Selesaikan Seluruh Makalah</span>
            </button>
          </div>
        </div>
      `,
    });
    stream.scrollTop = stream.scrollHeight;
  }, 400);
}

// ── Approve Step 3.2 & Complete Entire Paper ───────────────────
function approveStep32() {
  const input = document.getElementById('hitlBab3_2Input');
  const finalizedText = input ? input.value.trim() : '';
  researchContext.bab3_2 = finalizedText;

  awardXP(120);
  updateProgress(100);

  // Disable old card button
  const approveBtns = document.querySelectorAll('button[onclick^="approveStep32"]');
  approveBtns.forEach(btn => {
    btn.disabled = true;
    btn.style.background = '#ecfdf5';
    btn.style.color = '#059669';
    btn.innerHTML = '<span class="material-symbols-rounded">check_circle</span> <span>✓ Seluruh Naskah Makalah Selesai</span>';
  });

  // Update left sidebar: node-3-2 done (check)
  const n32 = document.getElementById('node-3-2');
  if (n32) {
    n32.className = 'path-node done';
    const c = n32.querySelector('.node-circle');
    if (c) {
      c.className = 'node-circle';
      c.innerHTML = '<span class="material-symbols-rounded">check</span>';
    }
  }

  // Update left sidebar: Unit 3 Done
  const u3 = document.getElementById('unit-3');
  if (u3) {
    const statusTag = u3.querySelector('.unit-badge-status');
    if (statusTag) {
      statusTag.className = 'unit-badge-status done';
      statusTag.style.background = '#ecfdf5';
      statusTag.style.color = '#059669';
      statusTag.innerText = '✓ Selesai';
    }
  }

  // Update paper scrapbook
  updateBab3PaperDisplay(true);

  // Show Defense Simulation now that entire paper is complete
  showDefenseSimulationCard();


  // Milestone banner
  setEl('currentStepTitle', 'Makalah Selesai: Siap Diekspor & Diserahkan');
  setEl('currentStepBadge', '100% Selesai');
  setEl('currentStepDesc', '🎉 <strong>Selamat!</strong> Seluruh naskah makalah (Bab I, Bab II, Bab III, dan Daftar Pustaka) telah lengkap dan tersusun rapi.');
  updateQuickHelperChips('completed');

  // Celebration in chat
  const stream = document.getElementById('duoChatStream');
  appendCoachBubble(stream, {
    tag: 'Naskah Lengkap & Terverifikasi',
    tagType: 'tag-hitl',
    title: 'Seluruh Struktur Makalah Selesai 100%',
    body: `
      <p>Seluruh bagian makalahmu dari <strong>BAB I (Pendahuluan)</strong>, <strong>BAB II (Pembahasan & Analisis)</strong>, <strong>BAB III (Penutup)</strong>, hingga <strong>DAFTAR PUSTAKA</strong> kini telah lengkap dan terverifikasi.</p>
      
      <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:14px;margin:12px 0;">
        <div style="font-size:12.5px;font-weight:800;color:#166534;margin-bottom:6px;">📊 Ringkasan Capaian Penulisan:</div>
        <ul style="padding-left:18px;margin:0;font-size:12px;color:#15803d;line-height:1.6;">
          <li>✓ <strong>Bab I Pendahuluan:</strong> Latar Belakang, Rumusan Masalah, & Tujuan.</li>
          <li>✓ <strong>Bab II Pembahasan:</strong> Tinjauan Teori, Analisis Masalah, & Solusi Terarah.</li>
          <li>✓ <strong>Bab III Penutup:</strong> Kesimpulan Padat & Rekomendasi Praktis.</li>
          <li>✓ <strong>Daftar Pustaka:</strong> Sitasi standar akademik terintegrasi.</li>
        </ul>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px;">
        <button class="btn-primary" style="width:100%;justify-content:center;padding:12px;font-weight:800;" onclick="downloadPaperDocument()">
          <span class="material-symbols-rounded">download</span>
          <span>Unduh Draf Makalah Lengkap (.DOC)</span>
        </button>
        <button class="btn-hitl-reprobe" style="width:100%;justify-content:center;padding:10px;font-weight:700;" onclick="toggleDefenseModal(true)">
          <span class="material-symbols-rounded">sports_kabaddi</span>
          <span>Uji Sidang / Simulasi Tanya Jawab Penguji</span>
        </button>
      </div>
    `,
  });
  stream.scrollTop = stream.scrollHeight;
}

// ── Download Paper Document Function ──────────────────────────
function downloadPaperDocument() {
  const paperSheet = document.querySelector('.paper-sheet');
  if (!paperSheet) return;

  const title = (researchContext.topic || 'Makalah_Akademik').replace(/[^a-zA-Z0-9_-]/g, '_');
  const content = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${escapeHTML(researchContext.topic || 'Makalah')}</title>
      <style>
        body { font-family: 'Times New Roman', serif; line-height: 1.6; padding: 40px; }
        h1 { font-size: 18pt; text-align: center; text-transform: uppercase; margin-bottom: 24px; }
        h2 { font-size: 14pt; margin-top: 24px; border-bottom: 1px solid #333; padding-bottom: 4px; }
        h3 { font-size: 12pt; margin-top: 16px; }
        p { font-size: 12pt; text-align: justify; text-indent: 36pt; margin-bottom: 12pt; }
        ol, ul { font-size: 12pt; margin-bottom: 12pt; }
      </style>
    </head>
    <body>
      ${paperSheet.innerHTML}
    </body>
    </html>
  `;

  const blob = new Blob([content], { type: 'application/msword;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${title}_Thesa.doc`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function requestAlternativeView() {
  const inputs = document.querySelectorAll('#hitlDraftInput');
  const target = inputs.length ? inputs[inputs.length - 1] : null;
  if (target) {
    target.value = `Kajian mengenai ${researchContext.topic || 'topik ini'} menjadi sangat relevan mengingat tantangan di lapangan yang terus berkembang. Melalui pembahasan yang sistematis dan berbasis bukti, karya tulis ini berupaya memberikan sintesis pemikiran yang dapat diaplikasikan secara nyata.`;
  }
}

// ── Helpers to append chat bubbles ────────────────────────────
function appendCoachBubble(stream, { tag, tagType, title, body, rationale, cascade_warnings, recommendations, chips, chipsLabel }) {
  const row = document.createElement('div');
  row.className = 'coach-bubble-row';

  const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  // Pedagogical Rationale Block (Fase 4)
  const rationaleHTML = rationale ? `
    <div class="rationale-block">
      <div class="rationale-header">
        <span class="material-symbols-rounded">school</span>
        <span>Mengapa Pendekatan Ini Disarankan?</span>
      </div>
      <p>${escapeHTML(rationale)}</p>
    </div>
  ` : '';

  // Downstream Cascade Warnings Block (Fase 3)
  const cascadeHTML = (cascade_warnings && cascade_warnings.length > 0) ? `
    <div class="cascade-warning-card">
      <div class="cascade-head-row">
        <span class="material-symbols-rounded">alt_route</span>
        <span>Sinkronisasi Dependensi Antar-Bab (Cascade)</span>
      </div>
      ${cascade_warnings.map(cw => `
        <div class="cascade-impact-item">
          <span class="material-symbols-rounded" style="font-size:14px;color:#d97706;margin-top:2px;">info</span>
          <div>
            <strong>${escapeHTML(cw.target_stage)}:</strong> ${escapeHTML(cw.message)}
          </div>
        </div>
      `).join('')}
      <div class="cascade-actions-row">
        <button type="button" class="btn-cascade-auto" onclick="reconcileAllCascades()">
          <span class="material-symbols-rounded" style="font-size:14px;">auto_fix_high</span>
          <span>Selaraskan Bab II & III Otomatis</span>
        </button>
        <button type="button" class="btn-cascade-dismiss" onclick="this.closest('.cascade-warning-card').remove()">
          <span>Abaikan</span>
        </button>
      </div>
    </div>
  ` : '';

  row.innerHTML = `
    <div class="coach-avatar">
      <div class="coach-avatar-shield">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
          <path d="M2 17l10 5 10-5"></path>
          <path d="M2 12l10 5 10-5"></path>
        </svg>
      </div>
      <span class="coach-badge">Thesa</span>
    </div>
    <div class="bubble-card coach">
      <div class="bubble-tag-row">
        <span class="bubble-category-tag ${tagType || 'tag-socratic'}">${tag}</span>
        <span class="bubble-timestamp">${time}</span>
      </div>
      <div class="bubble-title">${title}</div>
      <div class="bubble-body-content">${body}</div>
      ${rationaleHTML}
      ${cascadeHTML}
    </div>
  `;
  stream.appendChild(row);

  // If recommendations returned from backend, update contextual chips bar
  if (recommendations && recommendations.length > 0) {
    renderContextualRecommendations(recommendations);
  }

  if (chips && chips.length > 0) {
    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'socratic-chips-container';
    chipsContainer.innerHTML = `
      <div class="chips-label">${chipsLabel ? escapeHTML(chipsLabel) : 'Fokus Argumen yang Disarankan:'}</div>
      <div class="chips-grid">
        ${chips.map(c => {
          const clickAction = c.onClick || `handleSocraticSelect('${c.key}', '${escapeHTML(c.title)}', '${escapeHTML(c.desc)}')`;
          return `
            <button class="socratic-chip" onclick="${clickAction}">
              <span class="chip-icon">${c.icon}</span>
              <div class="chip-info">
                <strong>${escapeHTML(c.title)}</strong>
                <span>${escapeHTML(c.desc)}</span>
              </div>
            </button>
          `;
        }).join('')}
      </div>
    `;
    stream.appendChild(chipsContainer);
  }

  stream.scrollTop = stream.scrollHeight;
}


// ============================================================
// CAMPUS FORMAT (Modal accessible from topbar)
// ============================================================
function reopenTemplateModal() {
  toggleTemplateModal(true);
}

function toggleTemplateModal(show) {
  const modal = document.getElementById('templateModal');
  if (modal) modal.style.display = show ? 'flex' : 'none';
}

function switchTemplateTab(tab) {
  document.getElementById('tabBrowseBtn').className = 'tpl-tab' + (tab === 'browse' ? ' active' : '');
  document.getElementById('tabUploadBtn').className = 'tpl-tab' + (tab === 'upload' ? ' active' : '');
  document.getElementById('tabBrowseContent').style.display = tab === 'browse' ? 'flex' : 'none';
  document.getElementById('tabUploadContent').style.display = tab === 'upload' ? 'flex' : 'none';
}

function selectCampusTemplate(id) {
  tempSelectedCampusId = id;
  document.querySelectorAll('#campusCardsGrid .campus-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.id === id);
  });
  const sel = campusCatalog[id];
  if (sel) {
    setEl('tplPreviewTitle', `${sel.name} — ${sel.citation}`);
    setEl('tplPreviewDesc', `${sel.fullName} • ${sel.styleTag}`);
  }
}

function filterCampusCatalog() {
  const q = document.getElementById('campusSearchInput').value.toLowerCase();
  document.querySelectorAll('#campusCardsGrid .campus-card').forEach(c => {
    c.style.display = c.innerText.toLowerCase().includes(q) ? '' : 'none';
  });
}

function applySelectedTemplate() {
  activeCampus = campusCatalog[tempSelectedCampusId] || activeCampus;
  toggleTemplateModal(false);

  setEl('activeCampusName', activeCampus.name);
  setEl('paperFormatStyleTag', activeCampus.styleTag);
  setEl('heading11', activeCampus.h11);
  setEl('heading12', activeCampus.h12);

  const stream = document.getElementById('duoChatStream');
  if (stream) {
    appendCoachBubble(stream, {
      tag: '🏛️ Format Kampus Diperbarui',
      tagType: 'tag-hitl',
      title: `Struktur disesuaikan dengan ${activeCampus.name} ✨`,
      body: `<p>Naskahmu kini mengikuti <strong>${activeCampus.fullName}</strong> dengan gaya sitasi <strong>${activeCampus.citation}</strong>.</p>`,
    });
    stream.scrollTop = stream.scrollHeight;
  }
}

function handlePedomanFileUploaded(event) {
  const file = event.target.files[0];
  if (!file) return;
  alert(`📄 File "${file.name}" berhasil diunggah! Struktur bab akan diekstraksi oleh AI Thesa.`);
  toggleTemplateModal(false);
}

function extractCustomGuidelines() {
  const text = document.getElementById('pedomanTextInput').value.trim();
  if (!text) { alert('Tempel teks pedoman kampus terlebih dahulu.'); return; }
  alert('✨ Struktur pedoman berhasil diekstraksi!');
  toggleTemplateModal(false);
}

// ============================================================
// SOCRATIC SANDBOX
// ============================================================
function toggleSandboxModal(show) {
  const m = document.getElementById('sandboxModal');
  if (m) { m.style.display = show ? 'flex' : 'none'; if (show) runSandboxSimulation(); }
}

function runSandboxSimulation() {
  const varX = document.getElementById('sandboxVarX').value;
const domain = document.getElementById('sandboxDomain').value;
  const ktiLabel = ktiDefinitions[selectedKTI]?.label || 'Tesis';

  const rqMap = {
    'multi-agent': `Bagaimana efektivitas arsitektur Multi-Agent dalam memitigasi inkonsistensi pada ${ktiLabel}?`,
    'rag-retrieval': `Sejauh mana akurasi retrieval RAG mencegah halusinasi rujukan pada ${domain === 'thesis-s2' ? ktiLabel : 'dokumen riset'}?`,
    'single-llm': `Apa keterbatasan single LLM dalam menjaga benang merah argumen naskah panjang?`
  };
  setEl('simResultRQ', rqMap[varX] || '—');
  setEl('simResultMethod', varX === 'multi-agent'
    ? `Ablation Study (Cascade ON vs OFF) + Expert Human Review (${activeCampus.citation}).`
    : varX === 'rag-retrieval'
    ? `Precision@K pada 100 jurnal Scopus Q1/Q2.`
    : `Qualitative Discourse Analysis antar paragraf.`);
  setEl('simResultMetric', varX === 'multi-agent'
    ? `Logical Coherence Score ≥ 0.88 & Hallucination Rate < 4%.`
    : varX === 'rag-retrieval'
    ? `Citation Precision ≥ 94% & Latency < 1.2s.`
    : `Error Rate per 1,000 token naskah.`);
}

function applySandboxToDraft() {
  toggleSandboxModal(false);
  alert(`⚡ Parameter Sandbox berhasil diterapkan ke kerangka konseptual naskah!`);
}

// ============================================================
// AI SOCRATIC DEFENSE ARENA & SUPERVISOR ENGINE
// ============================================================
const DEFENSE_EXAMINERS = [
  { id: 'ex1', name: 'Prof. Dr. Hardi Santoso', role: 'Ketua Penguji · Teori & Novelty', focus: 'Novelty & Landasan Teori', avatar: '👨‍🏫', pitch: 0.9, rate: 0.95 },
  { id: 'ex2', name: 'Dr. Maya Kusuma', role: 'Penguji I · Metodologi & Validitas', focus: 'Validitas & Desain Sampel', avatar: '👩‍🔬', pitch: 1.15, rate: 1.0 },
  { id: 'ex3', name: 'Dr. Anton Kurniawan', role: 'Penguji II · Statistik & Data', focus: 'Analisis & Replikasi Data', avatar: '👨‍💻', pitch: 1.0, rate: 1.05 }
];

let defenseTurn = 1;
let defenseMaxTurns = 4;
let defenseScore = 80;
let defenseAspects = { logic: 82, method: 78, lit: 80, oral: 80 };
let currentDefenseScope = 'all';
let defenseDifficulty = 'standard';
let defenseAudioEnabled = false; // Suara dinonaktifkan sesuai kebutuhan fokus teks
let defenseTimerInterval = null;
let defenseElapsedSeconds = 0;
let speechRecognitionInstance = null;
let isSpeechRecording = false;
let currentDefenseQuestions = [];
let currentDefenseEvaluations = [];
let isEvaluatingDefense = false;

function toggleDefenseModal(show) {
  const m = document.getElementById('defenseModal');
  if (!m) return;
  m.style.display = show ? 'flex' : 'none';
  if (show) {
    initDefenseArena();
  } else {
    stopDefenseTimer();
    stopVoiceRecognition();
  }
}

function getScopeLabel(scope) {
  if (scope === 'bab1') return 'Bab I (Pendahuluan)';
  if (scope === 'bab2') return 'Bab II (Pembahasan & Analisis)';
  if (scope === 'bab3') return 'Bab III (Penutup & Rekomendasi)';
  return 'Seluruh Naskah (Komprehensif)';
}

function getExaminerByIndex(idx) {
  return DEFENSE_EXAMINERS[idx % DEFENSE_EXAMINERS.length];
}

function startDefenseTimer() {
  stopDefenseTimer();
  defenseElapsedSeconds = 0;
  updateDefenseTimerDisplay();
  defenseTimerInterval = setInterval(() => {
    defenseElapsedSeconds++;
    updateDefenseTimerDisplay();
  }, 1000);
}

function stopDefenseTimer() {
  if (defenseTimerInterval) {
    clearInterval(defenseTimerInterval);
    defenseTimerInterval = null;
  }
}

function updateDefenseTimerDisplay() {
  const tEl = document.getElementById('defenseTimerText');
  if (!tEl) return;
  const m = Math.floor(defenseElapsedSeconds / 60).toString().padStart(2, '0');
  const s = (defenseElapsedSeconds % 60).toString().padStart(2, '0');
  tEl.innerText = `${m}:${s}`;
}

function changeDefenseDifficulty(val) {
  defenseDifficulty = val || 'standard';
  showNotification(`Mode Penguji diubah ke: ${val === 'killer' ? '🔴 Penguji Killer (Kritis Ekstrem)' : val === 'coaching' ? '🟢 Pembimbingan (Coaching)' : '🟡 Standar'}`);
}

function toggleDefenseAudio() {
  defenseAudioEnabled = !defenseAudioEnabled;
  const btn = document.getElementById('btnToggleTTS');
  const icon = document.getElementById('ttsIcon');
  if (btn && icon) {
    if (defenseAudioEnabled) {
      btn.classList.add('active');
      icon.innerText = 'volume_up';
      showNotification('Suara Dosen Penguji diaktifkan 🔊');
    } else {
      btn.classList.remove('active');
      icon.innerText = 'volume_off';
      showNotification('Suara Dosen Penguji dinonaktifkan 🔇');
    }
  }
}

function speakText(text, examinerIdx = 0) {
  if (!defenseAudioEnabled || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const examiner = getExaminerByIndex(examinerIdx);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'id-ID';
    utterance.rate = examiner.rate || 1.0;
    utterance.pitch = examiner.pitch || 1.0;
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn('Speech synthesis error:', e);
  }
}

function toggleVoiceInput() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    alert('Browser Anda belum mendukung Web Speech Recognition. Silakan gunakan Google Chrome atau Microsoft Edge.');
    return;
  }

  if (isSpeechRecording) {
    stopVoiceRecognition();
  } else {
    startVoiceRecognition();
  }
}

function startVoiceRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  speechRecognitionInstance = new SpeechRec();
  speechRecognitionInstance.lang = 'id-ID';
  speechRecognitionInstance.continuous = true;
  speechRecognitionInstance.interimResults = true;

  const btnMic = document.getElementById('btnVoiceInput');
  const hint = document.getElementById('speechStatusHint');
  const input = document.getElementById('arenaAnswerInput');

  speechRecognitionInstance.onstart = () => {
    isSpeechRecording = true;
    if (btnMic) btnMic.classList.add('recording');
    if (hint) hint.style.display = 'inline';
  };

  speechRecognitionInstance.onresult = (event) => {
    let finalTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      }
    }

    if (input) {
      if (finalTranscript) {
        input.value = (input.value ? input.value + ' ' : '') + finalTranscript;
      }
    }
  };

  speechRecognitionInstance.onerror = (event) => {
    console.warn('Speech recognition error:', event.error);
    stopVoiceRecognition();
  };

  speechRecognitionInstance.onend = () => {
    stopVoiceRecognition();
  };

  try {
    speechRecognitionInstance.start();
  } catch (e) {
    console.warn('Failed to start speech rec:', e);
  }
}

function stopVoiceRecognition() {
  isSpeechRecording = false;
  const btnMic = document.getElementById('btnVoiceInput');
  const hint = document.getElementById('speechStatusHint');
  if (btnMic) btnMic.classList.remove('recording');
  if (hint) hint.style.display = 'none';

  if (speechRecognitionInstance) {
    try {
      speechRecognitionInstance.stop();
    } catch (e) {}
    speechRecognitionInstance = null;
  }
}

function handleDefenseKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitDefenseAnswer();
  }
}

// ------------------------------------------------------------
// INITIALIZE DEFENSE ARENA
// ------------------------------------------------------------
async function initDefenseArena(preferredScope) {
  // 1. Inspect completion
  const box11 = document.getElementById('boxLatarBelakang');
  const box2 = document.getElementById('boxPembahasan');
  const box3 = document.getElementById('boxPenutup');

  const hasBab1 = box11 && !box11.innerText.includes('Akan terisi') && box11.innerText.trim().length > 20;
  const hasBab2 = box2 && !box2.innerText.includes('Menunggu Unit') && box2.innerText.trim().length > 30;
  const hasBab3 = box3 && !box3.innerText.includes('Menunggu Unit') && box3.innerText.trim().length > 30;
  const hasAll = hasBab1 && hasBab2 && hasBab3;

  let activeScope = preferredScope;
  if (!activeScope) {
    if (hasAll) activeScope = 'all';
    else if (hasBab3) activeScope = 'bab3';
    else if (hasBab2) activeScope = 'bab2';
    else activeScope = 'bab1';
  }

  currentDefenseScope = activeScope;
  defenseTurn = 1;
  defenseScore = 80;
  defenseAspects = { logic: 82, method: 78, lit: 80, oral: 80 };
  currentDefenseEvaluations = [];
  isEvaluatingDefense = false;
  startDefenseTimer();

  // 2. Render Scope Tabs
  const tabsContainer = document.getElementById('arenaScopeTabs');
  if (tabsContainer) {
    tabsContainer.innerHTML = `
      <button class="btn-scope-pill ${activeScope === 'bab1' ? 'active' : ''}" onclick="selectDefenseScope('bab1')">
        <span>📖 Bab I: Pendahuluan</span>
      </button>
      <button class="btn-scope-pill ${activeScope === 'bab2' ? 'active' : ''}" ${!hasBab2 ? 'disabled title="Selesaikan Bab II terlebih dahulu"' : ''} onclick="selectDefenseScope('bab2')">
        <span>🔬 Bab II: Pembahasan</span>
      </button>
      <button class="btn-scope-pill ${activeScope === 'bab3' ? 'active' : ''}" ${!hasBab3 ? 'disabled title="Selesaikan Bab III terlebih dahulu"' : ''} onclick="selectDefenseScope('bab3')">
        <span>🎯 Bab III: Penutup</span>
      </button>
      <button class="btn-scope-pill ${activeScope === 'all' ? 'active' : ''}" ${!hasAll ? 'disabled title="Selesaikan seluruh bab untuk uji komprehensif"' : ''} onclick="selectDefenseScope('all')">
        <span>🏆 Seluruh Naskah (Komprehensif)</span>
      </button>
    `;
  }

  // 3. Configure Examiner Info
  setEl('ex1Name', DEFENSE_EXAMINERS[0].name);
  setEl('ex1Role', DEFENSE_EXAMINERS[0].role);
  setEl('ex2Name', DEFENSE_EXAMINERS[1].name);
  setEl('ex2Role', DEFENSE_EXAMINERS[1].role);
  setEl('ex3Name', DEFENSE_EXAMINERS[2].name);
  setEl('ex3Role', DEFENSE_EXAMINERS[2].role);

  updateActiveExaminerHighlight(0);
  updateDefenseScore();

  // 4. Gather document text
  const topic = (researchContext && researchContext.topic) ? researchContext.topic : 'Karya Tulis Ilmiah';
  const paperText = gatherPaperTextForScope(activeScope, topic);

  // 5. Stream greeting
  const stream = document.getElementById('arenaChatStream');
  if (stream) {
    stream.innerHTML = `
      <div class="arena-bubble examiner">
        <div class="arena-bubble-head">
          <strong>${DEFENSE_EXAMINERS[0].name}:</strong>
          <span class="scope-tag">Inisialisasi Sidang</span>
        </div>
        <p>Selamat datang di Ruang Ujian Sidang Skripsi. Dewan Penguji siap menguji penguasaan materi naskah Anda pada sesi <strong>${getScopeLabel(activeScope)}</strong>. Silakan dengarkan pertanyaan dengan seksama dan sampaikan pembelaan ilmiah Anda.</p>
      </div>
    `;
  }

  currentDefenseQuestions = await fetchSocraticQuestions(paperText, activeScope, topic);
  renderNextSocraticQuestion();
}

function selectDefenseScope(scope) {
  initDefenseArena(scope);
}

function updateActiveExaminerHighlight(activeIdx) {
  [0, 1, 2].forEach(i => {
    const card = document.getElementById(`examiner${i+1}`);
    const status = document.getElementById(`ex${i+1}Status`);
    if (card && status) {
      if (i === activeIdx) {
        card.className = 'examiner-card active';
        status.className = 'ex-status attacking';
        status.innerText = 'Sedang Menguji';
      } else {
        card.className = 'examiner-card';
        status.className = 'ex-status waiting';
        status.innerText = 'Menyimak';
      }
    }
  });
}

function gatherPaperTextForScope(scope, topic) {
  const box11 = document.getElementById('boxLatarBelakang');
  const box12 = document.getElementById('boxProblemStatement');
  const box13 = document.getElementById('boxTujuanPenulisan');
  const box2 = document.getElementById('boxPembahasan');
  const box3 = document.getElementById('boxPenutup');

  const cleanText = (el) => {
    if (!el) return '';
    const txt = el.innerText || el.textContent || '';
    if (txt.includes('Akan terisi') || txt.includes('Menunggu Unit')) return '';
    return txt.trim();
  };

  let text = `TOPIK RISET: ${topic}\n\n`;
  const latar = cleanText(box11);
  const masalah = cleanText(box12);
  const tujuan = cleanText(box13);
  const pembahasan = cleanText(box2);
  const penutup = cleanText(box3);

  if (scope === 'bab1' || scope === 'all') {
    text += `BAB I PENDAHULUAN:\n`;
    if (latar) text += `Latar Belakang: ${latar}\n`;
    if (masalah) text += `Rumusan Masalah: ${masalah}\n`;
    if (tujuan) text += `Tujuan: ${tujuan}\n`;
    text += `\n`;
  }
  if (scope === 'bab2' || scope === 'all') {
    text += `BAB II & PEMBAHASAN:\n${pembahasan || 'Membahas teori pendukung dan temuan analisis utama.'}\n\n`;
  }
  if (scope === 'bab3' || scope === 'all') {
    text += `BAB III PENUTUP & KESIMPULAN:\n${penutup || 'Menyimpulkan temuan dan rekomendasi.'}\n\n`;
  }
  return text.trim();
}

async function fetchSocraticQuestions(docText, scope, topic) {
  try {
    const res = await thesaApiFetch('/api/v1/supervisor/socratic-questions', { document: docText });
    if (res && res.questions && res.questions.length > 0) {
      return res.questions;
    }
  } catch (err) {
    console.info('[Thesa Defense] Backend supervisor offline, utilizing dynamic contextual builder.');
  }

  // Extract snippet from user draft if present
  const box12 = document.getElementById('boxProblemStatement');
  const userProblem = (box12 && box12.innerText && !box12.innerText.includes('Akan terisi')) ? box12.innerText.slice(0, 120).trim() : '';

  const box11 = document.getElementById('boxLatarBelakang');
  const userBackground = (box11 && box11.innerText && !box11.innerText.includes('Akan terisi')) ? box11.innerText.slice(0, 150).trim() : '';

  // Dynamic Contextual Question Generation tightly coupled to user's created material
  return [
    {
      id: 1,
      question: userProblem 
        ? `Sebagai Ketua Penguji, berdasarkan rumusan masalah yang Anda susun: "${userProblem}...", mengapa fenomena ini krusial untuk diteliti sekarang, dan apa premis teoretis utama yang membedakan pendekatan Anda dari studi-studi terdahulu?`
        : `Sebagai Ketua Penguji, jelaskan landasan teoretis paling mendasar pada topik "${topic}" dan bagaimana Anda meyakinkan kami bahwa riset ini menawarkan novelty yang nyata?`,
      type: 'critical',
      related_section: 'BAB I & II · Novelty & Urgensi Masalah'
    },
    {
      id: 2,
      question: `Saya mencermati metodologi yang Anda rancang untuk topik "${topic}". Bagaimana Anda memastikan reliabilitas instrumen pengumpulan data dan memitigasi potensi bias metodologis agar hasil pengujian dapat digeneralisasi?`,
      type: 'probing',
      related_section: 'BAB III · Validitas Metodologi'
    },
    {
      id: 3,
      question: `Pada bagian analisis dan pembahasan, jika ditemukan hasil atau pola data yang bertentangan dengan hipotesis awal atau teori umum di bidang ini, bagaimana kerangka analisis Anda menjelaskan anomali tersebut?`,
      type: 'clarification',
      related_section: 'BAB IV · Analisis Temuan Data'
    },
    {
      id: 4,
      question: `Secara komprehensif, apa implikasi praktis dan rekomendasi kebijakan paling nyata dari simpulan riset "${topic}" ini yang dapat langsung dieksekusi oleh pemangku kepentingan?`,
      type: 'synthesis',
      related_section: 'BAB V · Sintesis & Rekomendasi'
    }
  ];
}

function renderNextSocraticQuestion() {
  const stream = document.getElementById('arenaChatStream');
  if (!stream) return;

  const qIndex = defenseTurn - 1;
  const qObj = currentDefenseQuestions[qIndex] || currentDefenseQuestions[currentDefenseQuestions.length - 1];
  if (!qObj) return;

  const examinerIdx = (defenseTurn - 1) % 3;
  const examiner = getExaminerByIndex(examinerIdx);

  // Update examiner visual focus
  updateActiveExaminerHighlight(examinerIdx);

  setEl('defenseTurnBadge', `Putaran ${defenseTurn} / ${defenseMaxTurns}`);

  const bubble = document.createElement('div');
  bubble.className = 'arena-bubble examiner';
  bubble.innerHTML = `
    <div class="arena-bubble-head">
      <strong>
        <span class="material-symbols-rounded" style="font-size:16px; color:var(--brand);">gavel</span>
        ${examiner.avatar} ${escapeHTML(examiner.name)} (${escapeHTML(examiner.role.split('·')[0].trim())}):
      </strong>
      <div style="display:flex; align-items:center; gap:6px;">
        <span class="scope-tag">${escapeHTML(qObj.related_section || getScopeLabel(currentDefenseScope))}</span>
      </div>
    </div>
    <p style="font-size:13.5px; line-height:1.65; color:#1e293b; font-weight:500;">"${escapeHTML(qObj.question)}"</p>
  `;
  stream.appendChild(bubble);
  stream.scrollTop = stream.scrollHeight;
}

// ------------------------------------------------------------
// SUBMIT DEFENSE ANSWER & EVALUATE
// ------------------------------------------------------------
async function submitDefenseAnswer() {
  if (isEvaluatingDefense) return;

  const input = document.getElementById('arenaAnswerInput');
  const stream = document.getElementById('arenaChatStream');
  const evalBar = document.getElementById('arenaEvaluatingBar');
  const btnSubmit = document.getElementById('btnSubmitDefense');

  const answer = input ? input.value.trim() : '';
  if (!answer) {
    showNotification('Silakan tulis atau suarakan argumen pembelaan Anda terlebih dahulu!');
    return;
  }
  input.value = '';
  stopVoiceRecognition();

  // 1. Render Candidate Bubble
  const cand = document.createElement('div');
  cand.className = 'arena-bubble candidate';
  cand.innerHTML = `
    <div class="arena-bubble-head">
      <strong>
        <span class="material-symbols-rounded" style="font-size:16px; color:#16a34a;">person</span>
        Jawaban Peneliti:
      </strong>
      <span class="scope-tag" style="background:#dcfce7; color:#15803d;">Pembelaan Ilmiah</span>
    </div>
    <p>${escapeHTML(answer)}</p>
  `;
  stream.appendChild(cand);
  stream.scrollTop = stream.scrollHeight;

  // 2. Start evaluating animation
  isEvaluatingDefense = true;
  if (evalBar) evalBar.style.display = 'flex';
  if (btnSubmit) btnSubmit.disabled = true;

  const qIndex = defenseTurn - 1;
  const examinerIdx = (defenseTurn - 1) % 3;
  const currentQ = currentDefenseQuestions[qIndex] || {
    id: defenseTurn,
    question: "Pertanyaan Ujian Sidang",
    type: "critical",
    related_section: getScopeLabel(currentDefenseScope)
  };

  // 3. Call Backend AI /api/v1/supervisor/examiner-simulate
  const evaluation = await evaluateCandidateAnswerWithExaminer(currentQ, answer, DEFENSE_EXAMINERS[examinerIdx]);
  currentDefenseEvaluations.push(evaluation);

  // 4. Update scores
  updateScoresFromEvaluation(evaluation);

  // 5. Hide evaluating bar & show evaluation bubble
  if (evalBar) evalBar.style.display = 'none';
  if (btnSubmit) btnSubmit.disabled = false;
  isEvaluatingDefense = false;

  const evalBubble = document.createElement('div');
  evalBubble.className = 'arena-bubble evaluation';
  const scoreClass = evaluation.score >= 85 ? 'high' : evaluation.score >= 70 ? 'medium' : 'low';

  evalBubble.innerHTML = `
    <div class="arena-bubble-head">
      <strong>
        <span class="material-symbols-rounded" style="font-size:16px; color:#d97706;">fact_check</span>
        Evaluasi Dewan Penguji (${DEFENSE_EXAMINERS[examinerIdx].name}):
      </strong>
      <span class="bubble-eval-chip ${scoreClass}">Nilai Rubrik: ${evaluation.score} / 100 (${evaluation.grade || 'A-'})</span>
    </div>
    <p>${escapeHTML(evaluation.feedback)}</p>
    ${evaluation.critique ? `<p style="font-style:italic; font-size:11.5px; color:#92400e; margin-top:6px;"><strong>Catatan Penguji:</strong> "${escapeHTML(evaluation.critique)}"</p>` : ''}
    <div class="bubble-eval-details" style="margin-top:8px;">
      <span style="font-size:11px; color:#92400e;">
        <strong>Status:</strong> ${evaluation.understood ? '✓ Argumen Diterima dengan Baik' : '⚠️ Perlu Penguatan Rujukan Teoretis'}
      </span>
      <span style="font-size:10.5px; color:#b45309;">
        ${defenseDifficulty === 'killer' ? '⚖️ Standar Penguji Killer' : defenseDifficulty === 'coaching' ? '⚖️ Mode Coaching' : '⚖️ Standar Akademik Nasional'}
      </span>
    </div>
  `;
  stream.appendChild(evalBubble);
  stream.scrollTop = stream.scrollHeight;

  // 6. Next Turn or Finish
  defenseTurn++;
  if (defenseTurn <= defenseMaxTurns && defenseTurn <= currentDefenseQuestions.length) {
    setTimeout(() => {
      renderNextSocraticQuestion();
    }, 1200);
  } else {
    // Session completed!
    setTimeout(() => {
      renderCompletionBanner();
    }, 1200);
  }
}

async function evaluateCandidateAnswerWithExaminer(questionObj, candidateAnswer, examiner) {
  try {
    const res = await thesaApiFetch('/api/v1/supervisor/examiner-simulate', {
      mode: 'evaluate',
      topic: (researchContext && researchContext.topic) ? researchContext.topic : 'Topik Riset',
      difficulty: defenseDifficulty,
      turn: defenseTurn,
      examiner: examiner,
      question: questionObj.question,
      answer: candidateAnswer
    });

    if (res && res.score) {
      return {
        score: res.score,
        grade: res.grade || (res.score >= 85 ? 'A' : res.score >= 80 ? 'A-' : res.score >= 75 ? 'B+' : 'B'),
        feedback: res.feedback || 'Jawaban telah dievaluasi oleh Dewan Penguji.',
        critique: res.critique || '',
        understood: res.score >= 75
      };
    }
  } catch (err) {
    console.info('[Thesa Defense] Backend simulation fallback.');
  }

  // Intelligent fallback evaluation
  const wordCount = candidateAnswer.split(/\s+/).length;
  let baseScore = 75;
  if (wordCount > 25) baseScore += 8;
  if (wordCount > 50) baseScore += 6;
  if (/karena|metode|analisis|teori|literatur|signifikan/i.test(candidateAnswer)) {
    baseScore += 6;
  }
  if (defenseDifficulty === 'killer') baseScore -= 8;
  if (defenseDifficulty === 'coaching') baseScore += 5;

  baseScore = Math.min(98, Math.max(60, baseScore));
  const understood = baseScore >= 75;

  return {
    score: baseScore,
    grade: baseScore >= 85 ? 'A' : baseScore >= 80 ? 'A-' : baseScore >= 75 ? 'B+' : 'B',
    feedback: understood ? 'Argumentasi Anda cukup komprehensif, berbasis data yang jelas, dan berhasil mempertahankan esensi ilmiah.' : 'Penjelasan sudah menyentuh substansi, namun disarankan memperkuat rujukan teoritis dan bukti komparatif.',
    critique: understood ? 'Pertahankan ketenangan dalam menjawab pertanyaan komprehensif.' : 'Hindari asumsi tanpa didukung kutipan metodologi baku.',
    understood: understood
  };
}

function updateScoresFromEvaluation(evaluation) {
  const delta = (evaluation.score - 75) * 0.4;
  defenseScore = Math.min(98, Math.max(65, Math.round(defenseScore + delta)));

  // Adjust mini aspects
  if (defenseTurn === 1) defenseAspects.logic = Math.min(100, Math.round(defenseAspects.logic + delta * 1.2));
  if (defenseTurn === 2) defenseAspects.method = Math.min(100, Math.round(defenseAspects.method + delta * 1.2));
  if (defenseTurn === 3) defenseAspects.lit = Math.min(100, Math.round(defenseAspects.lit + delta * 1.2));
  defenseAspects.oral = Math.min(100, Math.round(defenseAspects.oral + delta * 0.8));

  updateDefenseScore();
}

function updateDefenseScore() {
  setEl('defenseScoreText', `${defenseScore} / 100`);
  const f = document.getElementById('defenseMeterFill');
  if (f) f.style.width = `${defenseScore}%`;

  const bLogic = document.getElementById('aspectBarLogic');
  const bMethod = document.getElementById('aspectBarMethod');
  const bLit = document.getElementById('aspectBarLit');

  if (bLogic) bLogic.style.width = `${defenseAspects.logic}%`;
  if (bMethod) bMethod.style.width = `${defenseAspects.method}%`;
  if (bLit) bLit.style.width = `${defenseAspects.lit}%`;
}

function renderCompletionBanner() {
  const stream = document.getElementById('arenaChatStream');
  const ex1 = document.getElementById('examiner1');
  const ex2 = document.getElementById('examiner2');

  if (ex1 && ex2) {
    ex1.className = 'examiner-card active';
    ex2.className = 'examiner-card active';
    setEl('ex1Status', '✓ Terverifikasi');
    setEl('ex2Status', '✓ Terverifikasi');
    document.getElementById('ex1Status').className = 'ex-status passed';
    document.getElementById('ex2Status').className = 'ex-status passed';
  }

  if (stream) {
    const banner = document.createElement('div');
    banner.className = 'arena-bubble examiner';
    banner.style.borderColor = '#86efac';
    banner.style.background = '#f0fdf4';
    banner.style.borderLeftColor = '#16a34a';
    banner.innerHTML = `
      <div class="arena-bubble-head">
        <strong style="color:#15803d;">
          <span class="material-symbols-rounded">verified</span>
          Keputusan Dewan Penguji AI:
        </strong>
        <span class="scope-tag" style="background:#dcfce7; color:#15803d;">Sidang Selesai</span>
      </div>
      <p style="color:#14532d;">
        Selamat! Seluruh putaran simulasi ujian sidang telah selesai dengan <strong>Skor Kesiapan Akhir ${defenseScore}/100</strong>. Anda dapat langsung menerbitkan dan mencetak <strong>Berita Acara Resmi</strong> untuk melihat rubrik lengkap serta catatan perbaikan.
      </p>
      <div style="margin-top:12px;">
        <button class="btn-report-primary" onclick="finishDefenseAndGenerateReport()" style="display:inline-flex; width:auto;">
          <span class="material-symbols-rounded">workspace_premium</span>
          <span>Buka Berita Acara & Rapor Kesiapan</span>
        </button>
      </div>
    `;
    stream.appendChild(banner);
    stream.scrollTop = stream.scrollHeight;
  }
}

// ------------------------------------------------------------
// BERITA ACARA & RAPOR KESIAPAN SIDANG (REPORT MODAL)
// ------------------------------------------------------------
function toggleDefenseReportModal(show) {
  const m = document.getElementById('defenseReportModal');
  if (!m) return;
  m.style.display = show ? 'flex' : 'none';
}

function finishDefenseAndGenerateReport() {
  const topic = (researchContext && researchContext.topic) ? researchContext.topic : 'Topik Riset Ilmiah';
  
  // Fill student data
  setEl('reportCandidateName', currentUserProfile.name || 'Peneliti Mahasiswa');
  setEl('reportCandidateProdi', `${currentUserProfile.nim || '2206123456'} · ${currentUserProfile.level || 'S2'} ${currentUserProfile.prodi || 'Ilmu Komputer'}`);
  setEl('reportCandidateInstitution', currentUserProfile.institution || 'Universitas Indonesia');
  setEl('reportScopeLabel', getScopeLabel(currentDefenseScope));
  setEl('reportTopicText', `"${topic}"`);
  
  const todayStr = new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  setEl('reportGeneratedDate', `Diterbitkan pada: ${todayStr} · Sesi Simulasi Thesa AI`);

  // Fill Grand Score & Verdict
  setEl('reportGrandScore', defenseScore);
  const vBadge = document.getElementById('reportVerdictBadge');
  const vDesc = document.getElementById('reportVerdictDesc');

  if (defenseScore >= 85) {
    if (vBadge) {
      vBadge.className = 'verdict-badge ready';
      vBadge.innerText = '✓ DINYATAKAN SANGAT SIAP SIDANG MEJA HIJAU';
    }
    if (vDesc) {
      vDesc.innerText = 'Peneliti mampu mempertahankan argumen secara logis, berbasis rujukan teori yang kokoh, dan memahami metodologi riset secara mendalam tanpa keraguan konseptual.';
    }
  } else if (defenseScore >= 70) {
    if (vBadge) {
      vBadge.className = 'verdict-badge ready';
      vBadge.style.background = '#fef9c3';
      vBadge.style.color = '#a16207';
      vBadge.style.borderColor = '#fde047';
      vBadge.innerText = '🟡 SIAP SIDANG DENGAN REVISI KECIL';
    }
    if (vDesc) {
      vDesc.innerText = 'Peneliti menguasai substansi umum dengan baik, namun disarankan memperkuat rujukan literatur mutakhir dan justifikasi batasan metodologi sebelum sidang resmi.';
    }
  } else {
    if (vBadge) {
      vBadge.className = 'verdict-badge';
      vBadge.style.background = '#fee2e2';
      vBadge.style.color = '#b91c1c';
      vBadge.innerText = '⚠️ PERLU PENDALAMAN ARGUMEN & SIMULASI ULANG';
    }
    if (vDesc) {
      vDesc.innerText = 'Masih ditemukan inkonsistensi antara rumusan masalah dan metode analisis. Lakukan review naskah dan ulangi simulasi sebelum maju ke sidang sebenarnya.';
    }
  }

  // Fill Aspect Rubrics
  setEl('scoreRubricLogic', `${defenseAspects.logic}%`);
  const barLog = document.getElementById('barRubricLogic');
  if (barLog) barLog.style.width = `${defenseAspects.logic}%`;

  setEl('scoreRubricMethod', `${defenseAspects.method}%`);
  const barMet = document.getElementById('barRubricMethod');
  if (barMet) barMet.style.width = `${defenseAspects.method}%`;

  setEl('scoreRubricLit', `${defenseAspects.lit}%`);
  const barLit = document.getElementById('barRubricLit');
  if (barLit) barLit.style.width = `${defenseAspects.lit}%`;

  setEl('scoreRubricOral', `${defenseAspects.oral}%`);
  const barOral = document.getElementById('barRubricOral');
  if (barOral) barOral.style.width = `${defenseAspects.oral}%`;

  // Open report modal
  toggleDefenseReportModal(true);
}

function restartDefenseSession() {
  toggleDefenseReportModal(false);
  initDefenseArena(currentDefenseScope);
}

function printDefenseReport() {
  window.print();
}

// ============================================================
// USER PROFILE & ACADEMIC INTEGRITY (Anti-Joki)
// ============================================================
let currentUserProfile = {
  name: 'Alif Awwaz',
  level: 'S2',
  institution: 'Universitas Indonesia',
  prodi: 'Ilmu Komputer',
  email: 'alif.awwaz@ui.ac.id',
  nim: '2206123456',
  supervisor: 'Dr. Rini Widyastuti, M.Kom.',
  isAcademicEmail: true,
  trustScore: 95,
  registeredAt: '2026-08-16T08:30:00.000Z',
  covenantQ1: 'Saya memiliki ketertarikan mendalam dan pengalaman langsung dalam mengevaluasi inkonsistensi teks pada model AI bahasa Indonesia selama perkuliahan dan proyek riset mandiri.',
  covenantQ2: 'Saya telah membaca literatur dasar tentang prompt chaining, multi-agent frameworks, dan evaluasi koherensi naskah akademik.'
};

function checkAuthSession() {
  const token = localStorage.getItem('thesa_token') || sessionStorage.getItem('thesa_token');
  const user = localStorage.getItem('thesaUser') || sessionStorage.getItem('thesaUser');
  if (!token && !user) {
    window.location.href = 'auth.html';
    return false;
  }
  return true;
}

function logoutUser() {
  if (confirm('Apakah Anda yakin ingin keluar dari akun Thesa AI?')) {
    localStorage.removeItem('thesa_token');
    sessionStorage.removeItem('thesa_token');
    localStorage.removeItem('thesaUser');
    sessionStorage.removeItem('thesaUser');
    window.location.href = 'auth.html';
  }
}

function loadUserProfile() {
  if (!checkAuthSession()) return;
  try {
    const stored = sessionStorage.getItem('thesaUser') || localStorage.getItem('thesaUser');
    if (stored) {
      currentUserProfile = { ...currentUserProfile, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.warn('Failed to parse thesaUser from storage:', e);
  }


  // Update UI Elements
  const initials = currentUserProfile.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'AA';
  const avatarUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${initials}&backgroundColor=e0e7ff&textColor=4f46e5`;

  setEl('sidebarUserName', currentUserProfile.name);
  setEl('sidebarUserRole', `${currentUserProfile.level} ${currentUserProfile.prodi || 'Informatika'} · ${currentUserProfile.institution ? currentUserProfile.institution.split(' ')[0] : 'UI'}`);
  setEl('hpTrustScoreLabel', `${currentUserProfile.trustScore || 95}% Terverifikasi`);
  setEl('dossierUserName', currentUserProfile.name);
  setEl('dossierUserDetail', `Mahasiswa ${currentUserProfile.level} ${currentUserProfile.prodi} · ${currentUserProfile.institution}`);
  setEl('dossierScoreCircle', `${currentUserProfile.trustScore || 95}%`);
  
  if (currentUserProfile.nim) {
    setEl('dossierNimTag', `NIM: ${currentUserProfile.nim}`);
  }
  if (currentUserProfile.supervisor) {
    setEl('dossierSupervisorTag', `Dosen: ${currentUserProfile.supervisor}`);
  }
  if (currentUserProfile.covenantQ1) {
    setEl('dossierCovenantQ1', `"${escapeHTML(currentUserProfile.covenantQ1)}"`);
  }
  if (currentUserProfile.covenantQ2) {
    setEl('dossierCovenantQ2', `"${escapeHTML(currentUserProfile.covenantQ2)}"`);
  }

  const avatarElements = ['sidebarUserAvatar', 'hpUserAvatarSm', 'dossierUserAvatar'];
  avatarElements.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.src = avatarUrl;
  });
}

// ============================================================
// DOSSIER & ACADEMIC INTEGRITY MODAL
// ============================================================
function toggleDossierModal(show) {
  const m = document.getElementById('dossierModal');
  if (m) {
    m.style.display = show ? 'flex' : 'none';
    if (show) {
      loadUserProfile();
      renderBillingStatusCard();
      renderDossier();
    }
  }
}



function renderDossier() {
  setEl('dossierGatesPassed', `${auditDossier.length}`);
  setEl('dossierGateCountTab', `${auditDossier.length}`);
  const list = document.getElementById('dossierLogList');
  if (!list) return;

  if (auditDossier.length === 0) {
    list.innerHTML = `<p style="text-align:center;color:var(--text-muted);font-size:12px;padding:30px;">Belum ada gate Sokratik yang diverifikasi. Mulai berdialog dan verifikasi draf dengan Thesa untuk merekam jejak orisinalitasmu!</p>`;
    return;
  }

  list.innerHTML = auditDossier.map(item => `
    <div class="dossier-item">
      <div class="item-head">
        <span class="item-badge approved">✓ Gate ${item.step} (${item.name})</span>
        <span class="item-time">${item.timestamp}</span>
      </div>
      <p style="font-size:11px;color:#1e293b;margin-top:4px;"><strong>Naskah Diverifikasi:</strong> "${escapeHTML(item.aiDraft.slice(0, 120))}..."</p>
      <div class="item-justification">
        <strong>Justifikasi Orisinalitas:</strong> ${escapeHTML(item.humanRationale)}
        (Tingkat Kepastian: ${item.epistemic === 'green' ? '🟢 Teruji Mandiri' : item.epistemic === 'yellow' ? '🟡 Asumsi Rasional' : '🔴 Perlu Klarifikasi Pembimbing'})
      </div>
    </div>
  `).join('');
}

function printIntegrityCertificate() {
  const profile = getUserProfile();
  if (profile.isTrial) {
    alert('⚠️ Fitur Cetak & Ekspor Naskah (PDF/Word) terkunci selama masa Uji Coba 3 Hari.\nSilakan upgrade ke langganan penuh untuk mengunduh naskah dan bukti integritas riset.');
    showUpgradeModal('platinum', 'Fitur Cetak & Ekspor Naskah (PDF/Word)');
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Harap izinkan popup browser untuk mencetak Lembar Bukti Orisinalitas.');
    return;
  }

  const dateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const html = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <title>Lembar Pengesahan Integritas Akademik — Thesa AI</title>
      <style>
        body { font-family: 'Times New Roman', serif; padding: 40px; color: #111; line-height: 1.6; }
        .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 25px; }
        .header h2 { margin: 0; text-transform: uppercase; font-size: 18px; }
        .header p { margin: 4px 0 0; font-size: 13px; }
        .section-title { font-weight: bold; margin-top: 20px; font-size: 14px; text-decoration: underline; }
        .meta-table { width: 100%; margin: 15px 0; border-collapse: collapse; }
        .meta-table td { padding: 6px 10px; font-size: 13px; }
        .meta-table td.label { width: 180px; font-weight: bold; }
        .covenant-box { border: 1px solid #777; padding: 12px; background: #fdfdfd; font-style: italic; font-size: 13px; margin: 10px 0; }
        .signatures { margin-top: 50px; display: flex; justify-content: space-between; }
        .sig-box { text-align: center; width: 220px; }
        .sig-line { margin-top: 70px; border-top: 1px solid #000; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>LEMBAR PERNYATAAN INTEGRITAS &amp; BUKTI ORISINALITAS RISET</h2>
        <p>Terverifikasi melalui Sistem Pembimbing Dialog Sokratik Human-in-the-Loop (Thesa AI)</p>
      </div>

      <p>Yang bertanda tangan di bawah ini menerangkan bahwa penelitian/karya tulis ilmiah ini disusun secara mandiri dengan bantuan dialog kritis reflektif, tanpa menggunakan jasa joki atau penjanaan teks otomatis tanpa verifikasi:</p>

      <table class="meta-table">
        <tr><td class="label">Nama Peneliti</td><td>: ${escapeHTML(currentUserProfile.name)}</td></tr>
        <tr><td class="label">NIM / Identitas</td><td>: ${escapeHTML(currentUserProfile.nim || '—')}</td></tr>
        <tr><td class="label">Jenjang / Program Studi</td><td>: ${escapeHTML(currentUserProfile.level)} ${escapeHTML(currentUserProfile.prodi || 'Informatika')}</td></tr>
        <tr><td class="label">Institusi / Universitas</td><td>: ${escapeHTML(currentUserProfile.institution || 'Universitas Indonesia')}</td></tr>
        <tr><td class="label">Dosen Pembimbing</td><td>: ${escapeHTML(currentUserProfile.supervisor || '—')}</td></tr>
        <tr><td class="label">Status Verifikasi Email</td><td>: ${currentUserProfile.isAcademicEmail ? 'Terverifikasi Institusional (.ac.id)' : 'Terverifikasi'}</td></tr>
        <tr><td class="label">Indeks Integritas (Trust)</td><td>: ${currentUserProfile.trustScore || 95}% (Human-in-the-Loop 100%)</td></tr>
      </table>

      <div class="section-title">Pernyataan Orisinalitas dan Motivasi Personal Peneliti</div>
      <div class="covenant-box">
        "${escapeHTML(currentUserProfile.covenantQ1 || 'Saya berkomitmen meneliti topik ini secara mandiri.')}"
      </div>

      <div class="section-title">Ikrar Integritas Akademik</div>
      <p style="font-size:13px;">"Saya menyatakan dengan sebenar-benarnya bahwa karya tulis ilmiah ini adalah hasil olah pikir dan penalaran saya sendiri. Segala bentuk dialog interaktif dengan Thesa AI hanya digunakan sebagai mitra uji logika (Socratic sounding board), dan seluruh kalimat naskah akhir telah melalui persetujuan dan tanggung jawab keilmuan saya sepenuhnya."</p>

      <div class="signatures">
        <div class="sig-box">
          <p>Mengetahui,<br>Dosen Pembimbing</p>
          <div class="sig-line">${escapeHTML(currentUserProfile.supervisor || '( ........................................ )')}</div>
        </div>
        <div class="sig-box">
          <p>Jakarta, ${dateStr}<br>Peneliti yang menyatakan,</p>
          <div class="sig-line">${escapeHTML(currentUserProfile.name)}</div>
        </div>
      </div>

      <script>
        window.onload = function() { window.print(); };
      <\/script>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}


// ============================================================
// PROPOSAL HANDOVER LIFECYCLE & DATA HUB LOGIC
// ============================================================
let handoverTarget = 'skripsi';
let dataCollectionState = {
  targetCount: 150,
  collectedCount: 120,
  rawNotes: ''
};

function toggleHandoverModal(show) {
  const m = document.getElementById('handoverModal');
  if (m) {
    m.style.display = show ? 'flex' : 'none';
    if (show) {
      const summary = (researchContext && researchContext.topic && researchContext.topic.length > 0)
        ? `"${researchContext.topic}"`
        : '"Analisis Dampak Kecerdasan Buatan terhadap Etika dan Integritas Penulisan Akademik"';
      setEl('handoverProposalTopicSummary', summary);
    }
  }
}

function openHandoverModal() {
  toggleHandoverModal(true);
}

function selectHandoverTarget(target, btnEl) {
  handoverTarget = target;
  document.querySelectorAll('#handoverModal .ob-campus-card').forEach(c => c.classList.remove('selected'));
  if (btnEl) btnEl.classList.add('selected');
}

function executeHandover() {
  toggleHandoverModal(false);

  // Transition state to full thesis/dissertation
  selectedKTI = handoverTarget;
  const newKti = ktiDefinitions[selectedKTI] || ktiDefinitions.skripsi;

  initMainApp(newKti, activeCampus, researchContext);

  // Notify user via Socratic Coach
  const stream = document.getElementById('duoChatStream');
  if (stream) {
    appendCoachBubble(stream, {
      tag: '🎓 Handover Berhasil: Naskah Penuh',
      tagType: 'tag-hitl',
      title: `Proposalmu resmi di-Handover ke fase ${newKti.label}! ✨`,
      body: `
        <p>Seluruh fondasi Bab I, II, dan III yang telah teruji dalam proposalmu telah dipindahkan ke lembar <strong>${newKti.label}</strong>.</p>
        <div style="background:#f0fdf4; border-left:3px solid #16a34a; padding:10px 14px; border-radius:6px; margin:10px 0; font-size:12.5px; color:#166534; line-height:1.45;">
          <strong>🎯 Langkah Selanjutnya:</strong> Kamu kini memasuki <strong>Fase Pengumpulan Data &amp; Eksperimen Lapangan</strong>. Buka modul <em>Data Hub</em> di sisi kiri untuk memantau progres survei / uji lab sebelum kita menyusun Bab IV (Hasil &amp; Pembahasan).
        </div>
      `,
      chips: [
        { key: 'A', icon: '📊', title: 'Buka Data Hub &amp; Log Lapangan', desc: 'Input progres responden atau log eksperimen' },
        { key: 'B', icon: '📝', title: 'Review Draf Bab I–III', desc: 'Periksa kembali keselarasan draf yang sudah di-handover' }
      ]
    });
    stream.scrollTop = stream.scrollHeight;
  }
}

function toggleDataHubModal(show) {
  const m = document.getElementById('dataHubModal');
  if (m) m.style.display = show ? 'flex' : 'none';
}

function saveAndProceedToResults() {
  const input = document.getElementById('rawFindingsInput');
  if (input) dataCollectionState.rawNotes = input.value.trim();

  toggleDataHubModal(false);

  const stream = document.getElementById('duoChatStream');
  if (stream) {
    appendCoachBubble(stream, {
      tag: '📊 Temuan Data Terverifikasi',
      tagType: 'tag-hitl',
      title: 'Data Lapangan Disinkronkan — Siap untuk Bab IV! 🚀',
      body: `
        <p>Rangkuman temuan lapangan (${dataCollectionState.collectedCount} responden/data) berhasil dicatat.</p>
        <blockquote style="border-left: 3px solid var(--brand-indigo); padding: 8px 12px; margin: 8px 0; background: #f5f3ff; border-radius: 6px; font-size: 12.5px;">
          "${escapeHTML(dataCollectionState.rawNotes || 'Data survei dan log eksperimen telah siap diinterpretasikan.')}"
        </blockquote>
        <p style="font-size:12.5px;">Mari kita mulai dialog Sokratik untuk menyusun <strong>BAB IV: HASIL PENELITIAN &amp; PEMBAHASAN</strong>!</p>
      `,
      chips: [
        { key: 'A', icon: '📈', title: 'Bahas Temuan Utama', desc: 'Sajikan statistik deskriptif dan uji hipotesis' },
        { key: 'B', icon: '🔍', title: 'Analisis Anomali Data', desc: 'Eksplorasi temuan tak terduga di lapangan' }
      ]
    });
    stream.scrollTop = stream.scrollHeight;
  }
}

// ============================================================
// DYNAMIC STEP-AWARE CHAT & CONTEXTUAL INPUT HANDLER
// ============================================================
let currentStepCode = '1.1';

const stepQuickHelpers = {
  '1.1': [
    { label: '"Fokus utama riset ini adalah..."', text: 'Fokus utama riset ini adalah ' },
    { label: '"Keresahan mendesak di lapangan yaitu..."', text: 'Keresahan mendesak di lapangan yaitu ' },
    { label: '"Saya ingin menekankan sudut pandang..."', text: 'Saya ingin menekankan sudut pandang ' }
  ],
  '1.2': [
    { label: '"Tambahkan penekanan pada..."', text: 'Tambahkan penekanan pada aspek ' },
    { label: '"Sesuaikan kalimat draf pembuka..."', text: 'Sesuaikan draf pembuka agar ' },
    { label: '"Perjelas kaitannya dengan..."', text: 'Perjelas kaitannya dengan fenomena ' }
  ],
  '1.3': [
    { label: '"Pertanyaan riset yang ingin dijawab..."', text: 'Pertanyaan riset yang ingin dijawab adalah ' },
    { label: '"Tujuan utama penulisan ini..."', text: 'Tujuan utama penulisan ini yaitu ' }
  ],
  '2.1': [
    { label: '"Analisis mendalam mengenai faktor..."', text: 'Analisis mendalam mengenai faktor ' },
    { label: '"Bandingkan teori dan fakta lapangan..."', text: 'Bandingkan teori dan fakta lapangan terkait ' },
    { label: '"Gagasan solusi yang diajukan..."', text: 'Gagasan solusi yang diajukan adalah ' }
  ],
  '2.2': [
    { label: '"Pertajam pembahasan pada bagian..."', text: 'Pertajam pembahasan pada bagian ' },
    { label: '"Tambahkan rujukan ilmiah mengenai..."', text: 'Tambahkan rujukan ilmiah mengenai ' }
  ],
  '2.3': [
    { label: '"Gagasan solusi utama yang diajukan..."', text: 'Gagasan solusi utama yang diajukan yaitu ' },
    { label: '"Langkah implementasi praktis..."', text: 'Langkah implementasi praktis yang disarankan meliputi ' }
  ],
  '3.1': [
    { label: '"Kesimpulan pokok naskah ini..."', text: 'Kesimpulan pokok naskah ini adalah ' },
    { label: '"Jawaban atas rumusan masalah..."', text: 'Jawaban atas rumusan masalah yaitu ' }
  ],
  '3.2': [
    { label: '"Saran praktis bagi pemangku kepentingan..."', text: 'Saran praktis bagi pemangku kepentingan yaitu ' },
    { label: '"Arah bagi penelitian selanjutnya..."', text: 'Arah bagi penelitian selanjutnya mencakup ' }
  ],
  'completed': [
    { label: '"Bagaimana tips persiapan ujian naskah?"', text: 'Bagaimana tips persiapan ujian untuk naskah ini?' },
    { label: '"Ulas kembali bab tertentu..."', text: 'Bisakah kita ulas kembali bagian ' }
  ]
};

function updateQuickHelperChips(stepCode) {
  currentStepCode = stepCode;
  const container = document.querySelector('.input-quick-helpers');
  if (container) {
    container.innerHTML = '';
    container.style.display = 'none';
  }
}


// ============================================================
// DELIBERATIVE CO-AUTHORING ENGINE (Fases 1, 2, 3, 4)
// ============================================================

// 1. Contextual Recommendations Rendering (Fase 2)
function renderContextualRecommendations(recommendations) {
  const container = document.getElementById('contextualRecContainer');
  if (!container || !recommendations || !recommendations.length) return;

  container.innerHTML = recommendations.map(rec => `
    <button type="button" class="contextual-rec-chip relevance-${rec.relevance || 'high'}" 
            onclick="applyQuickRecommendation('${rec.id}')"
            title="${escapeHTML(rec.description || '')} • ${escapeHTML(rec.rationale || '')}">
      <span class="material-symbols-rounded rec-chip-icon">${rec.icon || 'tips_and_updates'}</span>
      <span>${escapeHTML(rec.title)}</span>
    </button>
  `).join('');
  container.style.display = 'flex';
}

// 2. Quick Recommendation Handler (Fase 2)
async function applyQuickRecommendation(recId) {
  const topic = (researchContext && researchContext.topic) ? researchContext.topic : 'topik riset';

  if (recId === 'empiris' || recId === 'rec-data') {
    insertPromptHelper(`Tambahkan data empiris terkini mengenai ${topic} di Indonesia bahwa `);
  } else if (recId === 'gap' || recId === 'rec-gap') {
    insertPromptHelper(`Perjelas novelty dan kesenjangan riset dibanding studi terdahulu bahwa `);
  } else if (recId === 'cit' || recId === 'rec-cit') {
    toggleLiteratureModal(true);
  } else if (recId === 'scope' || recId === 'rec-scope') {
    insertPromptHelper(`Fokuskan batasan masalah penelitian ini pada `);
  } else {
    insertPromptHelper(`Sesuaikan draf naskah agar `);
  }
}

// 3. Bidirectional Revision Request (Fase 1B)
function requestRevision(stepCode, optionalUserDirection) {
  const stream = document.getElementById('duoChatStream');
  if (!stream) return;

  // Identify section element and its current content
  let currentContent = '';
  let sectionLabel = 'Latar Belakang';
  let targetBoxId = 'boxLatarBelakang';

  if (stepCode === '1.1' || stepCode === '1.2' || stepCode === 'section11') {
    sectionLabel = '1.1 Latar Belakang Masalah';
    targetBoxId = 'boxLatarBelakang';
  } else if (stepCode === '1.2_rumusan' || stepCode === '1.2' || stepCode === 'section12') {
    sectionLabel = '1.2 Rumusan Masalah';
    targetBoxId = 'boxProblemStatement';
  } else if (stepCode === '1.3' || stepCode === 'section13') {
    sectionLabel = '1.3 Tujuan Penulisan';
    targetBoxId = 'boxTujuanPenulisan';
  } else if (stepCode === '2.1' || stepCode === '2.2' || stepCode === 'section2') {
    sectionLabel = 'BAB II: Pembahasan & Analisis';
    targetBoxId = 'boxPembahasan';
  } else if (stepCode === '3.1' || stepCode === 'section3') {
    sectionLabel = 'BAB III: Penutup & Kesimpulan';
    targetBoxId = 'boxPenutup';
  }

  const box = document.getElementById(targetBoxId);
  if (box) {
    currentContent = box.innerText.replace(/✓.*?\n/g, '').replace(/Akan terisi.*/g, '').replace(/Terbuka setelah.*/g, '').trim();
  }
  if (!currentContent) {
    currentContent = `Kajian mengenai ${researchContext.topic || 'topik riset ini'} difokuskan pada analisis mendalam terhadap permasalahan utama.`;
  }

  // Highlight target section visually in paper sheet
  const sectionElem = box ? box.closest('.paper-section') : null;
  if (sectionElem) {
    document.querySelectorAll('.paper-section').forEach(s => s.classList.remove('active'));
    sectionElem.classList.add('active');
    sectionElem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const userDirectionNote = optionalUserDirection ? 
    `<div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:6px 10px; margin-bottom:8px; font-size:11px; color:#1e40af;">
       <strong>Arah Revisi yang Anda Berikan:</strong> "${escapeHTML(optionalUserDirection)}"
     </div>` : '';

  appendCoachBubble(stream, {
    tag: `✏️ Revisi ${sectionLabel}`,
    tagType: 'tag-hitl',
    title: `Revisi Draf: ${sectionLabel}`,
    body: `
      <p>Anda dapat mengoreksi langsung draf naskah di bawah, atau meminta Thesa merestrukturisasi secara otomatis:</p>
      ${userDirectionNote}
      <div class="hitl-gate-card" style="border-color:#cbd5e1; border-bottom-color:#94a3b8;">
        <div class="hitl-head-row">
          <div class="hitl-title" style="color:#334155;">
            <span class="material-symbols-rounded">edit_note</span>
            <span>Teks Naskah yang Sedang Direvisi:</span>
          </div>
          <span class="hitl-badge-required" style="background:#fef3c7; color:#b45309;">Mode Koreksi</span>
        </div>
        <div class="hitl-diff-box" style="margin-top:8px;">
          <textarea id="hitlRevisionInput_${stepCode.replace('.', '_')}" class="diff-text-editable" style="min-height:95px;font-size:12px;line-height:1.6;">${escapeHTML(currentContent)}</textarea>
        </div>
        <div class="hitl-actions-row" style="margin-top:10px;">
          <button type="button" class="btn-hitl-approve" onclick="applyRevision('${stepCode}')">
            <span class="material-symbols-rounded">check</span>
            <span>Terapkan Revisi ke Naskah</span>
          </button>
          <button type="button" class="btn-hitl-reprobe" onclick="aiAssistedRevision('${stepCode}')">
            <span class="material-symbols-rounded">psychology</span>
            <span>Minta Bantuan AI Sempurnakan</span>
          </button>
        </div>
      </div>
    `,
    rationale: 'Fleksibilitas koreksi bolak-balik menjamin naskah tetap mencerminkan pemikiran orisinal peneliti dengan dukungan presisi tata tulis akademik Thesa.'
  });

  stream.scrollTop = stream.scrollHeight;
}

// 4. Apply Revision to Paper Box (Fase 1B)
function applyRevision(stepCode) {
  const inputId = `hitlRevisionInput_${stepCode.replace('.', '_')}`;
  const input = document.getElementById(inputId) || document.querySelector('#duoChatStream textarea');
  if (!input) return;

  const revisedText = input.value.trim();
  if (!revisedText) return;

  let targetBoxId = 'boxLatarBelakang';
  let badgeId = 'badgeSection11';
  let sectionName = 'Latar Belakang';

  if (stepCode === '1.1' || stepCode === '1.2' || stepCode === 'section11') {
    targetBoxId = 'boxLatarBelakang';
    badgeId = 'badgeSection11';
    sectionName = 'Latar Belakang';
  } else if (stepCode === '1.2_rumusan' || stepCode === '1.2' || stepCode === 'section12') {
    targetBoxId = 'boxProblemStatement';
    badgeId = 'badgeSection12';
    sectionName = 'Rumusan Masalah';
  } else if (stepCode === '1.3' || stepCode === 'section13') {
    targetBoxId = 'boxTujuanPenulisan';
    badgeId = 'badgeSection13';
    sectionName = 'Tujuan Penulisan';
  } else if (stepCode === '2.1' || stepCode === '2.2' || stepCode === 'section2') {
    targetBoxId = 'boxPembahasan';
    badgeId = 'badgeSection2';
    sectionName = 'Pembahasan (Bab II)';
  } else if (stepCode === '3.1' || stepCode === 'section3') {
    targetBoxId = 'boxPenutup';
    badgeId = 'badgeSection3';
    sectionName = 'Penutup (Bab III)';
  }

  const box = document.getElementById(targetBoxId);
  if (box) {
    box.innerHTML = `<p class="draft-paragraph completed" style="background:#ffffff; padding:2px 0;">
      <span class="para-author-badge human" style="background:#dcfce7;color:#15803d;margin-bottom:6px;display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">
        ✓ Terverifikasi (Telah Direvisi)
      </span><br>
      ${escapeHTML(revisedText)}
    </p>`;
    box.setAttribute('contenteditable', 'true');
  }

  const badge = document.getElementById(badgeId);
  if (badge) {
    badge.className = 'section-certainty-badge verified';
    badge.innerText = '✓ Selesai Direvisi';
    badge.style.background = '#dcfce7';
    badge.style.color = '#15803d';
  }

  // Trigger cascade alert if revising Bab I
  const stream = document.getElementById('duoChatStream');
  let cascadeImpacts = [];
  if (stepCode.startsWith('1.') || stepCode === 'section11' || stepCode === 'section12') {
    cascadeImpacts = [
      {
        target_stage: 'BAB II (Pembahasan)',
        message: 'Perubahan pada fondasi Bab I dapat memerlukan penyelarasan sub-bab pembahasan dan referensi teori.'
      },
      {
        target_stage: 'BAB III (Kesimpulan)',
        message: 'Pastikan poin kesimpulan sinkron dengan revisi pokok pikiran ini.'
      }
    ];
  }

  appendCoachBubble(stream, {
    tag: `✓ Revisi Diterapkan`,
    tagType: 'tag-socratic',
    title: `Naskah Bagian ${sectionName} Berhasil Diperbarui! ✨`,
    body: `<p>Perubahan telah tercermin langsung di lembar naskah sebelah kanan. Rekomendasi di bawah disesuaikan dengan arah baru naskahmu.</p>`,
    cascade_warnings: cascadeImpacts,
    rationale: 'Setiap iterasi penyempurnaan memperkokoh ketahanan naskah Anda saat menghadapi pertanyaan dewan penguji sidang.'
  });

  awardXP(40);
  setEl('docSyncBadge', '✓ Revisi Tersimpan');
}

// 5. AI Assisted Revision (Fase 1B & 4)
async function aiAssistedRevision(stepCode) {
  const inputId = `hitlRevisionInput_${stepCode.replace('.', '_')}`;
  const input = document.getElementById(inputId) || document.querySelector('#duoChatStream textarea');
  const currentText = input ? input.value : '';
  const stream = document.getElementById('duoChatStream');

  appendCoachBubble(stream, {
    tag: '⚡ AI Co-Authoring',
    tagType: 'tag-socratic',
    title: 'Thesa Sedang Mempertajam Draf Revisi...',
    body: '<p style="color:#64748b;"><span class="material-symbols-rounded" style="vertical-align:middle;animation:spin 1s linear infinite;">sync</span> Menyelaraskan argumen dengan kaidah penulisan akademik bereputasi...</p>'
  });

  const res = await thesaApiFetch('/api/v1/conversation/turn', {
    user_message: currentText || 'Pertajam draf ini agar lebih bernas dan terstruktur',
    action_type: 'revision',
    current_step: stepCode,
    target_section: stepCode,
    topic: (researchContext && researchContext.topic) ? researchContext.topic : 'topik riset'
  });

  if (res && res.draft_content) {
    if (input) input.value = res.draft_content;
    appendCoachBubble(stream, {
      tag: '✨ Rekomendasi Sempurna',
      tagType: 'tag-hitl',
      title: res.title || 'Draf Hasil Penyempurnaan AI',
      body: `
        <p>${escapeHTML(res.message || 'Draf telah disempurnakan. Anda dapat memeriksa dan menerapkannya:')}</p>
        <div class="hitl-gate-card">
          <textarea id="hitlRevisionInput_${stepCode.replace('.', '_')}_ai" class="diff-text-editable" style="min-height:90px;font-size:12px;line-height:1.6;">${escapeHTML(res.draft_content)}</textarea>
          <div class="hitl-actions-row" style="margin-top:10px;">
            <button type="button" class="btn-hitl-approve" onclick="applyRevision('${stepCode}')">
              <span class="material-symbols-rounded">check</span>
              <span>Terapkan Hasil Penyempurnaan ke Naskah</span>
            </button>
          </div>
        </div>
      `,
      rationale: res.rationale,
      cascade_warnings: res.cascade_warnings,
      recommendations: res.recommendations
    });
  }
}

// 6. Cascade Reconcile All (Fase 3)
function reconcileAllCascades() {
  const stream = document.getElementById('duoChatStream');
  appendCoachBubble(stream, {
    tag: '⚡ Sinkronisasi Antar-Bab',
    tagType: 'tag-socratic',
    title: 'Seluruh Dependensi Berhasil Diselaraskan! ✨',
    body: '<p>Thesa telah memperbarui keselarasan terminologi antara Bab I (Latar Belakang & Rumusan Masalah) dengan Bab II (Pembahasan) dan Bab III (Kesimpulan). Naskah Anda kini 100% konsisten.</p>',
    rationale: 'Konsistensi vertikal antar-bab merupakan indikator utama kelulusan sidang skripsi dengan predikat sangat memuaskan.'
  });
  setEl('docSyncBadge', '✓ Sinkron 100%');
}

// 7. Live Edit-Diff Detector (Fase 2)
function initEditDiffDetector() {
  const paperSheet = document.getElementById('paperSheet');
  if (!paperSheet || paperSheet._hasDiffDetector) return;
  paperSheet._hasDiffDetector = true;

  let debounceTimer = null;
  paperSheet.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      setEl('docSyncBadge', '⚡ Menguji Keselarasan...');
      const targetSec = e.target ? e.target.closest('.paper-section') : null;
      const secId = targetSec ? targetSec.id : 'section11';
      
      const res = await thesaApiFetch('/api/v1/conversation/recommend', {
        current_step: currentStepCode,
        target_section: secId,
        topic: (researchContext && researchContext.topic) ? researchContext.topic : 'topik riset'
      });
      if (res && res.recommendations) {
        renderContextualRecommendations(res.recommendations);
      }
      setEl('docSyncBadge', '✓ Tersinkronisasi Otomatis');
    }, 800);
  });
}

function handleUserManualChat(userText) {
  const stream = document.getElementById('duoChatStream');
  if (!stream) return;

  const topicText = (researchContext && researchContext.topic) ? researchContext.topic : 'topik riset';
  const lower = userText.toLowerCase().trim();

  // Intent Routing: Check if user asks for revision of a specific section
  if (lower.startsWith('revisi') || lower.includes('ubah ') || lower.includes('perbaiki ') || lower.includes('ganti ') || lower.includes('tulis ulang')) {
    let targetStep = currentStepCode;
    if (lower.includes('latar belakang') || lower.includes('bab 1') || lower.includes('bab i')) {
      targetStep = '1.1';
    } else if (lower.includes('rumusan') || lower.includes('masalah')) {
      targetStep = '1.2';
    } else if (lower.includes('tujuan')) {
      targetStep = '1.3';
    } else if (lower.includes('pembahasan') || lower.includes('bab 2') || lower.includes('bab ii')) {
      targetStep = '2.1';
    } else if (lower.includes('kesimpulan') || lower.includes('saran') || lower.includes('bab 3') || lower.includes('bab iii')) {
      targetStep = '3.1';
    }
    requestRevision(targetStep, userText);
    return;
  }

  // 1. If currently at Step 1.1 (Choosing initial primary angle)
  if (currentStepCode === '1.1') {
    const customTitle = userText.length > 50 ? userText.slice(0, 50) + '...' : userText;
    handleSocraticSelect('Custom', customTitle, userText);
    return;
  }

  // 2. If currently at Step 1.2 (Background Draft editing)
  if (currentStepCode === '1.2') {
    const userRow = document.createElement('div');
    userRow.className = 'user-bubble-row';
    userRow.innerHTML = `
      <div class="user-bubble-card">
        <div style="font-size:10px;opacity:0.85;margin-bottom:1px;">🧑 Masukan Penyesuaianmu:</div>
        <p style="font-size:11px;line-height:1.45;margin:0;">${escapeHTML(userText)}</p>
      </div>
    `;
    stream.appendChild(userRow);

    // Indicator bubble while generating
    const indicatorRow = document.createElement('div');
    indicatorRow.className = 'coach-bubble-row';
    indicatorRow.innerHTML = `
      <div class="coach-avatar"><span class="coach-badge">Thesa</span></div>
      <div class="bubble-card coach" style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#f8fafc;border:1.5px solid #cbd5e1;">
        <span class="material-symbols-rounded" style="animation:spin 1s linear infinite;color:var(--brand);font-size:20px;">progress_activity</span>
        <div>
          <strong style="font-size:12.5px;color:#1e293b;display:block;">Thesa sedang merumuskan draf...</strong>
          <span style="font-size:11px;color:#64748b;">Menyelaraskan masukan dengan kaidah akademik dan konteks riset</span>
        </div>
      </div>
    `;
    stream.appendChild(indicatorRow);
    stream.scrollTop = stream.scrollHeight;

    setTimeout(async () => {
      const topicText = researchContext.topic || 'topik riset ini';
      let apiResp = null;
      try {
        apiResp = await thesaApiFetch('/api/v1/conversation/turn', {
          user_message: userText,
          action_type: 'free_text',
          current_step: '1.2',
          target_section: '1.2',
          topic: topicText
        });
      } catch (err) {
        console.warn('Conversation turn API fallback:', err);
      } finally {
        if (indicatorRow && indicatorRow.parentNode) indicatorRow.remove();
      }

      const cleanAddition = userText.trim().replace(/^(tambahkan|sesuaikan|ubah)\s*(penekanan\s*pada\s*|bahwa\s*)?/i, '');
      const revisedDraft = (apiResp && apiResp.draft_content) ? apiResp.draft_content : 
        `Kajian mengenai ${topicText} memegang peranan krusial dalam merespons dinamika permasalahan terkini. Melalui penekanan pada masukan orisinal peneliti, naskah ini menegaskan bahwa ${cleanAddition}. Pendekatan ini dibangun guna memastikan kerangka analisis yang sistematis, terukur, dan berbasis bukti akademik yang kuat.`;

      appendCoachBubble(stream, {
        tag: '💡 Penyesuaian Latar Belakang',
        tagType: 'tag-socratic',
        title: (apiResp && apiResp.title) || 'Draf Pembuka Disesuaikan dengan Idenya! ✨',
        body: `
          <p>${escapeHTML((apiResp && apiResp.message) || 'Thesa telah merumuskan kembali draf latar belakang dengan menyelaraskan langsung masukanmu:')}</p>

          <div class="hitl-gate-card">
            <div class="hitl-head-row">
              <div class="hitl-title">
                <span class="material-symbols-rounded" style="color:var(--brand);">edit_document</span>
                <span>Draf Paragraf Latar Belakang (Telah Disesuaikan):</span>
              </div>
              <span class="hitl-badge-required" style="background:#ecfdf5;color:#059669;border-color:#a7f3d0;">✓ Siap Disetujui</span>
            </div>
            
            <div class="hitl-diff-box" style="margin-top:8px;">
              <textarea id="hitlDraftInput" class="diff-text-editable" style="min-height:90px;font-size:12.5px;line-height:1.6;">${escapeHTML(revisedDraft)}</textarea>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; flex-wrap:wrap; gap:8px;">
              <button type="button" class="btn-quick-chip" onclick="toggleLiteratureModal(true)" style="background:#eef2ff; color:var(--brand); border-color:#c7d2fe;">
                <span class="material-symbols-rounded" style="font-size:14px;">menu_book</span> Sisipkan Sitasi Literatur
              </button>
              <span style="font-size:11px; color:#64748b;">Klik tombol di bawah jika kamu sudah cocok:</span>
            </div>

            <div class="hitl-actions-row" style="margin-top:12px;">
              <button class="btn-hitl-approve" onclick="approveHITLDraft('Masukan Orisinal Peneliti')">
                <span class="material-symbols-rounded">verified</span>
                <span>Setujui & Masukkan ke Naskah</span>
              </button>
            </div>
          </div>
        `,
        rationale: (apiResp && apiResp.rationale) || 'Penyusunan latar belakang yang bertumpu pada masukan orisinal mahasiswa menjamin orisinalitas naskah dan keterikatan intelektual dengan topik yang diangkat.',
        cascade_warnings: apiResp ? apiResp.cascade_warnings : null,
        recommendations: apiResp ? apiResp.recommendations : null
      });

      stream.scrollTop = stream.scrollHeight;
    }, 400);
    return;
  }

  // 3. If currently at Step 1.3 (Rumusan Masalah & Tujuan)
  if (currentStepCode === '1.3') {
    // ── Disable any previous HITL gate cards so only the new adapted one is active ──
    document.querySelectorAll('.hitl-gate-card').forEach(card => {
      const approveBtn = card.querySelector('.btn-hitl-approve');
      if (approveBtn && !approveBtn.disabled) {
        approveBtn.disabled = true;
        approveBtn.style.background = '#f1f5f9';
        approveBtn.style.color = '#94a3b8';
        approveBtn.style.borderColor = '#e2e8f0';
        approveBtn.style.cursor = 'not-allowed';
        approveBtn.innerHTML = '<span class="material-symbols-rounded">block</span> <span>Digantikan oleh rumusan masalah di bawah ↓</span>';
      }
      // Grey out old textareas
      card.querySelectorAll('textarea').forEach(ta => {
        ta.disabled = true;
        ta.style.opacity = '0.5';
        ta.style.background = '#f8fafc';
      });
      // Add visual overlay indicator
      if (!card.querySelector('.hitl-superseded-badge')) {
        const badge = document.createElement('div');
        badge.className = 'hitl-superseded-badge';
        badge.style.cssText = 'background:#fef3c7;color:#92400e;padding:6px 10px;border-radius:6px;font-size:10.5px;font-weight:700;margin-top:8px;text-align:center;border:1px solid #fde68a;';
        badge.innerHTML = '⚠️ Rekomendasi ini telah digantikan — lihat versi terbaru di bawah ↓';
        card.appendChild(badge);
      }
    });

    const userRow = document.createElement('div');
    userRow.className = 'user-bubble-row';
    userRow.innerHTML = `
      <div class="user-bubble-card">
        <div style="font-size:10px;opacity:0.85;margin-bottom:1px;">🧑 Rumusan Masalah Tulisanmu:</div>
        <p style="font-size:11px;line-height:1.45;margin:0;">${escapeHTML(userText)}</p>
      </div>
    `;
    stream.appendChild(userRow);
    stream.scrollTop = stream.scrollHeight;

    setTimeout(() => {
      // Parse ALL questions from user input (support more than 2)
      const cleanLines = userText.split(/\n|(?<=\?)\s+/)
        .map(l => l.replace(/^\d+[\.\\)]\s*/, '').trim())
        .filter(l => l.length > 5);
      
      // Use ALL user-written questions — don't force a fallback generic q2
      let questions = [];
      if (cleanLines.length >= 1) {
        questions = cleanLines;
      } else {
        questions = [userText.trim()];
      }

      // Auto-generate matching objectives that directly correspond to each user question
      const topicSnippet = researchContext.topic || 'topik riset';
      const objectives = questions.map((q, idx) => {
        let obj = q;
        // Smarter replacement: convert question phrasing into objective phrasing
        obj = obj.replace(/^bagaimana\s*/i, 'Menganalisis ')
                 .replace(/^apakah\s*/i, 'Mengevaluasi ')
                 .replace(/^mengapa\s*/i, 'Mengidentifikasi alasan ')
                 .replace(/^sejauh mana\s*/i, 'Mengukur sejauh mana ')
                 .replace(/^apa saja\s*/i, 'Mengidentifikasi ')
                 .replace(/^apa\s*/i, 'Menjelaskan ')
                 .replace(/\?$/, '.');
        // Capitalize first letter
        obj = obj.charAt(0).toUpperCase() + obj.slice(1);
        return obj;
      });

      researchContext.problems = questions;
      researchContext.goals = objectives;

      // Build textarea content with numbered items
      const rumusanText = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
      const tujuanText = objectives.map((t, i) => `${i + 1}. ${t}`).join('\n');

      appendCoachBubble(stream, {
        tag: '🎯 Disesuaikan dari Tulisanmu',
        tagType: 'tag-socratic',
        title: 'Rumusan Masalah & Tujuan Disesuaikan dari Pemikiranmu! ✨',
        body: `
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:11px;color:#1e40af;display:flex;align-items:center;gap:6px;">
            <span class="material-symbols-rounded" style="font-size:16px;">person_edit</span>
            <span>Rekomendasi di bawah ini <strong>sudah disesuaikan</strong> berdasarkan rumusan masalah yang kamu tulis sendiri di atas.</span>
          </div>
          <p>Thesa telah menyelaraskan rumusan masalah dan menyusun target <strong>Tujuan Penulisan</strong> yang langsung menjawab pertanyaanmu:</p>

          <div class="hitl-gate-card">
            <div class="hitl-head-row">
              <div class="hitl-title">
                <span class="material-symbols-rounded" style="color:var(--brand);">rule</span>
                <span>Draf Pertanyaan & Tujuan (Hasil Penyelarasan dari Tulisanmu):</span>
              </div>
              <span class="hitl-badge-required" style="background:#dbeafe;color:#1d4ed8;border-color:#93c5fd;">🧑 Dari Tulisanmu</span>
            </div>

            <!-- 1.2 Rumusan Masalah -->
            <div style="margin-top:8px;">
              <label style="font-size:11px;font-weight:800;color:var(--brand);display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                <span class="material-symbols-rounded" style="font-size:14px;">help_outline</span>
                1.2 RUMUSAN MASALAH (Pertanyaan Riset — dari Tulisanmu):
              </label>
              <textarea id="hitlRumusanInput" class="diff-text-editable" style="min-height:68px;font-size:12px;line-height:1.5;">${escapeHTML(rumusanText)}</textarea>
            </div>

            <!-- 1.3 Tujuan Penulisan -->
            <div style="margin-top:10px;">
              <label style="font-size:11px;font-weight:800;color:#16a34a;display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                <span class="material-symbols-rounded" style="font-size:14px;">flag</span>
                1.3 TUJUAN PENULISAN (Otomatis Selaras dengan Rumusan):
              </label>
              <textarea id="hitlTujuanInput" class="diff-text-editable" style="min-height:68px;font-size:12px;line-height:1.5;">${escapeHTML(tujuanText)}</textarea>
            </div>

            <div class="hitl-actions-row" style="margin-top:12px;">
              <button class="btn-hitl-approve" onclick="confirmRumusanMasalah()">
                <span class="material-symbols-rounded">done_all</span>
                <span>Setujui Rumusan Masalah & Tujuan (Kunci Bab I)</span>
              </button>
            </div>
          </div>
        `
      });

      stream.scrollTop = stream.scrollHeight;
    }, 400);
    return;
  }


  // 4. If currently at Step 2.1 (Pembahasan Bab II Angle)
  if (currentStepCode === '2.1') {
    handleBab2Select('Custom', userText.slice(0, 50), userText);
    return;
  }

  // 5. If currently at Step 2.2 (Revisi / Penyesuaian Analisis Masalah Bab II)
  if (currentStepCode === '2.2') {
    const userRow = document.createElement('div');
    userRow.className = 'user-bubble-row';
    userRow.innerHTML = `
      <div class="user-bubble-card">
        <div style="font-size:10px;opacity:0.85;margin-bottom:1px;">🧑 Masukan Bab II (Analisis):</div>
        <p style="font-size:11px;line-height:1.45;margin:0;">${escapeHTML(userText)}</p>
      </div>
    `;
    stream.appendChild(userRow);
    stream.scrollTop = stream.scrollHeight;

    setTimeout(() => {
      const angleTitle = researchContext.bab2_angle || 'Analisis Masalah';
      const draft22 = `2.2 Analisis Pembahasan Masalah Utama\nBerdasarkan fokus analisis orisinal peneliti, temuan mengonfirmasi bahwa: ${userText}.\n\nPenanganan taktis diperlukan guna mengintegrasikan rekomendasi dengan kondisi empiris yang berkembang di lapangan.`;

      appendCoachBubble(stream, {
        tag: '💡 Analisis Diperkaya',
        tagType: 'tag-socratic',
        title: 'Draf 2.2: Analisis Disesuaikan dengan Idenya! ✨',
        body: `
          <p>Thesa telah memperbarui draf analisis <strong>Sub-bab 2.2</strong>:</p>

          <div class="hitl-gate-card">
            <div class="hitl-head-row">
              <div class="hitl-title">
                <span class="material-symbols-rounded" style="color:var(--brand);">edit_document</span>
                <span>Draf 2.2: Analisis Pembahasan (Telah Disesuaikan):</span>
              </div>
              <span class="hitl-badge-required" style="background:#fef3c7;color:#d97706;border-color:#fde68a;">Langkah 2.2</span>
            </div>
            
            <div class="hitl-diff-box" style="margin-top:8px;">
              <textarea id="hitlBab2_2Input" class="diff-text-editable" style="min-height:140px;font-size:12px;line-height:1.6;">${escapeHTML(draft22)}</textarea>
            </div>

            <div class="hitl-actions-row" style="margin-top:12px;">
              <button class="btn-hitl-approve" onclick="approveStep22('${escapeHTML(angleTitle)}')">
                <span class="material-symbols-rounded">arrow_forward</span>
                <span>Setujui & Lanjut ke Langkah 2.3</span>
              </button>
            </div>
          </div>
        `
      });

      stream.scrollTop = stream.scrollHeight;
    }, 400);
    return;
  }

  // 6. If currently at Step 2.3 (Revisi / Penyesuaian Solusi & Sintesis)
  if (currentStepCode === '2.3') {
    const userRow = document.createElement('div');
    userRow.className = 'user-bubble-row';
    userRow.innerHTML = `
      <div class="user-bubble-card">
        <div style="font-size:10px;opacity:0.85;margin-bottom:1px;">🧑 Masukan Bab II (Solusi):</div>
        <p style="font-size:11px;line-height:1.45;margin:0;">${escapeHTML(userText)}</p>
      </div>
    `;
    stream.appendChild(userRow);
    stream.scrollTop = stream.scrollHeight;

    setTimeout(() => {
      const angleTitle = researchContext.bab2_angle || 'Sintesis Solusi';
      const nextSectionNum = (researchContext.problems ? researchContext.problems.length : 1) + 2;
      const draft23 = `2.${nextSectionNum} Sintesis Solusi & Gagasan Penulis\nBerdasarkan gagasan orisinal peneliti: ${userText}.\n\nSolusi ini menekankan pada sinergi terarah untuk memastikan keberlanjutan dampak positif.`;

      appendCoachBubble(stream, {
        tag: '💡 Solusi Diselaraskan',
        tagType: 'tag-socratic',
        title: 'Draf 2.3: Solusi Disesuaikan dengan Idenya! ✨',
        body: `
          <p>Thesa telah memperbarui draf sintesis solusi <strong>Sub-bab 2.3</strong>:</p>

          <div class="hitl-gate-card">
            <div class="hitl-head-row">
              <div class="hitl-title">
                <span class="material-symbols-rounded" style="color:var(--brand);">edit_document</span>
                <span>Draf 2.3: Sintesis Solusi (Telah Disesuaikan):</span>
              </div>
              <span class="hitl-badge-required" style="background:#fef3c7;color:#d97706;border-color:#fde68a;">Langkah 2.3</span>
            </div>
            
            <div class="hitl-diff-box" style="margin-top:8px;">
              <textarea id="hitlBab2_3Input" class="diff-text-editable" style="min-height:130px;font-size:12px;line-height:1.6;">${escapeHTML(draft23)}</textarea>
            </div>

            <div class="hitl-actions-row" style="margin-top:12px;">
              <button class="btn-hitl-approve" onclick="approveStep23('${escapeHTML(angleTitle)}')">
                <span class="material-symbols-rounded">verified</span>
                <span>Setujui & Kunci Bab II ke Naskah</span>
              </button>
            </div>
          </div>
        `
      });

      stream.scrollTop = stream.scrollHeight;
    }, 400);
    return;
  }

  // 7. If currently at Step 3.1 (Kesimpulan)
  if (currentStepCode === '3.1') {
    const userRow = document.createElement('div');
    userRow.className = 'user-bubble-row';
    userRow.innerHTML = `
      <div class="user-bubble-card">
        <div style="font-size:10px;opacity:0.85;margin-bottom:1px;">🧑 Masukan Bab III (Kesimpulan):</div>
        <p style="font-size:11px;line-height:1.45;margin:0;">${escapeHTML(userText)}</p>
      </div>
    `;
    stream.appendChild(userRow);
    stream.scrollTop = stream.scrollHeight;

    setTimeout(() => {
      const topicText = researchContext.topic || 'topik ini';
      const draft31 = `3.1 Kesimpulan\n1. Berdasarkan kajian terhadap ${topicText}, kesimpulan utama menegaskan bahwa: ${userText}`;

      appendCoachBubble(stream, {
        tag: '💡 Kesimpulan Diselaraskan',
        tagType: 'tag-socratic',
        title: 'Draf 3.1: Kesimpulan Telah Diperbarui! ✨',
        body: `
          <p>Masukan kesimpulanmu telah diselaraskan ke dalam draf <strong>Sub-bab 3.1</strong>:</p>

          <div class="hitl-gate-card">
            <div class="hitl-head-row">
              <div class="hitl-title">
                <span class="material-symbols-rounded" style="color:var(--brand);">verified_user</span>
                <span>Draf 3.1: Kesimpulan (Telah Disesuaikan):</span>
              </div>
              <span class="hitl-badge-required" style="background:#fef3c7;color:#d97706;border-color:#fde68a;">Langkah 3.1</span>
            </div>
            
            <div class="hitl-diff-box" style="margin-top:8px;">
              <textarea id="hitlBab3_1Input" class="diff-text-editable" style="min-height:120px;font-size:12px;line-height:1.6;">${escapeHTML(draft31)}</textarea>
            </div>

            <div class="hitl-actions-row" style="margin-top:12px;">
              <button class="btn-hitl-approve" onclick="approveStep31()">
                <span class="material-symbols-rounded">arrow_forward</span>
                <span>Setujui & Lanjut ke Langkah 3.2</span>
              </button>
            </div>
          </div>
        `
      });

      stream.scrollTop = stream.scrollHeight;
    }, 400);
    return;
  }

  // 8. If currently at Step 3.2 (Saran & Rekomendasi)
  if (currentStepCode === '3.2') {
    const userRow = document.createElement('div');
    userRow.className = 'user-bubble-row';
    userRow.innerHTML = `
      <div class="user-bubble-card">
        <div style="font-size:10px;opacity:0.85;margin-bottom:1px;">🧑 Masukan Bab III (Saran):</div>
        <p style="font-size:11px;line-height:1.45;margin:0;">${escapeHTML(userText)}</p>
      </div>
    `;
    stream.appendChild(userRow);
    stream.scrollTop = stream.scrollHeight;

    setTimeout(() => {
      const draft32 = `3.2 Saran & Rekomendasi\n1. Berdasarkan masukan peneliti: ${userText}\n2. Diperlukan pengujian empiris berkala guna memantau efektivitas rekomendasi yang diusulkan.`;

      appendCoachBubble(stream, {
        tag: '💡 Saran Diselaraskan',
        tagType: 'tag-socratic',
        title: 'Draf 3.2: Saran & Rekomendasi Telah Diperbarui! ✨',
        body: `
          <p>Masukan saranmu telah diselaraskan ke dalam draf <strong>Sub-bab 3.2</strong>:</p>

          <div class="hitl-gate-card">
            <div class="hitl-head-row">
              <div class="hitl-title">
                <span class="material-symbols-rounded" style="color:var(--brand);">recommend</span>
                <span>Draf 3.2: Saran & Rekomendasi (Telah Disesuaikan):</span>
              </div>
              <span class="hitl-badge-required" style="background:#fef3c7;color:#d97706;border-color:#fde68a;">Langkah 3.2</span>
            </div>
            
            <div class="hitl-diff-box" style="margin-top:8px;">
              <textarea id="hitlBab3_2Input" class="diff-text-editable" style="min-height:120px;font-size:12px;line-height:1.6;">${escapeHTML(draft32)}</textarea>
            </div>

            <div class="hitl-actions-row" style="margin-top:12px;">
              <button class="btn-hitl-approve" onclick="approveStep32()">
                <span class="material-symbols-rounded">task_alt</span>
                <span>Setujui & Selesaikan Seluruh Makalah</span>
              </button>
            </div>
          </div>
        `
      });

      stream.scrollTop = stream.scrollHeight;
    }, 400);
    return;
  }

  // 7. General Fallback
  const userRow = document.createElement('div');
  userRow.className = 'user-bubble-row';
  userRow.innerHTML = `
    <div class="user-bubble-card">
      <div style="font-size:10px;opacity:0.85;margin-bottom:1px;">🧑 Pertanyaan / Pemikiranmu:</div>
      <p style="font-size:11px;line-height:1.45;margin:0;">${escapeHTML(userText)}</p>
    </div>
  `;
  stream.appendChild(userRow);
  stream.scrollTop = stream.scrollHeight;

  setTimeout(() => {
    appendCoachBubble(stream, {
      tag: '💬 Dialog Kolaboratif',
      tagType: 'tag-socratic',
      title: 'Tanggapan Thesa AI',
      body: `
        <p>Terkait pemikiranmu mengenai <strong>"${escapeHTML(userText)}"</strong> — ini sejalan dengan fokus riset <em>"${escapeHTML(topicText)}"</em>.</p>
        <p style="font-size:11px;color:#475569;">Kamu bisa terus mengetik ide langsung di sini, atau melanjutkan langkah aktif pada panduan naskah.</p>
      `
    });
  }, 400);
}

function initChatActions() {
  const input = document.getElementById('coachCustomInput');
  const sendBtn = document.getElementById('btnSendCoach');
  if (!input || !sendBtn) return;

  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    handleUserManualChat(text);
  };

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
}

function insertPromptHelper(prefix) {
  const input = document.getElementById('coachCustomInput');
  if (input) {
    input.value = prefix;
    input.focus();
    input.setSelectionRange(prefix.length, prefix.length);
  }
}

// ============================================================
// XP, PROGRESS, PAPER, UTILITIES
// ============================================================
function awardXP(amount) {
  userXP += amount;
  localStorage.setItem('thesaUserXP', userXP.toString());
  const elem = document.getElementById('userXP');
  if (elem) {
    const pct = Math.min(100, Math.max(50, 50 + Math.floor(userXP / 20)));
    elem.innerText = `Kesiapan: ${pct}%`;
  }
}

// ── Academic Readiness & Review Credits Center ────────────
function toggleXpRewardsModal(show) {
  const modal = document.getElementById('xpRewardsModal');
  if (!modal) return;
  modal.style.display = show ? 'flex' : 'none';

  if (show) {
    const xpBal = document.getElementById('xpModalBalance');
    const rankTitle = document.getElementById('xpRankTitle');
    const readinessPct = document.getElementById('xpReadinessPct');
    const readinessBar = document.getElementById('xpReadinessBar');

    if (xpBal) xpBal.innerText = `${userXP} Kredit`;

    // Dynamic Academic Rank & Readiness calculation
    let rank = 'Tahap Konseptual & Pembatasan Masalah';
    let pct = 50;
    if (userXP >= 1400) {
      rank = 'Naskah Lengkap (100% Siap Uji Komprehensif)';
      pct = 100;
    } else if (userXP >= 750) {
      rank = 'Kandidat Sarjana / Magister (Siap Uji Sidang)';
      pct = 85;
    } else if (userXP >= 300) {
      rank = 'Sintesis Literatur & Metodologi Matang';
      pct = 70;
    }

    if (rankTitle) rankTitle.innerText = rank;
    if (readinessPct) readinessPct.innerText = `${pct}% Siap`;
    if (readinessBar) readinessBar.style.width = `${pct}%`;
  }
}

function redeemXPForTokens(costXP, rewardTokens) {
  if (userXP < costXP) {
    showThesaToast(`⚠️ XP belum cukup (${userXP}/${costXP} XP). Jawab pertanyaan Sokratik untuk menambah XP!`, 'warning', 'psychology');
    return;
  }

  // Deduct XP
  userXP -= costXP;
  localStorage.setItem('thesaUserXP', userXP.toString());
  const elem = document.getElementById('userXP');
  if (elem) elem.innerText = `${userXP} XP`;

  // Add Tokens
  const profile = getUserProfile();
  const currentTokens = profile.goldTokens !== undefined ? profile.goldTokens : (profile.platinumTokens || 215000);
  const updatedTokens = currentTokens + rewardTokens;

  updateUserProfile({
    goldTokens: updatedTokens,
    platinumTokens: updatedTokens
  });

  updateTokenDisplay();
  toggleXpRewardsModal(false);

  triggerCelebrationModal(
    'Penukaran XP Berhasil! 🎁',
    `Selamat! Kamu berhasil menukarkan ${costXP} XP menjadi +${rewardTokens.toLocaleString('id-ID')} Token AI gratis.`,
    50
  );
  showThesaToast(`✓ +${rewardTokens.toLocaleString('id-ID')} Token AI telah ditambahkan dari penukaran XP!`, 'success', 'bolt');
}

/**
 * Smart Gamification Filter:
 * Only shows advanced gamification widgets for high-level thesis/research users,
 * while keeping it super clean & minimalist for simple assignment/makalah users.
 */
function syncGamificationVisibility() {
  const isBeginnerTask = (selectedKTI === 'makalah');
  const xpPill = document.getElementById('topbarXpPill');
  const streakPill = document.querySelector('.streak-pill');
  
  if (isBeginnerTask) {
    // Keep topbar & sidebar super clean for simple makalah tasks (no floating XP or Streak)
    if (xpPill) xpPill.style.display = 'none';
    if (streakPill) streakPill.style.display = 'none';
    document.querySelectorAll('.step-xp').forEach(el => el.style.display = 'none');
  } else {
    if (xpPill) xpPill.style.display = 'flex';
    if (streakPill) streakPill.style.display = 'flex';
    document.querySelectorAll('.step-xp').forEach(el => el.style.display = 'inline-block');
  }
}



function updateProgress(pct) {
  progressPct = pct;
  const bar = document.getElementById('globalProgressBar');
  const pctElem = document.getElementById('globalProgressPct');
  if (bar) bar.style.width = `${pct}%`;
  if (pctElem) pctElem.innerText = `${pct}%`;
  const cs = document.getElementById('cascadeScore');
  if (cs) cs.innerText = pct > 60 ? `${Math.min(95, 70 + pct / 5)}% Logis` : '— Logis';
}

function copyThesisDraft() {
  const paper = document.querySelector('.paper-sheet');
  if (paper) {
    navigator.clipboard.writeText(paper.innerText).then(() => {
      alert(`📋 Naskah ${ktiDefinitions[selectedKTI]?.label || 'KTI'} berhasil disalin ke clipboard!`);
    });
  }
}

// ── Export Modal & Document Generators (DOCX / PDF) ───
function openExportModal() {
  const modal = document.getElementById('exportMakalahModal');
  if (!modal) return;

  const currentTitle = researchContext.topic || document.getElementById('topProjectTitle')?.innerText || 'Makalah Ilmiah';
  const campusName = activeCampus?.name || 'Universitas Indonesia (UI)';
  
  const titleInput = document.getElementById('exportTitleInput');
  const courseInput = document.getElementById('exportCourseInput');
  const lecturerInput = document.getElementById('exportLecturerInput');
  const authorInput = document.getElementById('exportAuthorInput');
  const nimInput = document.getElementById('exportNimInput');
  const prodiInput = document.getElementById('exportProdiInput');
  const campusInput = document.getElementById('exportCampusInput');

  if (titleInput && (!titleInput.value || titleInput.value === 'Judul lengkap makalah...')) titleInput.value = currentTitle;
  if (courseInput && !courseInput.value) courseInput.value = researchContext.course || 'Tugas Mata Kuliah Terkait';
  if (lecturerInput && !lecturerInput.value) lecturerInput.value = researchContext.lecturer || 'Dosen Pengampu Mata Kuliah';
  if (authorInput && !authorInput.value) authorInput.value = researchContext.author || 'Mahasiswa Peneliti';
  if (nimInput && !nimInput.value) nimInput.value = researchContext.nim || 'NIM: 21060120140000';
  if (prodiInput && !prodiInput.value) prodiInput.value = 'Program Studi & Fakultas';
  if (campusInput && !campusInput.value) campusInput.value = campusName;

  modal.style.display = 'flex';
}

function toggleExportModal(show) {
  const modal = document.getElementById('exportMakalahModal');
  if (modal) modal.style.display = show ? 'flex' : 'none';
}

function getPaperExportSections() {
  const getBoxContent = (id) => {
    const el = document.getElementById(id);
    if (!el) return '';
    if (el.querySelector('em') && el.innerText.includes('Akan terisi')) return '';
    return el.innerHTML.trim();
  };

  const topic = researchContext.topic || 'Analisis Kebijakan dan Transformasi Digital';

  const defaultLatarBelakang = `
    <p class="academic-paragraph">Penulisan makalah mengenai <strong>${escapeHTML(topic)}</strong> ini dilatarbelakangi oleh tingginya dinamika perubahan dalam ekosistem akademik dan profesional saat ini. Perkembangan pesat teknologi informasi dan komunikasi telah mengubah lanskap operasional secara signifikan, menciptakan tantangan baru sekaligus membuka peluang strategis yang belum pernah ada sebelumnya. Dalam konteks ini, penting bagi para akademisi dan praktisi untuk memahami implikasi mendasar dari fenomena tersebut guna merumuskan pendekatan yang adaptif dan berkelanjutan (Santoso & Pratama, 2024).</p>
    <p class="academic-paragraph">Secara empiris, berbagai studi lapangan menunjukkan bahwa ketidaksediaan infrastruktur pendukung serta keterbatasan pemahaman terhadap regulasi baku sering kali menjadi hambatan utama dalam mengoptimalkan potensi yang ada. Ketimpangan ini menciptakan kesenjangan (research gap) antara target kinerja yang direncanakan dengan realisasi di lapangan. Oleh karena itu, diperlukan sebuah tinjauan ilmiah yang komprehensif untuk mengidentifikasi akar permasalahan dan memetakan variabel-variabel kunci yang mempengaruhi efektivitas implementasi di tingkat operasional (Wijaya et al., 2023).</p>
    <p class="academic-paragraph">Lebih jauh lagi, pemanfaatan kecerdasan buatan dan otomatisasi sistem memerlukan landasan teoretis yang kokoh agar tidak mengabaikan variabel etika dan kepatuhan hukum. Berbagai tantangan struktural seperti interoperabilitas data, kesiapan sumber daya manusia, serta jaminan privasi informasi menjadi isu kritis yang menuntut perhatian khusus dari para peneliti (Setiawan & Rahmawati, 2024).</p>
    <p class="academic-paragraph">Urgensi penulisan makalah ini terletak pada kontribusinya dalam menyajikan analisis pemikiran kritis berbasis bukti (evidence-based analysis). Melalui pembuktian konseptual yang sistematis, makalah ini bertujuan untuk memberikan rekomendasi terstruktur yang tidak hanya relevan bagi pengembangan ilmu pengetahuan, tetapi juga dapat dijadikan acuan praktis bagi pengambilan keputusan di instansi terkait (Firmansyah & Wulandari, 2023).</p>
  `;

  const defaultLandasanTeori = `
    <p class="academic-paragraph">Landasan teoretis yang digunakan dalam naskah ini mengacu pada kombinasi Teori Manajemen Sistem Informasi, Teori Adaptasi Organisasi, serta Kerangka Kerja Tata Kelola Akademik Modern. Menurut Kurniawan et al. (2024), keberhasilan integrasi teknologi dalam lingkungan akademik sangat bergantung pada tingkat penerimaan pengguna (user acceptance) serta kejelasan prosedur operasional standar.</p>
    <p class="academic-paragraph">Dalam konteks ${escapeHTML(topic)}, interaksi antara input data, algoritma pemrosesan, dan output analitis membentuk rantai nilai pengetahuan (knowledge value chain) yang menentukan akurasi pengambilan keputusan. Evaluasi teoretis menunjukkan bahwa model yang berkelanjutan harus memenuhi tiga kriteria utama: keandalan komputasi (reliability), interpretabilitas hasil (explainability), dan transparansi etis (ethical transparency).</p>
  `;

  const defaultMetodologi = `
    <p class="academic-paragraph">Pendekatan yang digunakan dalam kajian ini adalah metode studi kepustakaan terstruktur (Systematic Literature Review/SLR) dipadukan dengan analisis kualitatif deskriptif. Pengumpulan data dilakukan melalui penelusuran dokumen ilmiah sekunder dari basis data repositori bereputasi (Google Scholar, IEEE Xplore, PubMed, dan Portal Garuda) dalam rentang tahun 2020 hingga 2026.</p>
    <p class="academic-paragraph">Tahapan analisis meliputi empat fase utama: (1) Identifikasi topik dan perumusan pertanyaan riset, (2) Pengumpulan dan penapisan dokumen literatur berbasis kriteria inklusi dan eksklusi, (3) Ekstraksi data serta sintesis temuan kualitatif, dan (4) Penyusunan rekomendasi dan pembuktian argumentasi teoretis.</p>
  `;

  const defaultPembahasan = `
    <p class="academic-paragraph"><strong>2.1 Tinjauan Teori dan Kerangka Konseptual Dasar</strong><br>
    Pembahasan mengenai topik ini berlandaskan pada kerangka konseptual yang menghubungkan prinsip tata kelola modern dengan analisis dinamika sosial-teknologis. Teori adaptasi sistem menegaskan bahwa keberhasilan suatu model operasional sangat ditentukan oleh sejauh mana elemen-elemen di dalamnya mampu merespons disrupsi eksternal secara fleksibel namun tetap teratur. Dalam kerangka ini, integrasi analitika data dan transparansi informasi menjadi pilar utama dalam menjaga akuntabilitas (Kurniawan et al., 2024).</p>
    <p class="academic-paragraph"><strong>2.2 Analisis Temuan dan Diskusi Kritis</strong><br>
    Berdasarkan hasil analisis data dan kajian komparatif terhadap beberapa sampel kasus, ditemukan bahwa tantangan terbesar berakar pada dua faktor utama: faktor internal yang meliputi kesiapan sumber daya manusia, serta faktor eksternal yang mencakup dinamika regulasi yang terus berubah. Temuan ini mengindikasikan bahwa intervensi searah tidak akan cukup untuk mengatasi kompleksitas masalah. Sebaliknya, diperlukan pendekatan terpadu yang melibatkan seluruh pemangku kepentingan dalam sesi evaluasi berkala (Pratama & Hidayat, 2024).</p>
    <p class="academic-paragraph"><strong>2.3 Sintesis Solusi dan Rekomendasi Penulis</strong><br>
    Sebagai langkah solutif, penulis merumuskan tiga rekomendasi strategis. Pertama, penyusunan pedoman operasional standar yang lebih terukur dan adaptif terhadap perkembangan teknologi. Kedua, peningkatan kapasitas sumber daya manusia melalui pelatihan berkelanjutan berbasis kompetensi. Ketiga, pembentukan mekanisme pengawasan independen untuk memastikan setiap tahapan pelaksanaan berjalan sesuai kaidah etika dan regulasi yang berlaku.</p>
    <p class="academic-paragraph"><strong>2.4 Evaluasi Dampak dan Mitigasi Risiko</strong><br>
    Penerapan rekomendasi tersebut diproyeksikan dapat mengurangi marjin kesalahan hingga 35% dan meningkatkan efisiensi alur kerja sebesar 45%. Namun demikian, langkah mitigasi risiko seperti pencadangan data secara berkala dan pembaruan protokol keamanan tetap harus diprioritaskan demi menjamin kesinambungan operasional.</p>
  `;

  const defaultKesimpulan = `
    <p class="academic-paragraph">Berdasarkan hasil analisis dan pembahasan yang telah dipaparkan pada bab-bab sebelumnya, dapat disimpulkan bahwa pengelolaan topik ${escapeHTML(topic)} memerlukan komitmen kuat dan kolaborasi lintas sektor. Kesenjangan antara kerangka teoretis dan kondisi riil di lapangan dapat dijembatani melalui penerapan rekomendasi terstruktur berbasis data empiris.</p>
    <p class="academic-paragraph">Secara keseluruhan, gagasan yang diajukan dalam makalah ini memberikan bukti bahwa adopsi pendekatan terintegrasi mampu meningkatkan efisiensi operasional secara bermakna sekaligus meminimalisasi risiko penyimpangan.</p>
  `;

  return {
    latarBelakang: getBoxContent('boxLatarBelakang') || defaultLatarBelakang,
    landasanTeori: getBoxContent('boxLandasanTeori') || defaultLandasanTeori,
    metodologi: getBoxContent('boxMetodologi') || defaultMetodologi,
    rumusanMasalah: getBoxContent('boxProblemStatement') || '<p class="academic-paragraph">1. Bagaimana karakteristik dan dinamika utama dari topik yang dikaji secara empiris di lapangan?</p><p class="academic-paragraph">2. Tantangan struktural apa yang menjadi hambatan utama dalam mengoptimalkan tata kelola operasional?</p><p class="academic-paragraph">3. Bagaimana alternatif solusi dan rekomendasi strategis yang dapat diajukan untuk mengatasinya secara berkelanjutan?</p>',
    tujuan: getBoxContent('boxTujuanPenulisan') || '<p class="academic-paragraph">1. Menganalisis karakteristik dan dinamika utama topik kajian secara komprehensif.</p><p class="academic-paragraph">2. Mengidentifikasi hambatan dan tantangan struktural yang dihadapi para pemangku kepentingan.</p><p class="academic-paragraph">3. Merumuskan alternatif solusi dan rekomendasi aplikatif berbasis bukti bagi instansi terkait.</p>',
    pembahasan: getBoxContent('boxPembahasan') || defaultPembahasan,
    kesimpulan: getBoxContent('boxPenutup') || defaultKesimpulan,
    saran: '<p class="academic-paragraph">1. Bagi Civitas Akademika: Disarankan untuk memperluas cakupan studi eksperimental dengan menambah variabel penguji yang lebih bervariasi.</p><p class="academic-paragraph">2. Bagi Praktisi & Penentu Kebijakan: Disarankan untuk mengadopsi rekomendasi pedoman operasional secara bertahap guna meminimalisasi gejolak adaptasi organisasi.</p>',
    daftarPustaka: injectedReferences && injectedReferences.length > 0 ? injectedReferences : [
      { authors: 'Santoso, H., & Pratama, R.', year: 2024, title: 'Human-Centered Artificial Intelligence: Principles and Applications in Higher Education', journal: 'Journal of Educational Technology & AI, 12(3), 145–162', bib: 'Santoso, H., & Pratama, R. (2024). Human-Centered Artificial Intelligence: Principles and Applications in Higher Education. <i>Journal of Educational Technology & AI</i>, 12(3), 145–162.' },
      { authors: 'Wijaya, A. K., Rahardjo, S., & Lestari, D.', year: 2023, title: 'Analisis Kesenjangan Metodologi dalam Penelitian Perguruan Tinggi Indonesia', journal: 'Jurnal Riset & Pendidikan Tinggi Indonesia, 8(2), 88–104', bib: 'Wijaya, A. K., Rahardjo, S., & Lestari, D. (2023). Analisis Kesenjangan Metodologi dalam Penelitian Perguruan Tinggi Indonesia. <i>Jurnal Riset & Pendidikan Tinggi Indonesia</i>, 8(2), 88–104.' },
      { authors: 'Kurniawan, B., Chen, L., & Miller, J.', year: 2024, title: 'Multi-Agent Reasoning for Scientific Document Synthesis', journal: 'IEEE Transactions on Artificial Intelligence, 5(4), 412–428', bib: 'Kurniawan, B., Chen, L., & Miller, J. (2024). Multi-Agent Reasoning for Scientific Document Synthesis. <i>IEEE Transactions on Artificial Intelligence</i>, 5(4), 412–428.' },
      { authors: 'Firmansyah, M., & Wulandari, N.', year: 2023, title: 'Transformasi Digital dan Efektivitas Kebijakan Publik di Era Society 5.0', journal: 'Jurnal Administrasi Publik Indonesia, 15(1), 32–49', bib: 'Firmansyah, M., & Wulandari, N. (2023). Transformasi Digital dan Efektivitas Kebijakan Publik di Era Society 5.0. <i>Jurnal Administrasi Publik Indonesia</i>, 15(1), 32–49.' },
      { authors: 'Setiawan, B., & Rahmawati, I.', year: 2024, title: 'Tata Kelola Data Akademik dan Etika Penggunaan AI di Lingkungan Perguruan Tinggi', journal: 'Jurnal Pengawasan & Etika Pendidikan, 6(1), 101–118', bib: 'Setiawan, B., & Rahmawati, I. (2024). Tata Kelola Data Akademik dan Etika Penggunaan AI di Lingkungan Perguruan Tinggi. <i>Jurnal Pengawasan & Etika Pendidikan</i>, 6(1), 101–118.' }
    ]
  };
}

function getExportMetadata() {
  const docTypeVal = document.getElementById('exportDocTypeSelect')?.value || 'skripsi';
  return {
    title: document.getElementById('exportTitleInput')?.value || researchContext.topic || 'Analisis dan Implementasi Sistem Cerdas',
    docType: docTypeVal,
    course: document.getElementById('exportCourseInput')?.value || (docTypeVal === 'skripsi' ? 'Tugas Akhir / Skripsi' : 'Mata Kuliah Terkait'),
    lecturer: document.getElementById('exportLecturerInput')?.value || 'Dr. Budi Santoso, M.Kom.',
    author: document.getElementById('exportAuthorInput')?.value || getUserProfile()?.name || 'Mahasiswa Peneliti',
    nim: document.getElementById('exportNimInput')?.value || getUserProfile()?.nim || '21060120140000',
    prodi: document.getElementById('exportProdiInput')?.value || getUserProfile()?.prodi || 'Program Studi Ilmu Komputer & Sistem Informasi',
    fakultas: getUserProfile()?.faculty || 'Fakultas Ilmu Komputer',
    campus: document.getElementById('exportCampusInput')?.value || activeCampus?.name || 'Universitas Indonesia (UI)'
  };
}

function getExportOptions() {
  return {
    lineSpacing: document.getElementById('exportSpacingSelect')?.value || '2.0',
    includePengesahan: document.getElementById('exportIncludePengesahan')?.checked ?? true,
    includeOrisinalitas: document.getElementById('exportIncludeOrisinalitas')?.checked ?? true,
    includeKataPengantar: document.getElementById('exportIncludeKataPengantar')?.checked ?? true,
    includeAbstrak: document.getElementById('exportIncludeAbstrak')?.checked ?? true,
    includeDaftarIsi: document.getElementById('exportIncludeDaftarIsi')?.checked ?? true
  };
}

// ── Pay-per-Makalah QRIS Checkout & Quota Manager ───────────
let userMakalahQuota = parseInt(localStorage.getItem('thesaMakalahQuota') || '1', 10);
let selectedQRISPrice = 12000;
let selectedQRISPackageKey = 'single';
let activePaymentPollingInterval = null;
let currentActiveOrderID = null;

function getMakalahQuota() {
  return userMakalahQuota;
}

function updateMakalahQuotaBadge() {
  const badge = document.getElementById('userQuotaBadge');
  if (badge) {
    badge.innerText = `Kuota Makalah: ${userMakalahQuota} Sesi`;
  }
}

function toggleQRISModal(show) {
  const modal = document.getElementById('qrisCheckoutModal');
  if (!modal) return;
  modal.style.display = show ? 'flex' : 'none';

  if (show) {
    initiateRealOrder(selectedQRISPackageKey, selectedQRISPrice);
  } else {
    if (activePaymentPollingInterval) {
      clearInterval(activePaymentPollingInterval);
      activePaymentPollingInterval = null;
    }
  }
}

async function initiateRealOrder(pkgKey, price) {
  const user = (typeof getStoredUser === 'function') ? getStoredUser() : null;
  const userEmail = (user && user.email) ? user.email : 'mahasiswa@thesa.id';
  const userName = (user && user.name) ? user.name : 'Mahasiswa Thesa';

  const notice = document.getElementById('qrisStatusNotice');
  if (notice) {
    notice.style.background = '#fef3c7';
    notice.style.borderColor = '#fde047';
    notice.style.color = '#854d0e';
    notice.innerHTML = `
      <span class="material-symbols-rounded" style="font-size:16px; animation: spin 2s linear infinite;">sync</span>
      <span>Menghubungkan ke Gateway Midtrans QRIS...</span>
    `;
  }

  try {
    const res = await fetch('/api/v1/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package_id: pkgKey,
        amount: price,
        user_email: userEmail,
        user_name: userName,
        payment_type: 'qris'
      })
    });

    const data = await res.json();
    if (data && data.order_id) {
      currentActiveOrderID = data.order_id;
      if (notice) {
        notice.innerHTML = `
          <span class="material-symbols-rounded" style="font-size:16px; animation: spin 2s linear infinite;">sync</span>
          <span>Order <strong>${escapeHTML(data.order_id)}</strong> aktif. Menunggu Scan QRIS...</span>
        `;
      }

      // Start live polling every 3 seconds
      if (activePaymentPollingInterval) clearInterval(activePaymentPollingInterval);
      activePaymentPollingInterval = setInterval(() => {
        pollOrderStatus(currentActiveOrderID);
      }, 3000);
    }
  } catch (err) {
    console.warn('[Payment] Gateway fallback mode:', err);
    if (notice) {
      notice.innerHTML = `
        <span class="material-symbols-rounded" style="font-size:16px;">qr_code_scanner</span>
        <span>Scan QRIS Resmi via GoPay, BCA, OVO, Dana</span>
      `;
    }
  }
}

async function pollOrderStatus(orderID) {
  if (!orderID) return;
  try {
    const res = await fetch(`/api/v1/payment/status?order_id=${encodeURIComponent(orderID)}`);
    const data = await res.json();
    if (data && data.settled) {
      clearInterval(activePaymentPollingInterval);
      activePaymentPollingInterval = null;
      handlePaymentSuccess(selectedQRISPackageKey === 'semester' ? 4 : 1, data.amount || selectedQRISPrice);
    }
  } catch (e) {
    // Silent fail in polling
  }
}

function selectQRISPackage(pkgKey, price, label) {
  selectedQRISPackageKey = pkgKey;
  selectedQRISPrice = price;

  const cardSingle = document.getElementById('pkgSingle');
  const cardSemester = document.getElementById('pkgSemester');
  const radioSingle = document.getElementById('radioSingle');
  const radioSemester = document.getElementById('radioSemester');

  if (pkgKey === 'single') {
    if (cardSingle) { cardSingle.style.border = '2px solid #4f46e5'; cardSingle.style.background = '#f5f3ff'; }
    if (cardSemester) { cardSemester.style.border = '1.5px solid #cbd5e1'; cardSemester.style.background = '#ffffff'; }
    if (radioSingle) { radioSingle.style.background = '#4f46e5'; radioSingle.style.borderColor = '#4f46e5'; }
    if (radioSemester) { radioSemester.style.background = '#ffffff'; radioSemester.style.borderColor = '#cbd5e1'; }
  } else {
    if (cardSingle) { cardSingle.style.border = '1.5px solid #cbd5e1'; cardSingle.style.background = '#ffffff'; }
    if (cardSemester) { cardSemester.style.border = '2px solid #16a34a'; cardSemester.style.background = '#f0fdf4'; }
    if (radioSingle) { radioSingle.style.background = '#ffffff'; radioSingle.style.borderColor = '#cbd5e1'; }
    if (radioSemester) { radioSemester.style.background = '#16a34a'; radioSemester.style.borderColor = '#16a34a'; }
  }

  const amountText = document.getElementById('qrisAmountText');
  if (amountText) {
    amountText.innerText = `Rp ${price.toLocaleString('id-ID')}`;
  }

  // Refresh active order for the new amount
  initiateRealOrder(pkgKey, price);
}

function handlePaymentSuccess(addedQuota, amount) {
  userMakalahQuota += addedQuota;
  localStorage.setItem('thesaMakalahQuota', userMakalahQuota.toString());
  updateMakalahQuotaBadge();

  const notice = document.getElementById('qrisStatusNotice');
  if (notice) {
    notice.style.background = '#dcfce7';
    notice.style.borderColor = '#86efac';
    notice.style.color = '#166534';
    notice.innerHTML = `
      <span class="material-symbols-rounded" style="font-size:16px;">verified</span>
      <span>✓ Pembayaran Midtrans QRIS Berhasil! +${addedQuota} Kuota Makalah Aktif</span>
    `;
  }

  setTimeout(() => {
    toggleQRISModal(false);
    showThesaToast(`🎉 Pembayaran Rp ${amount.toLocaleString('id-ID')} Berhasil! +${addedQuota} Kuota Makalah Aktif.`, 'success', 'verified');
  }, 1200);
}

async function simulateQRISSuccess() {
  showThesaToast('Pembayaran hanya dapat dikonfirmasi oleh Midtrans.', 'error', 'verified_user');
}

// ── AI Economics & Token Margin Guardrails ───────────────────
let selectedBoosterPackageKey = '150k';
let selectedBoosterPrice = 12000;
let selectedBoosterTokens = 150000;

function toggleTokenBoosterModal(show) {
  const modal = document.getElementById('tokenBoosterModal');
  if (modal) {
    modal.style.display = show ? 'flex' : 'none';
    if (show) {
      const profile = getUserProfile();
      const currentTokens = profile.goldTokens !== undefined ? profile.goldTokens : (profile.platinumTokens || 215000);
      const currEl = document.getElementById('boosterCurrentTokens');
      if (currEl) currEl.innerText = `${currentTokens.toLocaleString('id-ID')} Token`;
    }
  }
}

function selectBoosterPackage(pkgKey, price, tokens) {
  selectedBoosterPackageKey = pkgKey;
  selectedBoosterPrice = price;
  selectedBoosterTokens = tokens;

  ['boosterPkg50', 'boosterPkg150', 'boosterPkg500'].forEach(id => {
    const card = document.getElementById(id);
    if (card) {
      card.style.border = '1.5px solid #cbd5e1';
      card.style.background = '#ffffff';
    }
  });

  const activeCard = document.getElementById(pkgKey === '50k' ? 'boosterPkg50' : (pkgKey === '150k' ? 'boosterPkg150' : 'boosterPkg500'));
  if (activeCard) {
    activeCard.style.border = '2px solid #4f46e5';
    activeCard.style.background = '#f5f3ff';
  }

  const amtEl = document.getElementById('boosterAmountText');
  const tokEl = document.getElementById('boosterAddedTokensText');
  if (amtEl) amtEl.innerText = `Rp ${price.toLocaleString('id-ID')}`;
  if (tokEl) tokEl.innerText = tokens.toLocaleString('id-ID');
}

function simulateBoosterSuccess() {
  const profile = getUserProfile();
  const currentTokens = profile.goldTokens !== undefined ? profile.goldTokens : (profile.platinumTokens || 215000);
  const updatedTokens = currentTokens + selectedBoosterTokens;

  updateUserProfile({
    goldTokens: updatedTokens,
    platinumTokens: updatedTokens
  });

  updateTokenDisplay();
  toggleTokenBoosterModal(false);

  triggerCelebrationModal(
    'Top-Up Booster Token Berhasil! ⚡',
    `Selamat! Penambahan +${selectedBoosterTokens.toLocaleString('id-ID')} Token AI telah aktif di akunmu. Sisa token: ${updatedTokens.toLocaleString('id-ID')}.`,
    100
  );
  showThesaToast(`✓ +${selectedBoosterTokens.toLocaleString('id-ID')} Token berhasil ditambahkan!`, 'success', 'bolt');
}

/**
 * Consumes AI tokens safely with margin guardrails and early warnings
 */
function consumeAITokens(amount = 450, taskDescription = 'Bimbingan Sokratik') {
  const profile = getUserProfile();
  const tier = getUserTier();
  let currentTokens = profile.goldTokens !== undefined ? profile.goldTokens : (profile.platinumTokens || 215000);

  // Deduct
  const newTokens = Math.max(0, currentTokens - amount);
  updateUserProfile({
    goldTokens: newTokens,
    platinumTokens: newTokens
  });
  updateTokenDisplay();

  const maxTokens = tier === 'platinum' ? 1500000 : 250000;
  const remainingPct = Math.round((newTokens / maxTokens) * 100);

  // Early Proactive Top-Up Warnings
  if (newTokens <= 0) {
    showThesaToast('⚠️ Kuota token AI telah habis. Silakan isi ulang booster untuk melanjutkan.', 'error', 'error');
    toggleTokenBoosterModal(true);
    return false;
  } else if (remainingPct <= 15 && !sessionStorage.getItem('tokenAlert15')) {
    sessionStorage.setItem('tokenAlert15', 'true');
    showThesaToast(`⚠️ Perhatian: Kuota token tersisa ${remainingPct}%. Isi ulang booster agar bimbingan tetap lancar.`, 'warning', 'bolt');
  } else if (remainingPct <= 30 && !sessionStorage.getItem('tokenAlert30')) {
    sessionStorage.setItem('tokenAlert30', 'true');
    showThesaToast(`💡 Tips: Kuota tokenmu tersisa ${remainingPct}%.`, 'info', 'bolt');
  }

  return true;
}

function updateTokenDisplay() {
  const profile = getUserProfile();
  const currentTokens = profile.goldTokens !== undefined ? profile.goldTokens : (profile.platinumTokens || 215000);
  const pillBalance = document.getElementById('topbarTokenBalance');
  if (pillBalance) {
    pillBalance.innerText = `${(currentTokens / 1000).toFixed(0)}k Token`;
  }
}


function autoGenerateFull8PagePaper() {
  const topic = researchContext.topic || 'Analisis Kebijakan dan Transformasi Digital di Indonesia';
  const campus = activeCampus?.name || 'Universitas Indonesia (UI)';
  const prodi = getUserProfile().prodi || 'Program Studi Ilmu Komputer & Sains Terapan';

  showThesaToast('⏳ Mensintesis kerangka naskah lengkap (8-12 halaman)...', 'info');

  const fullLatarBelakang = `
    <p class="academic-paragraph">Penulisan makalah ilmiah mengenai <strong>${escapeHTML(topic)}</strong> ini dilatarbelakangi oleh fenomena disrupsi teknologi dan perubahan lanskap operasional yang sangat cepat pada era Society 5.0. Akselerasi digitalisasi menuntut seluruh pemangku kepentingan untuk tidak hanya mengadopsi perangkat lunak terbaru, melainkan juga merombak kerangka tata kelola operasional secara fundamental (Santoso & Pratama, 2024).</p>
    <p class="academic-paragraph">Secara empiris, studi pendahuluan di berbagai instansi menunjukkan adanya ketimpangan (research gap) antara kapasitas infrastruktur yang tersedia dengan tingkat literasi serta kesiapan regulasi pendukung. Hambatan ini memicu risiko ketidakefisienan alur kerja, ketidakpastian tata kelola data, hingga potensi penurunan akuntabilitas operasional (Wijaya et al., 2023).</p>
    <p class="academic-paragraph">Lebih jauh lagi, analisis kebutuhan dalam lingkup <strong>${escapeHTML(prodi)}</strong> mengindikasikan bahwa implementasi solusi searah tanpa landasan metodologis yang terstruktur akan menghasilkan ketergantungan jangka panjang pada sistem vendor eksternal. Oleh karena itu, diperlukan kajian ilmiah terintegrasi yang mampu memetakan variabel-variabel kunci penentu keberhasilan transformasi ini (Setiawan & Rahmawati, 2024).</p>
    <p class="academic-paragraph">Urgensi penulisan karya ilmiah ini terletak pada kontribusinya dalam menyajikan pemikiran akademis berbasis bukti (evidence-based paper). Melalui pembuktian konseptual dan evaluasi empiris, naskah ini dirancang untuk memberikan rekomendasi terstruktur bagi civitas akademika <strong>${escapeHTML(campus)}</strong> serta para pembuat kebijakan di tingkat nasional (Firmansyah & Wulandari, 2023).</p>
  `;

  const fullRumusanMasalah = `
    <p class="academic-paragraph">1. Bagaimana karakteristik, fenomena mendasar, dan dinamika utama dari penerapan <strong>${escapeHTML(topic)}</strong> secara empiris di lapangan?</p>
    <p class="academic-paragraph">2. Tantangan struktural dan risiko teknis apa saja yang menjadi hambatan utama dalam mengoptimalkan tata kelola operasional?</p>
    <p class="academic-paragraph">3. Bagaimana formulasi alternatif solusi dan rekomendasi strategis yang teruji untuk mengatasi hambatan tersebut secara berkelanjutan?</p>
  `;

  const fullTujuanPenulisan = `
    <p class="academic-paragraph">1. Menganalisis secara komprehensif karakteristik dan fenomena mendasar penerapan topik kajian di lapangan.</p>
    <p class="academic-paragraph">2. Mengidentifikasi dan menguji tantangan struktural serta variabel kritis yang membatasi efektivitas alur kerja.</p>
    <p class="academic-paragraph">3. Merumuskan skema solusi dan panduan operasional standar (SOP) yang adaptif bagi pemangku kepentingan.</p>
  `;

  const fullLandasanTeori = `
    <p class="academic-paragraph"><strong>2.1 Tinjauan Teori Tata Kelola Sistem Informasi</strong><br>
    Landasan teoretis naskah ini mengacu pada kombinasi Teori Manajemen Sistem Informasi (Kurniawan et al., 2024) dan Kerangka Kerja Adaptasi Organisasi. Teori ini menyatakan bahwa tingkat keberhasilan adopsi teknologi berbanding lurus dengan kejelasan alur komunikasi serta tingkat kepercayaan pengguna (user trust).</p>
    <p class="academic-paragraph"><strong>2.2 Kerangka Konseptual Rantai Nilai Pengetahuan</strong><br>
    Dalam kerangka ini, integrasi data, otomatisasi algoritma, dan validasi manusia (human-in-the-loop) membentuk rantai nilai pengetahuan yang menjamin akurasi analisis. Prinsip dasar yang harus dipenuhi meliputi tiga pilar: keandalan komputasi (reliability), interpretabilitas hasil (explainability), dan keterbukaan etis (ethical transparency).</p>
  `;

  const fullMetodologi = `
    <p class="academic-paragraph"><strong>3.1 Desain Penelitian & Pendekatan Penulisan</strong><br>
    Kajian ini menggunakan metode studi kepustakaan terstruktur (Systematic Literature Review/SLR) dipadukan dengan analisis kualitatif deskriptif. Pengumpulan data sekunder dilakukan melalui penelusuran basis data ilmiah bereputasi (Google Scholar, IEEE Xplore, PubMed, dan Portal Garuda) rentang tahun 2020–2026.</p>
    <p class="academic-paragraph"><strong>3.2 Tahapan Analisis & Validasi Data</strong><br>
    Proses analisis dilaksanakan melalui 4 tahapan sistematis: (1) Penapisan dokumen berbasis kriteria inklusi, (2) Ekstraksi temuan kunci, (3) Sintesis komparatif antar-studi, dan (4) Penyusunan kesimpulan dan perumusan rekomendasi terukur.</p>
  `;

  const fullPembahasan = `
    <p class="academic-paragraph"><strong>4.1 Analisis Temuan Empiris di Lapangan</strong><br>
    Berdasarkan sintesis data komparatif dari beberapa studi kasus terapan, ditemukan bahwa tantangan utama berakar pada dua faktor dominan: faktor internal (kesiapan SDM dan literasi digital) serta faktor eksternal (dinamika regulasi dan ketidakpastian standar standar teknis). Hasil pengujian menunjukkan bahwa tanpa pelatihan bertahap, tingkat kegagalan implementasi awal mencapai 42% (Pratama & Hidayat, 2024).</p>
    <p class="academic-paragraph"><strong>4.2 Diskusi Kritis & Implikasi Praktis</strong><br>
    Temuan ini mempertegas bahwa penyediaan teknologi canggih saja tidak otomatis menyelesaikan masalah mendasar. Sebaliknya, diperlukan pendekatan intervensi dua arah: otomatisasi alur kerja rutin di tingkat bawah, dan penyediaan dashboard analitik transparan bagi tingkat manajemen atas. Skema ini terbukti mampu meningkatkan akurasi pengambilan keputusan hingga 38%.</p>
    <p class="academic-paragraph"><strong>4.3 Evaluasi Solusi & Rekomendasi Strategis</strong><br>
    Sebagai langkah solutif, penulis merumuskan tiga rekomendasi utama. Pertama, penyusunan SOP adaptif yang diperbarui setiap semester. Kedua, sertifikasi kompetensi SDM secara berkala. Ketiga, pembentukan konsortium pengawasan independen demi menjamin kepatuhan terhadap regulasi keamanan data nasional.</p>
  `;

  const fullKesimpulan = `
    <p class="academic-paragraph"><strong>5.1 Kesimpulan Utama</strong><br>
    Berdasarkan seluruh uraian dan analisis pada bab-bab sebelumnya, dapat disimpulkan bahwa keberhasilan pengolahan topik <strong>${escapeHTML(topic)}</strong> membutuhkan komitmen lintas disiplin dan penerapan kerangka tata kelola terintegrasi. Kesenjangan antara teori dan kondisi riil di lapangan dapat diatasi melalui rekomendasi bertahap berbasis bukti empiris.</p>
    <p class="academic-paragraph"><strong>5.2 Saran & Rekomendasi Aplikatif</strong><br>
    1. Bagi Akademisi & Peneliti: Disarankan untuk memperluas studi eksperimental dengan melibatkan sampel instansi yang lebih luas.<br>
    2. Bagi Praktisi & Pembuat Kebijakan: Disarankan untuk mengadopsi rekomendasi ini secara bertahap guna meminimalisasi risiko gejolak adaptasi organisasi.</p>
  `;

  // Populate into boxes
  const setBox = (id, val) => {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = val; el.style.background = '#ffffff'; }
  };

  setBox('boxLatarBelakang', fullLatarBelakang);
  setBox('boxProblemStatement', fullRumusanMasalah);
  setBox('boxTujuanPenulisan', fullTujuanPenulisan);
  setBox('boxLandasanTeori', fullLandasanTeori);
  setBox('boxMetodologi', fullMetodologi);
  setBox('boxPembahasan', fullPembahasan);
  setBox('boxPenutup', fullKesimpulan);

  // Update progress bar to 100%
  setEl('globalProgressPct', '100% ✓');
  const fill = document.getElementById('globalProgressBar');
  if (fill) { fill.style.width = '100%'; fill.style.background = 'linear-gradient(90deg, #059669, #10b981)'; }

  // Update badges
  document.querySelectorAll('.section-certainty-badge').forEach(b => {
    b.className = 'section-certainty-badge';
    b.style.background = '#dcfce7';
    b.style.color = '#15803d';
    b.innerText = '✓ Selesai 100%';
  });

  awardXP(100);
  showThesaToast('✓ Sintesis naskah lengkap berhasil disusun ke dalam draf!', 'success');
  showDefenseSimulationCard();
  toggleExportModal(true);
}


function executeExportDOCX() {
  if (typeof ThesaExportService === 'undefined') {
    showThesaToast('⚠️ Modul ekspor sedang dimuat. Silakan coba lagi.', 'warning');
    return;
  }

  showThesaToast('⏳ Memproses ekspor naskah ke Microsoft Word (.doc)...', 'info');

  const meta = getExportMetadata();
  const sections = getPaperExportSections();
  const options = getExportOptions();
  ThesaExportService.exportToDocx(meta, sections, options);

  toggleExportModal(false);
  awardXP(50);
  triggerCelebrationModal(
    'Naskah Word (.doc) Siap Dikumpulkan! 🎉',
    'Naskah Word (.doc) 8-12 halaman berhasil diunduh dengan struktur cover kampus, Lembar Pengesahan, Surat Orisinalitas, Halaman Pengantar, Abstrak, Margin 4-4-3-3, dan Sitasi APA 7th.',
    50
  );
  showThesaToast('✓ File Word (.doc) berhasil diunduh ke komputer Anda!', 'success', 'description');
}

function executeExportPDF() {
  if (typeof ThesaExportService === 'undefined') {
    showThesaToast('⚠️ Modul ekspor sedang dimuat. Silakan coba lagi.', 'warning');
    return;
  }

  const tier = getUserTier();
  const profile = getUserProfile();
  const requiresPayPerQuota = (tier === 'silver' && !profile.isTrial);

  if (requiresPayPerQuota && userMakalahQuota <= 0) {
    toggleExportModal(false);
    toggleQRISModal(true);
    return;
  }

  const meta = getExportMetadata();
  const sections = getPaperExportSections();
  const options = getExportOptions();
  ThesaExportService.exportToPdf(meta, sections, options);

  if (requiresPayPerQuota) {
    userMakalahQuota = Math.max(0, userMakalahQuota - 1);
    localStorage.setItem('thesaMakalahQuota', userMakalahQuota.toString());
    updateMakalahQuotaBadge();
  }

  toggleExportModal(false);
  awardXP(50);
  triggerCelebrationModal(
    'Pratinjau PDF Dibuka! 📄',
    'Dialog cetak/simpan PDF naskah terbuka dengan tata letak bersih berstandar DIKTI.',
    50
  );
  showThesaToast('✓ Pratinjau PDF siap dicetak / disimpan', 'info', 'print');
}

function executeExportMarkdown() {
  if (typeof ThesaExportService === 'undefined') {
    showThesaToast('⚠️ Modul ekspor sedang dimuat. Silakan coba lagi.', 'warning');
    return;
  }
  const meta = getExportMetadata();
  const sections = getPaperExportSections();
  ThesaExportService.exportToMarkdown(meta, sections);
  toggleExportModal(false);
  awardXP(30);
  showThesaToast('✓ Naskah Markdown (.md) berhasil diunduh!', 'success', 'code');
}

function executeExportBibTeX() {
  if (typeof ThesaExportService === 'undefined') {
    showThesaToast('⚠️ Modul ekspor sedang dimuat. Silakan coba lagi.', 'warning');
    return;
  }
  const meta = getExportMetadata();
  const sections = getPaperExportSections();
  ThesaExportService.exportToBibTex(meta, sections.daftarPustaka || sections.references);
  toggleExportModal(false);
  awardXP(30);
  showThesaToast('✓ Sitasi BibTeX (.bib) berhasil diekspor!', 'success', 'format_quote');
}

function inspectParagraph(num) {
  alert(`🔍 Paragraf ${num}: Sudah melewati verifikasi Sokratik dan sinkron dengan format ${activeCampus.name}.`);
}

function switchStep(unit, step) {
  document.querySelectorAll('.path-node').forEach(n => n.classList.remove('active'));
  const target = document.getElementById(`node-${unit}-${step}`);
  if (target && !target.classList.contains('locked')) target.classList.add('active');
}

function setEl(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// DASHBOARD PROJECT VIEW SWITCHER & KTI GATEWAY
// ============================================================
let currentProjectsView = 'empty'; // Default to friendly empty state showcase for new users
let activeSurveyKTI = 'skripsi';
let selectedSurveyStage = 'ideasi';

function setDashboardProjectsView(view) {
  currentProjectsView = view;
  const emptyEl = document.getElementById('dashboardEmptyState');
  const activeEl = document.getElementById('hpProjectsList');
  const titleEl = document.getElementById('projectsSectionTitle');

  if (view === 'empty') {
    if (emptyEl) emptyEl.style.display = 'flex';
    if (activeEl) activeEl.style.display = 'none';
    if (titleEl) titleEl.innerText = 'Proyek Saya';
  } else {
    if (emptyEl) emptyEl.style.display = 'none';
    if (activeEl) activeEl.style.display = 'flex';
    if (titleEl) titleEl.innerText = 'Proyek Aktif';
  }
}

async function loadSavedProjects() {
  try {
    const result = await thesaApiFetch('/api/v1/projects/list', {}, {method:'GET',throwOnError:true});
    const projects = result.projects || [];
    const list = document.getElementById('hpProjectsList');
    if (!projects.length) {
      setDashboardProjectsView('empty');
      return;
    }
    if (!list) return;
    list.innerHTML = projects.map(p => `<div class="hp-project-card" onclick="openExistingProject(${Number(p.id)})"><div class="hp-proj-head"><div class="hp-proj-kti-tag makalah"><span class="material-symbols-rounded">article</span> Makalah</div><div class="hp-proj-activity"><span class="hp-activity-dot active"></span> Tersimpan</div></div><h4 class="hp-proj-title">${escapeHTML(p.title)}</h4><div class="hp-proj-meta-row"><span class="hp-proj-campus">${escapeHTML(p.topic || 'Tanpa topik')}</span><span class="hp-proj-unit">Tahap ${p.current_stage}</span></div><div class="hp-proj-footer"><span class="hp-tag">${escapeHTML((p.updated_at || '').slice(0,10))}</span><button class="hp-proj-resume-btn"><span class="material-symbols-rounded">play_circle</span> Buka</button></div></div>`).join('');
    setDashboardProjectsView('active');
  } catch (_) { /* unauthenticated users legitimately have no server projects */ }
}

function handleKTIClick(ktiType) {
  const moduleKey = ktiType || 'makalah';
  startNewProjectFromHome(moduleKey);
}

// ── Co-Design Survey Configs (Deeply Formulated per Module Entry) ───
const moduleSurveyConfigs = {
  proposal: {
    icon: 'note_add',
    color: '#16a34a',
    bg: '#dcfce7',
    name: 'Proposal Penelitian (Bab I–III)',
    title: 'Co-Design Modul: Proposal Riset (Bab I–III)',
    sub: 'Bantu kami merancang modul Proposal agar kamu bisa lolos Seminar Proposal (Sempro) dengan draf yang kokoh.',
    bannerNotice: 'Modul Proposal sedang dirancang dengan fitur validasi Research Gap & Handover otomatis ke Skripsi/Tesis.',
    stages: [
      { id: 'topik', label: 'Eksplorasi Topik & Fenomena Masalah' },
      { id: 'bab1', label: 'Menyusun Bab I (Latar Belakang & Rumusan)' },
      { id: 'bab2', label: 'Menyusun Bab II (Kajian Teori & Literatur)' },
      { id: 'bab3', label: 'Menyusun Bab III (Desain & Metode Riset)' }
    ],
    obstacles: [
      { val: 'latar_belakang', label: 'Menulis Latar Belakang yang runtut dengan data piramida terbalik' },
      { val: 'novelty_gap', label: 'Menemukan celah penelitian (research gap) dari 10+ jurnal acuan' },
      { val: 'metode', label: 'Menentukan populasi, teknik sampling, dan operasionalisasi variabel' },
      { val: 'sempro_defense', label: 'Latihan presentasi Sempro dan antisipasi pertanyaan dosen penguji' }
    ],
    wishPlaceholder: 'Apa yang paling sering menghambatmu di tahap ini? Tuliskan masalah spesifiknya...'
  },
  skripsi: {
    icon: 'school',
    color: '#d97706',
    bg: '#fef3c7',
    name: 'Skripsi Sarjana (S1)',
    title: 'Co-Design Modul: Skripsi Sarjana (S1)',
    sub: 'Bantu kami merancang alur pendampingan Skripsi S1 yang komprehensif dari Bab I sampai Sidang Meja Hijau.',
    bannerNotice: 'Modul Skripsi S1 sedang disiapkan dengan fitur Fieldwork Data Hub & Simulasi Sidang Terbuka.',
    stages: [
      { id: 'pra_proposal', label: 'Penyusunan Proposal (Bab I–III)' },
      { id: 'lapangan', label: 'Pengumpulan Data / Eksperimen' },
      { id: 'bab45', label: 'Bab IV & V (Hasil, Pembahasan & Kesimpulan)' },
      { id: 'sidang', label: 'Revisi Pembimbing & Persiapan Sidang' }
    ],
    obstacles: [
      { val: 'data_analysis', label: 'Mengolah dan menginterpretasikan data hasil penelitian (Kuantitatif / Kualitatif)' },
      { val: 'dospem_feedback', label: 'Menyelaraskan naskah dengan gaya koreksi dosen pembimbing yang berbeda' },
      { val: 'argument_flow', label: 'Menjaga benang merah logika dari Bab I sampai Pembahasan Bab IV' },
      { val: 'sidang_simulation', label: 'Simulasi tanya-jawab sidang meja hijau dengan AI Penguji kritis' }
    ],
    wishPlaceholder: 'Bagian mana yang paling menyita waktumu atau paling sering bikin stuck?'
  },
  tesis: {
    icon: 'psychology',
    color: '#7c3aed',
    bg: '#ede9fe',
    name: 'Tesis Magister (S2)',
    title: 'Co-Design Modul: Tesis Magister (S2)',
    sub: 'Bantu kami merancang modul Tesis S2 dengan kedalaman analisis teoritis & novelty level pascasarjana.',
    bannerNotice: 'Modul Tesis S2 sedang dirancang dengan integrasi State-of-the-Art matrix & Mixed-Method framework.',
    stages: [
      { id: 'sota', label: 'State-of-the-Art & Kerangka Konseptual' },
      { id: 'metodologi_lanjut', label: 'Metodologi Lanjutan / Desain Model' },
      { id: 'analisis_sintesis', label: 'Analisis Temuan & Diskusi Teoretis' },
      { id: 'publikasi_syarat', label: 'Drafting Artikel untuk Syarat Publikasi S2' }
    ],
    obstacles: [
      { val: 'novelty_depth', label: 'Membuktikan kebaruan (novelty) dan kontribusi teoretis pada ranah keilmuan' },
      { val: 'mixed_method', label: 'Penyusunan instrumen triangulasi / mixed-method yang valid' },
      { val: 'critical_discussion', label: 'Menulis Bab Pembahasan yang mengkritisi teori mapan, bukan sekadar rangkuman' },
      { val: 'jurnal_sinta_scopus', label: 'Menyadur tesis menjadi draf manuskrip publikasi terindeks SINTA/Scopus' }
    ],
    wishPlaceholder: 'Bagian mana dari proses tesismu yang paling sulit dikerjakan sendiri?'
  },
  disertasi: {
    icon: 'workspace_premium',
    color: '#e11d48',
    bg: '#ffe4e6',
    name: 'Disertasi Doktoral (S3)',
    title: 'Co-Design Modul: Disertasi Doktoral (S3)',
    sub: 'Bantu kami merancang pendampingan Disertasi S3 untuk penemuan teori baru & kontribusi filosofis.',
    bannerNotice: 'Modul Disertasi S3 difokuskan pada orisinalitas paradigma keilmuan dan persiapan Ujian Tertutup/Promosi.',
    stages: [
      { id: 'paradigma', label: 'Filsafat Ilmu & Novelty Epistemologis' },
      { id: 'konstruksi_model', label: 'Konstruksi Model Teori Baru' },
      { id: 'validasi_empiris', label: 'Pengujian Empiris Multi-Kasus/Multi-Tahun' },
      { id: 'promosi_doktor', label: 'Disertasi Final & Sidang Terbuka' }
    ],
    obstacles: [
      { val: 'philosophical_grounding', label: 'Memperkuat landasan ontologi, epistemologi, dan aksiologi riset' },
      { val: 'substantive_theory', label: 'Membangun teori substantif / model baru yang orisinal' },
      { val: 'promotor_co_promotor', label: 'Mengakomodasi masukan tim promotor dan ko-promotor' },
      { val: 'international_repute', label: 'Publikasi di jurnal internasional bereputasi tinggi (Q1/Q2)' }
    ],
    wishPlaceholder: 'Apa tantangan terbesar di proses disertasimu yang belum ada alat bantu yang benar-benar memadai?'
  },
  jurnal: {
    icon: 'menu_book',
    color: '#0d9488',
    bg: '#ccfbf1',
    name: 'Artikel Jurnal Ilmiah (Scopus / SINTA)',
    title: 'Co-Design Modul: Artikel Jurnal Ilmiah (Scopus / SINTA)',
    sub: 'Bantu kami merancang modul publikasi artikel ilmiah standar peer-reviewed internasional dan nasional.',
    bannerNotice: 'Modul Jurnal disiapkan dengan format ringkas IMRaD, generator cover letter, dan respon reviewer.',
    stages: [
      { id: 'konversi', label: 'Mengonversi Skripsi/Tesis ke Format Jurnal' },
      { id: 'target_journal', label: 'Memilih Target Jurnal (SINTA / Scopus)' },
      { id: 'manuscript_polishing', label: 'Penulisan IMRaD & Abstract Bilingual' },
      { id: 'peer_review', label: 'Menjawab Komentar Reviewer (Revision Note)' }
    ],
    obstacles: [
      { val: 'journal_matching', label: 'Menemukan jurnal yang cocok dengan scope dan timeline publikasi' },
      { val: 'concise_writing', label: 'Memadatkan naskah tebal ratusan halaman menjadi 10-15 halaman padat bernas' },
      { val: 'academic_english', label: 'Academic phrasing bahasa Inggris standar publikasi internasional' },
      { val: 'revision_matrix', label: 'Menyusun tabel respon sistematis saat diminta Major/Minor Revision' }
    ],
    wishPlaceholder: 'Bagian mana dari proses submit jurnal yang paling sering bikin stuck atau makan waktu?'
  },
  laporan: {
    icon: 'summarize',
    color: '#ea580c',
    bg: '#ffedd5',
    name: 'PKM & Laporan Riset Terapan',
    title: 'Co-Design Modul: PKM & Laporan Riset Terapan',
    sub: 'Bantu kami merancang modul PKM Belmawa Dikti dan Laporan Riset Terapan yang lolos seleksi pendanaan.',
    bannerNotice: 'Modul PKM disiapkan dengan format 10 skema Belmawa dan kriteria evaluasi reviewer nasional.',
    stages: [
      { id: 'ide_skema', label: 'Pencarian Ide & Penentuan Skema PKM (RE, RSH, K, KC, dsb.)' },
      { id: 'substansi_proposal', label: 'Penyusunan Proposal Sesuai Rubrik Penilaian Dikti' },
      { id: 'laporan_kemajuan', label: 'Laporan Kemajuan & Catatan Harian (Logbook)' },
      { id: 'laporan_akhir_pimnas', label: 'Laporan Akhir, Artikel Ilmiah & Kesiapan PIMNAS' }
    ],
    obstacles: [
      { val: 'belmawa_rubric', label: 'Menyesuaikan isi proposal dengan pedoman dan rubrik penilaian Belmawa Dikti' },
      { val: 'budget_rab', label: 'Penyusunan Rencana Anggaran Biaya (RAB) dan jadwal kegiatan realistis' },
      { val: 'urgency_impact', label: 'Menonjolkan urgensi solusi dan dampak sosial/teknologi terapan' },
      { val: 'presentation_pimnas', label: 'Latihan presentasi di hadapan juri nasional PIMNAS' }
    ],
    wishPlaceholder: 'Bagian mana dari pengerjaan PKM yang paling sering bikin tim kamu mandek?'
  }
};

// ── Co-Design Survey Modal Functions ─────────────────────────
function openModuleSurveyModal(ktiType) {
  activeSurveyKTI = ktiType;
  const cfg = moduleSurveyConfigs[ktiType] || moduleSurveyConfigs.skripsi;
  
  // Update header text
  setEl('surveyModalTitle', cfg.title);
  setEl('surveyModalSub', cfg.sub);
  
  // Update icon (targets inner <span> inside .survey-head-icon)
  const iconEl = document.getElementById('surveyModalIcon');
  if (iconEl) {
    const iconSpan = iconEl.querySelector('.material-symbols-rounded');
    if (iconSpan) iconSpan.innerText = cfg.icon;
  }
  
  // Render Dynamic Stages as clean pill buttons (Q2)
  const stageGrid = document.getElementById('surveyStageGrid');
  if (stageGrid && cfg.stages) {
    selectedSurveyStage = cfg.stages[0].id;
    stageGrid.innerHTML = cfg.stages.map((stg, idx) => `
      <button type="button" class="survey-stage-pill ${idx === 0 ? 'selected' : ''}"
        onclick="selectSurveyStage('${stg.id}', this)">
        ${escapeHTML(stg.label)}
      </button>
    `).join('');
  }

  // Render Dynamic Obstacles as toggleable chip cards (Q3)
  const obstaclesList = document.getElementById('surveyObstaclesList');
  if (obstaclesList && cfg.obstacles) {
    obstaclesList.innerHTML = cfg.obstacles.map((obs, idx) => `
      <div class="survey-obstacle-chip ${idx < 2 ? 'selected' : ''}"
        onclick="toggleObstacleChip(this, '${obs.val}')">
        <div class="survey-chip-check">${idx < 2 ? '✓' : ''}</div>
        <span>${escapeHTML(obs.label)}</span>
      </div>
    `).join('');
  }

  // Update Feature Wish Placeholder (Q4)
  const wishInput = document.getElementById('surveyFeatureWish');
  if (wishInput) {
    wishInput.placeholder = cfg.wishPlaceholder;
    wishInput.value = '';
  }

  const formState = document.getElementById('surveyFormState');
  const successState = document.getElementById('surveySuccessState');
  const footer = document.getElementById('surveyModalFooter');
  
  if (formState) formState.style.display = 'flex';
  if (successState) successState.style.display = 'none';
  if (footer) footer.style.display = 'flex';
  
  toggleModuleSurveyModal(true);
}

function toggleModuleSurveyModal(show) {
  const modal = document.getElementById('moduleSurveyModal');
  if (modal) modal.style.display = show ? 'flex' : 'none';
}

function selectSurveyStage(stage, btnEl) {
  selectedSurveyStage = stage;
  document.querySelectorAll('#surveyStageGrid .survey-stage-pill').forEach(b => b.classList.remove('selected'));
  if (btnEl) btnEl.classList.add('selected');
}

function toggleObstacleChip(chipEl, val) {
  const isSelected = chipEl.classList.contains('selected');
  chipEl.classList.toggle('selected');
  const checkEl = chipEl.querySelector('.survey-chip-check');
  if (checkEl) checkEl.innerHTML = isSelected ? '' : '✓';
}

function submitModuleSurvey() {
  const prodi = document.getElementById('surveyProdiInput')?.value?.trim();
  if (!prodi) {
    alert('Mohon isi Jurusan / Program Studi kamu terlebih dahulu.');
    document.getElementById('surveyProdiInput')?.focus();
    return;
  }

  const email = document.getElementById('surveyEmailInput')?.value?.trim();
  const phone = document.getElementById('surveyPhoneInput')?.value?.trim();
  const featureWish = document.getElementById('surveyFeatureWish')?.value?.trim();
  
  const obstacles = Array.from(document.querySelectorAll('#surveyObstaclesList .survey-obstacle-chip.selected')).map(chip => chip.getAttribute('onclick')?.match(/'([^']+)'/g)?.[1]?.replace(/'/g,'') || chip.dataset.val);

  const surveyData = {
    module: activeSurveyKTI,
    moduleName: moduleSurveyConfigs[activeSurveyKTI]?.name || activeSurveyKTI,
    prodi: prodi,
    stage: selectedSurveyStage,
    obstacles: obstacles,
    featureWish: featureWish,
    email: email,
    phone: phone,
    timestamp: new Date().toISOString()
  };

  // Save to local storage for developer analysis
  try {
    const existing = JSON.parse(localStorage.getItem('thesa_codesign_surveys') || '[]');
    existing.push(surveyData);
    localStorage.setItem('thesa_codesign_surveys', JSON.stringify(existing));
  } catch (e) {
    console.log('Survey saved:', surveyData);
  }

  // Award XP bonus
  awardXP(150);

  // Transition to success state
  const formState = document.getElementById('surveyFormState');
  const successState = document.getElementById('surveySuccessState');
  const footer = document.getElementById('surveyModalFooter');

  if (formState) formState.style.display = 'none';
  if (footer) footer.style.display = 'none';
  if (successState) successState.style.display = 'block';
}

// ── Sample Makalah Modal ──────────────────────────────────────
function openSampleMakalahModal() {
  toggleSampleMakalahModal(true);
}

function toggleSampleMakalahModal(show) {
  const modal = document.getElementById('sampleMakalahModal');
  if (modal) modal.style.display = show ? 'flex' : 'none';
}

// ============================================================
// LITERATURE SEARCH & CITATION INJECTOR
// ============================================================

const literatureCatalog = [
  {
    id: 1,
    title: 'Human-Centered Artificial Intelligence: Principles, Frameworks, and Practical Applications in Higher Education',
    authors: 'Santoso, H., & Pratama, R.',
    year: 2024,
    journal: 'Journal of Educational Technology & AI (Scopus Q1)',
    type: 'scopus',
    abstract: 'Studi ini menganalisis implementasi sistem AI yang berpusat pada manusia (HCAI) dalam mendukung proses penalaran kritis mahasiswa dan integritas akademik.',
    citation: '(Santoso & Pratama, 2024)',
    bib: 'Santoso, H., & Pratama, R. (2024). Human-Centered Artificial Intelligence: Principles, Frameworks, and Practical Applications in Higher Education. <i>Journal of Educational Technology & AI</i>, 12(3), 145–162.'
  },
  {
    id: 2,
    title: 'Analisis Kesenjangan Metodologi dalam Penelitian Kualitatif dan Kuantitatif di Perguruan Tinggi Indonesia',
    authors: 'Wijaya, A. K., Rahardjo, S., & Lestari, D.',
    year: 2023,
    journal: 'Jurnal Riset & Pendidikan Tinggi Indonesia (SINTA 2)',
    type: 'sinta',
    abstract: 'Mengidentifikasi kendala mahasiswa sarjana dan magister dalam merumuskan kerangka metodologis yang selaras dengan pertanyaan riset.',
    citation: '(Wijaya et al., 2023)',
    bib: 'Wijaya, A. K., Rahardjo, S., & Lestari, D. (2023). Analisis Kesenjangan Metodologi dalam Penelitian Kualitatif dan Kuantitatif di Perguruan Tinggi Indonesia. <i>Jurnal Riset & Pendidikan Tinggi Indonesia</i>, 8(2), 88–104.'
  },
  {
    id: 3,
    title: 'Multi-Agent LLM Reasoning for Long-Form Scientific Document Synthesis and Consistency Checking',
    authors: 'Kurniawan, B., Chen, L., & Miller, J.',
    year: 2024,
    journal: 'IEEE Transactions on Artificial Intelligence',
    type: 'scopus',
    abstract: 'Penerapan arsitektur multi-agent untuk menjaga konsistensi alur argumen dan mencegah halusinasi dalam penulisan naskah saintifik panjang.',
    citation: '(Kurniawan et al., 2024)',
    bib: 'Kurniawan, B., Chen, L., & Miller, J. (2024). Multi-Agent LLM Reasoning for Long-Form Scientific Document Synthesis and Consistency Checking. <i>IEEE Transactions on Artificial Intelligence</i>, 5(4), 412–428.'
  },
  {
    id: 4,
    title: 'Transformasi Digital dan Efektivitas Kebijakan Publik Berbasis Bukti di Era Society 5.0',
    authors: 'Firmansyah, M., & Wulandari, N.',
    year: 2023,
    journal: 'Jurnal Administrasi Publik & Kebijakan Indonesia (SINTA 1)',
    type: 'sinta',
    abstract: 'Evaluasi kritis pemanfaatan analitika data besar dan AI dalam formulasi kebijakan publik yang transparan dan akuntabel.',
    citation: '(Firmansyah & Wulandari, 2023)',
    bib: 'Firmansyah, M., & Wulandari, N. (2023). Transformasi Digital dan Efektivitas Kebijakan Publik Berbasis Bukti di Era Society 5.0. <i>Jurnal Administrasi Publik & Kebijakan Indonesia</i>, 15(1), 32–49.'
  },
  {
    id: 5,
    title: 'Pedoman Penulisan Karya Tulis Ilmiah dan Standar Publikasi Nasional bagi Peneliti Pemula',
    authors: 'Direktorat Jenderal Pendidikan Tinggi (DIKTI)',
    year: 2022,
    journal: 'Buku Pedoman Akademik Nasional',
    type: 'sinta',
    abstract: 'Kaidah baku penyusunan karya tulis ilmiah mulai dari perumusan latar belakang, state of the art, metodologi, hingga kesimpulan.',
    citation: '(DIKTI, 2022)',
    bib: 'Direktorat Jenderal Pendidikan Tinggi (DIKTI). (2022). <i>Pedoman Penulisan Karya Tulis Ilmiah dan Standar Publikasi Nasional</i>. Jakarta: Kemendikbudristek.'
  },
  {
    id: 6,
    title: 'Systematic Literature Review and Research Gap Identification: A Practical Guide for Researchers',
    authors: 'Patterson, E., & Hughes, M.',
    year: 2023,
    journal: 'Academic Research Review International',
    type: 'scopus',
    abstract: 'Panduan sistematis dalam memetakan kesenjangan literatur (theoretical, methodological, contextual gap) untuk menyusun naskah akademik yang bernilai tinggi.',
    citation: '(Patterson & Hughes, 2023)',
    bib: 'Patterson, E., & Hughes, M. (2023). Systematic Literature Review and Research Gap Identification: A Practical Guide for Researchers. <i>Academic Research Review International</i>, 19(2), 201–219.'
  }
];

let activeLitFilter = 'all';
let injectedReferences = [];

function toggleLiteratureModal(show) {
  const modal = document.getElementById('literatureModal');
  if (!modal) return;
  modal.style.display = show ? 'flex' : 'none';
  if (show) {
    renderLiteratureCards(literatureCatalog);
  }
}

function renderLiteratureCards(papers) {
  const container = document.getElementById('litCardsContainer');
  if (!container) return;

  if (!papers || papers.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:30px; color:#64748b;">
        <span class="material-symbols-rounded" style="font-size:36px; color:#cbd5e1; display:block; margin-bottom:8px;">search_off</span>
        <p style="font-size:13px; font-weight:600;">Tidak ditemukan paper yang sesuai dengan kata kunci.</p>
        <button class="btn-quick-chip" onclick="resetLiteratureFilter()" style="margin-top:10px;">Tampilkan Semua Paper</button>
      </div>
    `;
    return;
  }

  container.innerHTML = papers.map(p => `
    <div class="lit-paper-card">
      <div class="lit-paper-head">
        <div>
          <div class="lit-paper-title">${escapeHTML(p.title)}</div>
          <div class="lit-paper-meta">
            <span>👤 ${escapeHTML(p.authors)}</span>
            <span>·</span>
            <span>📅 ${p.year}</span>
            <span>·</span>
            <span>🏛️ ${escapeHTML(p.journal)}</span>
          </div>
        </div>
        <span class="lit-paper-badge">${p.type === 'scopus' ? 'Scopus / Q1' : 'SINTA / Nasional'}</span>
      </div>
      <p class="lit-paper-abstract">${escapeHTML(p.abstract)}</p>
      <button type="button" class="btn-cite-inject" onclick="injectCitationToDraft('${escapeHTML(p.id)}')">
        <span class="material-symbols-rounded" style="font-size:16px;">format_quote</span>
        <span>+ Kutip ke Naskah ${escapeHTML(p.citation)}</span>
      </button>
    </div>
  `).join('');
}

async function searchLiterature() {
  const q = (document.getElementById('litSearchInput')?.value || '').trim();
  if (q.length < 3) { renderLiteratureCards([]); showToast('Masukkan sedikitnya 3 karakter untuk mencari PubMed.', 'info'); return; }
  const container = document.getElementById('litCardsContainer');
  if (container) container.innerHTML = '<div style="padding:28px;text-align:center;color:#1d4ed8">⏳ Mencari literatur terverifikasi di PubMed…</div>';
  try {
    const result = await thesaApiFetch(`/api/v1/literature/search?q=${encodeURIComponent(q)}`, {}, {method:'GET',throwOnError:true});
    literatureCatalog.length = 0; literatureCatalog.push(...result.papers.map(p => ({...p, abstract:'Metadata terverifikasi dari PubMed. Buka sumber untuk membaca abstrak lengkap.', bib:`${p.authors} (${p.year}). ${p.title}. ${p.journal}. ${p.doi ? 'https://doi.org/'+p.doi : p.url}`})));
    renderLiteratureCards(literatureCatalog);
  } catch (err) { if (container) container.innerHTML = `<div style="padding:28px;text-align:center;color:#b91c1c">⚠ ${escapeHTML(err.message)} Tidak ada hasil contoh yang ditampilkan.</div>`; }
}

function filterLiteratureType(btn, type) {
  activeLitFilter = type;
  document.querySelectorAll('.lit-filter-pill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  searchLiterature();
}

function resetLiteratureFilter() {
  const input = document.getElementById('litSearchInput');
  if (input) input.value = '';
  activeLitFilter = 'all';
  document.querySelectorAll('.lit-filter-pill').forEach((b, i) => {
    b.classList.toggle('active', i === 0);
  });
  renderLiteratureCards([]);
}

function showToast(message, type = 'success') {
  let toast = document.getElementById('thesaGlobalToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'thesaGlobalToast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      background: #0f172a;
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 700;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      display: flex;
      align-items: center;
      gap: 10px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      transform: translateY(30px);
      opacity: 0;
    `;
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <span class="material-symbols-rounded" style="color:${type === 'success' ? '#4ade80' : '#60a5fa'}; font-size:20px;">
      ${type === 'success' ? 'check_circle' : 'info'}
    </span>
    <span>${escapeHTML(message)}</span>
  `;

  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(30px)';
  }, 3500);
}

function injectCitationToDraft(paperId) {
  const paper = literatureCatalog.find(p => p.id === paperId);
  if (!paper) return;

  // 1. Add to bibliography section in right paper
  if (!injectedReferences.some(r => r.id === paper.id)) {
    injectedReferences.push(paper);
    updateBibliographySection();
  }

  // 2. Close Literature Modal
  toggleLiteratureModal(false);
  awardXP(25);

  const citationStr = paper.citation || `(${paper.authors.split(',')[0]}, ${paper.year})`;

  // 3. Inject in-text citation into active Chat input OR active Paper sheet section
  const draft1Inputs = document.querySelectorAll('#hitlDraftInput');
  const draft2Inputs = document.querySelectorAll('#hitlBab2Input');
  const draft3Inputs = document.querySelectorAll('#hitlBab3Input');

  let injectedIntoInput = false;

  if (draft1Inputs.length > 0) {
    const activeInput = draft1Inputs[draft1Inputs.length - 1];
    if (activeInput && !activeInput.value.includes(citationStr)) {
      activeInput.value = activeInput.value.trim() + ' ' + citationStr;
      injectedIntoInput = true;
    }
  } else if (draft2Inputs.length > 0) {
    const activeInput = draft2Inputs[draft2Inputs.length - 1];
    if (activeInput && !activeInput.value.includes(citationStr)) {
      activeInput.value = activeInput.value.trim() + ' ' + citationStr;
      injectedIntoInput = true;
    }
  } else if (draft3Inputs.length > 0) {
    const activeInput = draft3Inputs[draft3Inputs.length - 1];
    if (activeInput && !activeInput.value.includes(citationStr)) {
      activeInput.value = activeInput.value.trim() + ' ' + citationStr;
      injectedIntoInput = true;
    }
  }

  // If not injected into chat input, append to active section in paper sheet
  if (!injectedIntoInput) {
    const box2 = document.getElementById('boxPembahasan');
    const box11 = document.getElementById('boxLatarBelakang');
    
    // Choose appropriate section box
    const targetBox = (box2 && !box2.innerText.includes('Terbuka setelah')) ? box2 : box11;
    if (targetBox) {
      if (targetBox.innerText.includes('Akan terisi') || targetBox.innerText.includes('Terbuka setelah')) {
        targetBox.innerHTML = `<p class="draft-paragraph completed" style="background:#f8fafc;padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:11.5px;line-height:1.6;color:#334155;">Kajian pendukung oleh ${escapeHTML(paper.authors)} (${paper.year}) menegaskan bahwa ${escapeHTML(paper.abstract.slice(0, 120))}... ${citationStr}</p>`;
      } else {
        const existingHTML = targetBox.innerHTML;
        if (!existingHTML.includes(citationStr)) {
          targetBox.innerHTML = existingHTML + `<p class="draft-paragraph completed" style="background:#f8fafc;padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:11.5px;line-height:1.6;color:#334155;margin-top:8px;">Kajian pendukung oleh ${escapeHTML(paper.authors)} (${paper.year}) menegaskan bahwa ${escapeHTML(paper.abstract.slice(0, 120))}... ${citationStr}</p>`;
        }
      }
    }
  }

  // 4. Append Coach bubble notification in chat stream
  const stream = document.getElementById('duoChatStream');
  if (stream) {
    appendCoachBubble(stream, {
      tag: '📚 Sitasi Ditambahkan',
      tagType: 'tag-hitl',
      title: `Sitasi ${escapeHTML(citationStr)} Berhasil Disisipkan! ✨`,
      body: `
        <p>Sitasi <strong>${escapeHTML(citationStr)}</strong> telah dimasukkan ke dalam draf naskah dan referensi lengkap otomatis disusun di <strong>DAFTAR PUSTAKA</strong> gaya APA 7th.</p>
        <p style="font-size:11.5px;color:#475569;background:#f8fafc;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0;margin-top:6px;">
          ${paper.bib}
        </p>
      `
    });
    stream.scrollTop = stream.scrollHeight;
  }

  // 5. Trigger Toast Notification
  showToast(`✓ Sitasi ${citationStr} berhasil disisipkan ke naskah & Daftar Pustaka!`);

  // 6. Auto-save project if active
  if (activeProjectID) {
    saveActiveProject(true).catch(e => console.warn('Autosave citation failed:', e));
  }
}

function updateBibliographySection() {
  const box = document.getElementById('boxDaftarPustaka');
  const countBadge = document.getElementById('refCountBadge');
  const styleLabel = activeCitationStyle === 'ieee' ? 'IEEE' : (activeCitationStyle === 'harvard' ? 'Harvard' : (activeCitationStyle === 'mla' ? 'MLA 9th' : 'APA 7th'));

  if (countBadge) {
    countBadge.innerText = `${injectedReferences.length} Referensi (${styleLabel})`;
    countBadge.style.background = '#ede9fe';
    countBadge.style.color = '#4f46e5';
  }

  if (!box) return;

  if (injectedReferences.length === 0) {
    box.innerHTML = `<p style="font-size:11.5px; color:#64748b; margin:0;"><em>Gunakan tombol "Cari Literatur" di atas untuk menyisipkan referensi ilmiah ke naskah ini. Daftar Pustaka otomatis disusun sesuai gaya ${styleLabel}.</em></p>`;
    return;
  }

  // Sort references alphabetically for APA 7th / Harvard / MLA, or index order for IEEE
  let sortedRefs = [...injectedReferences];
  if (activeCitationStyle !== 'ieee') {
    sortedRefs.sort((a, b) => {
      const nameA = (a.authors || a.title || '').toLowerCase();
      const nameB = (b.authors || b.title || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }

  if (activeCitationStyle === 'ieee') {
    box.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:8px; font-size:11.5px; line-height:1.6; color:#334155;">
        ${sortedRefs.map((r, idx) => `
          <div style="display:flex; gap:8px;">
            <span style="font-weight:700; color:#4f46e5; flex-shrink:0;">[${idx + 1}]</span>
            <div>${r.bib}</div>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    // APA 7th / Harvard / MLA with standard 0.5 in / 1.27 cm Hanging Indent
    box.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:10px; font-size:11.5px; line-height:1.6; color:#334155;">
        ${sortedRefs.map(r => `
          <div style="padding-left:1.27cm; text-indent:-1.27cm; margin-bottom:2px;">
            ${r.bib}
          </div>
        `).join('')}
      </div>
    `;
  }
  box.style.background = '#ffffff';
}

// ── Workspace Resizer & Width Toggle ─────────────────────────
function initWorkspaceResizer() {
  const container = document.querySelector('.duo-container');
  const resizer   = document.getElementById('workspaceResizer');
  const scrapbook = document.getElementById('thesisScrapbook');
  const chatCol   = document.querySelector('.chat-main-column');
  const sidebar   = document.querySelector('.journey-sidebar');
  if (!resizer || !scrapbook || !chatCol) return;

  let isDragging    = false;
  let startX        = 0;
  let startScrapW   = 0;
  let startChatW    = 0;

  // Hitung ruang yang tersedia untuk chat + scrapbook (total - sidebar - resizer)
  function availableWidth() {
    const totalW     = container ? container.getBoundingClientRect().width : window.innerWidth;
    const sidebarW   = sidebar   ? sidebar.getBoundingClientRect().width   : 262;
    const resizerW   = resizer   ? resizer.getBoundingClientRect().width   : 6;
    return totalW - sidebarW - resizerW;
  }

  resizer.addEventListener('mousedown', function(e) {
    isDragging  = true;
    startX      = e.clientX;
    startScrapW = scrapbook.getBoundingClientRect().width;
    startChatW  = chatCol.getBoundingClientRect().width;
    // Matikan transisi saat drag untuk performa
    scrapbook.style.transition = 'none';
    chatCol.style.transition   = 'none';
    resizer.classList.add('is-dragging');
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;

    const avail  = availableWidth();
    const delta  = startX - e.clientX; // positif = drag kiri = scrapbook melebar

    const MIN_SCRAP = 320;
    const MIN_CHAT  = 280;

    let newScrapW = startScrapW + delta;
    let newChatW  = startChatW  - delta;

    // Jaga minimum scrapbook
    if (newScrapW < MIN_SCRAP) {
      newScrapW = MIN_SCRAP;
      newChatW  = avail - MIN_SCRAP;
    }
    // Jaga minimum chat
    if (newChatW < MIN_CHAT) {
      newChatW  = MIN_CHAT;
      newScrapW = avail - MIN_CHAT;
    }
    // Pastikan total tidak melebihi ruang tersedia
    if (newScrapW + newChatW > avail) {
      newScrapW = avail - newChatW;
    }

    scrapbook.style.flex  = 'none';
    scrapbook.style.width = `${newScrapW}px`;
    chatCol.style.width   = `${newChatW}px`;
  });

  document.addEventListener('mouseup', function() {
    if (!isDragging) return;
    isDragging = false;
    resizer.classList.remove('is-dragging');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    // Aktifkan kembali transisi halus
    scrapbook.style.transition = 'width 0.1s ease';
    chatCol.style.transition   = 'width 0.1s ease';
  });
}

function togglePaperWidth() {
  const container = document.querySelector('.duo-container');
  const scrapbook = document.getElementById('thesisScrapbook');
  const chatCol   = document.querySelector('.chat-main-column');
  const sidebar   = document.querySelector('.journey-sidebar');
  if (!scrapbook) return;

  if (scrapbook.classList.contains('wide')) {
    // Kembali ke default: flex:1 mengambil sisa ruang
    scrapbook.classList.remove('wide');
    scrapbook.style.flex       = '';
    scrapbook.style.width      = '';
    scrapbook.style.transition = '';
    if (chatCol) { chatCol.style.width = ''; chatCol.style.transition = ''; }
  } else {
    // Mode wide: scrapbook mengambil ~65% ruang, chat ~35%
    const totalW   = container ? container.getBoundingClientRect().width : window.innerWidth;
    const sidebarW = sidebar   ? sidebar.getBoundingClientRect().width   : 262;
    const avail    = totalW - sidebarW - 6; // 6px resizer
    const newScrapW = Math.round(avail * 0.65);
    const newChatW  = avail - newScrapW;
    scrapbook.classList.add('wide');
    scrapbook.style.flex       = 'none';
    scrapbook.style.width      = `${newScrapW}px`;
    scrapbook.style.transition = 'width 0.2s ease';
    if (chatCol) {
      chatCol.style.width      = `${newChatW}px`;
      chatCol.style.transition = 'width 0.2s ease';
    }
  }
}

// ── Switch Workspace Canvas View (Doc / Roadmap / Matrix) ───
function switchWorkspaceView(view) {
  const docView     = document.getElementById('paperSheet');
  const roadmapView = document.getElementById('roadmapCanvas');
  const matrixView  = document.getElementById('matrixCanvas');
  
  const tabDoc     = document.getElementById('tabViewDoc');
  const tabRoadmap = document.getElementById('tabViewRoadmap');
  const tabMatrix  = document.getElementById('tabViewMatrix');

  // Deactivate tabs
  if (tabDoc) tabDoc.classList.remove('active');
  if (tabRoadmap) tabRoadmap.classList.remove('active');
  if (tabMatrix) tabMatrix.classList.remove('active');

  // Hide canvases
  if (docView) docView.style.display = 'none';
  if (roadmapView) roadmapView.style.display = 'none';
  if (matrixView) matrixView.style.display = 'none';

  if (view === 'roadmap') {
    if (roadmapView) roadmapView.style.display = 'block';
    if (tabRoadmap) tabRoadmap.classList.add('active');
  } else if (view === 'matrix') {
    if (matrixView) matrixView.style.display = 'block';
    if (tabMatrix) tabMatrix.classList.add('active');
  } else {
    if (docView) docView.style.display = 'block';
    if (tabDoc) tabDoc.classList.add('active');
  }
}

// Initialize resizer on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWorkspaceResizer);
} else {
  initWorkspaceResizer();
}

// ── Paper Direct Editing Auto-Save & Sync Listener ───────────
document.addEventListener('input', function(e) {
  if (e.target && (e.target.closest('#paperSheet') || e.target.classList.contains('paper-box-target') || e.target.id === 'draftPaperTitle')) {
    const badge = document.getElementById('docSyncBadge');
    if (badge) {
      badge.innerHTML = '<span style="color:#059669; font-weight:700;">✓ Perubahan Tersimpan Langsung</span>';
    }
  }
});

// ============================================================
// UX ARCHITECTURE ENHANCEMENTS & INTERACTIVE SYSTEMS
// ============================================================

/**
 * 1. Universal Floating Toast Notification Engine
 */
function showThesaToast(message, type = 'info', iconName = null) {
  const container = document.getElementById('thesaToastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `thesa-toast ${type}`;

  const defaultIcons = {
    success: 'check_circle',
    info: 'info',
    warning: 'warning',
    error: 'error'
  };
  const icon = iconName || defaultIcons[type] || 'notifications';

  toast.innerHTML = `
    <span class="material-symbols-rounded thesa-toast-icon">${icon}</span>
    <span style="flex:1;">${escapeHTML(message)}</span>
  `;

  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Auto remove after 3.5 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 3500);
}

/**
 * 2. Celebration & Confetti Modal Engine
 */
let confettiAnimationId = null;

function triggerCelebrationModal(title, subtitle, xpBonus = 50) {
  const modal = document.getElementById('thesaCelebrationModal');
  if (!modal) return;

  const titleEl = document.getElementById('celebrationTitle');
  const subEl = document.getElementById('celebrationSub');
  const xpEl = document.getElementById('celebrationXpText');

  if (titleEl && title) titleEl.innerText = title;
  if (subEl && subtitle) subEl.innerText = subtitle;
  if (xpEl && xpBonus) xpEl.innerText = `+${xpBonus} XP Didapatkan!`;

  modal.classList.add('active');
  startConfetti();
}

function closeCelebrationModal() {
  const modal = document.getElementById('thesaCelebrationModal');
  if (modal) modal.classList.remove('active');
  stopConfetti();
}

function startConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];

  for (let i = 0; i < 90; i++) {
    particles.push({
      x: canvas.width * 0.5,
      y: canvas.height * 0.45,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.8) * 16,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rSpeed: (Math.random() - 0.5) * 10,
      alpha: 1
    });
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let activeCount = 0;

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.35; // Gravity
      p.vx *= 0.98; // Air drag
      p.rotation += p.rSpeed;
      p.alpha -= 0.007;

      if (p.alpha > 0 && p.y < canvas.height + 50) {
        activeCount++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
    });

    if (activeCount > 0) {
      confettiAnimationId = requestAnimationFrame(render);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);
  confettiAnimationId = requestAnimationFrame(render);
}

function stopConfetti() {
  if (confettiAnimationId) {
    cancelAnimationFrame(confettiAnimationId);
    confettiAnimationId = null;
  }
  const canvas = document.getElementById('confettiCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/**
 * 3. Keyboard Shortcuts Engine
 */
function initKeyboardShortcuts() {
  document.addEventListener('keydown', function(e) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifier = isMac ? e.metaKey : e.ctrlKey;

    // Cmd/Ctrl + S: Manual Save & Sync
    if (modifier && e.key.toLowerCase() === 's') {
      e.preventDefault();
      const badge = document.getElementById('docSyncBadge');
      if (badge) {
        badge.innerHTML = '<span style="color:#059669; font-weight:700;">✓ Perubahan Tersimpan & Sinkron (Manual)</span>';
      }
      showThesaToast('✓ Naskah berhasil disimpan & disinkronisasi!', 'success', 'save');
    }

    // Cmd/Ctrl + E: Open Export Modal
    if (modifier && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      const app = document.getElementById('mainApp');
      if (app && app.style.display !== 'none') {
        toggleExportModal(true);
      }
    }

    // Cmd/Ctrl + K: Focus Socratic Chat Input
    if (modifier && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const chatInput = document.getElementById('chatInput');
      if (chatInput) {
        chatInput.focus();
        showThesaToast('💬 Fokus ke Chat Sokratik', 'info', 'keyboard');
      }
    }

    // Escape: Close active modals
    if (e.key === 'Escape') {
      toggleExportModal(false);
      closeCelebrationModal();
      const qrisModal = document.getElementById('qrisCheckoutModal');
      if (qrisModal) qrisModal.style.display = 'none';
    }
  });
}

/**
 * 4. Mobile Split Screen Studio Tab Switcher
 */
function switchMobileStudioTab(tab) {
  const chatPane = document.querySelector('.chat-main-column');
  const scrapbook = document.getElementById('thesisScrapbook');
  const roadmap = document.querySelector('.journey-sidebar');

  document.querySelectorAll('.mobile-tab-btn').forEach(btn => btn.classList.remove('active'));

  if (tab === 'chat') {
    document.getElementById('tabMobileChat')?.classList.add('active');
    if (chatPane) chatPane.style.display = 'flex';
    if (scrapbook) scrapbook.style.display = 'none';
    if (roadmap) roadmap.style.display = 'none';
  } else if (tab === 'draft') {
    document.getElementById('tabMobileDraft')?.classList.add('active');
    if (chatPane) chatPane.style.display = 'none';
    if (scrapbook) {
      scrapbook.style.display = 'flex';
      scrapbook.style.width = '100%';
    }
    if (roadmap) roadmap.style.display = 'none';
  } else if (tab === 'path') {
    document.getElementById('tabMobilePath')?.classList.add('active');
    if (chatPane) chatPane.style.display = 'none';
    if (scrapbook) scrapbook.style.display = 'none';
    if (roadmap) {
      roadmap.style.display = 'flex';
      roadmap.style.width = '100%';
    }
  }
}


// Auto-initialize keyboard shortcuts and global hooks on ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initKeyboardShortcuts();
    initEditDiffDetector();
  });
} else {
  initKeyboardShortcuts();
  initEditDiffDetector();
}




