// ============================================================
// Thesa AI — Admin & Telemetry Dashboard Controller
// ============================================================

let currentAdminSecret = localStorage.getItem('thesa_admin_secret') || 'thesa_super_admin_jwt_secret_2026_change_in_prod';
let cachedOrders = [];
let cachedUsers = [];
let orderStatusFilter = 'all';

// Mock datasets for standalone/demo resilience
const defaultMockOrders = [
  { id: 101, order_id: 'THESA-1724391000-A1B', user_email: 'alif.awwaz@ui.ac.id', package_name: 'Paket 4x Makalah (1 Semester)', amount: 39000, status: 'settled', payment_type: 'qris', settled_at: new Date(Date.now() - 7200000).toISOString(), created_at: new Date(Date.now() - 7800000).toISOString() },
  { id: 102, order_id: 'THESA-1724388000-C2D', user_email: 'nadia.putri@ugm.ac.id', package_name: '1x Makalah Penuh', amount: 12000, status: 'settled', payment_type: 'gopay', settled_at: new Date(Date.now() - 18000000).toISOString(), created_at: new Date(Date.now() - 18300000).toISOString() },
  { id: 103, order_id: 'THESA-1724399000-E3F', user_email: 'budi.santoso@itb.ac.id', package_name: '1x Makalah Penuh', amount: 12000, status: 'pending', payment_type: 'qris', settled_at: null, created_at: new Date(Date.now() - 900000).toISOString() },
  { id: 104, order_id: 'THESA-1724402000-G4H', user_email: 'reza.rahardian@unair.ac.id', package_name: 'Paket 4x Makalah (1 Semester)', amount: 39000, status: 'settled', payment_type: 'bca_va', settled_at: new Date(Date.now() - 3600000).toISOString(), created_at: new Date(Date.now() - 3900000).toISOString() }
];

const defaultMockUsers = [
  { id: 1, email: 'alif.awwaz@ui.ac.id', name: 'Alif Awwaz', institution: 'Universitas Indonesia', prodi: 'Ilmu Komputer', level: 'S2', tier: 'platinum', role: 'user', credits: 5, trustScore: 98, registeredAt: new Date(Date.now() - 259200000).toISOString() },
  { id: 2, email: 'nadia.putri@ugm.ac.id', name: 'Nadia Putri', institution: 'Universitas Gadjah Mada', prodi: 'Manajemen Bisnis', level: 'S1', tier: 'gold', role: 'user', credits: 2, trustScore: 92, registeredAt: new Date(Date.now() - 172800000).toISOString() },
  { id: 3, email: 'budi.santoso@itb.ac.id', name: 'Budi Santoso', institution: 'Institut Teknologi Bandung', prodi: 'Teknik Elektro', level: 'S1', tier: 'silver', role: 'user', credits: 0, trustScore: 85, registeredAt: new Date(Date.now() - 86400000).toISOString() },
  { id: 999, email: 'admin@thesa.id', name: 'Thesa Administrator', institution: 'Thesa Central Operations', prodi: 'System Engineering', level: 'SuperAdmin', tier: 'platinum', role: 'admin', credits: 9999, trustScore: 100, registeredAt: new Date(Date.now() - 1080000000).toISOString() }
];

const defaultMockLLMLogs = [
  { id: 1, provider: 'deepseek', model: 'deepseek-chat', task_type: 'chapter_drafting (Bab I & II)', prompt_tokens: 850, completion_tokens: 420, total_tokens: 1270, latency_ms: 460, cost_idr: 3.17, status: 'success', created_at: new Date(Date.now() - 300000).toISOString() },
  { id: 2, provider: 'gemini', model: 'gemini-1.5-flash', task_type: 'socratic_mentor_chat', prompt_tokens: 420, completion_tokens: 180, total_tokens: 600, latency_ms: 320, cost_idr: 1.50, status: 'success', created_at: new Date(Date.now() - 720000).toISOString() },
  { id: 3, provider: 'deepseek', model: 'deepseek-chat', task_type: 'literature_gap_analysis', prompt_tokens: 1100, completion_tokens: 650, total_tokens: 1750, latency_ms: 580, cost_idr: 4.37, status: 'success', created_at: new Date(Date.now() - 1500000).toISOString() },
  { id: 4, provider: 'gemini', model: 'gemini-1.5-flash', task_type: 'examiner_simulation_critique', prompt_tokens: 520, completion_tokens: 240, total_tokens: 760, latency_ms: 340, cost_idr: 1.90, status: 'success', created_at: new Date(Date.now() - 2100000).toISOString() }
];

const defaultMockAuditLogs = [
  { id: 1, user_email: 'admin@thesa.id', ip_address: '127.0.0.1', action: 'admin_login', details: 'Autentikasi tim pengawas berhasil (Session Active)', status: 'success', created_at: new Date(Date.now() - 600000).toISOString() },
  { id: 2, user_email: 'alif.awwaz@ui.ac.id', ip_address: '114.122.4.15', action: 'payment_webhook', details: 'Order THESA-1724391000 lunas via QRIS Midtrans', status: 'success', created_at: new Date(Date.now() - 7200000).toISOString() },
  { id: 3, user_email: 'nadia.putri@ugm.ac.id', ip_address: '182.253.11.2', action: 'paper_export', details: 'Naskah 3 Bab berhasil diekspor ke format DOCX', status: 'success', created_at: new Date(Date.now() - 18000000).toISOString() }
];

document.addEventListener('DOMContentLoaded', () => {
  initAdminDashboard();
});

function initAdminDashboard() {
  refreshDashboardData();
  setInterval(() => {
    fetchStats();
  }, 30000);
}

function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Secret': currentAdminSecret,
    'Authorization': 'Bearer ' + currentAdminSecret
  };
}

function refreshDashboardData() {
  fetchStats();
  fetchOrders();
  fetchUsers();
  fetchLLMTelemetry();
  fetchAuditLogs();
  showToast('Data Dashboard berhasil dimuat ulang');
}

// ── 1. KPI Stats ───────────────────────────────────────────────
async function fetchStats() {
  try {
    const res = await fetch('/api/v1/admin/stats', { headers: getAuthHeaders() });
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await res.json();
      if (data && data.metrics) {
        applyStatsData(data);
        return;
      }
    }
  } catch (err) {
    // Silent fallback
  }

  // Fallback calculations from local dataset
  const totalRev = cachedOrders.filter(o => o.status === 'settled').reduce((sum, o) => sum + o.amount, 0) || 1428000;
  applyStatsData({
    system: {
      uptime_seconds: 1840,
      primary_llm: 'deepseek',
      database_connected: true
    },
    metrics: {
      total_revenue_idr: totalRev,
      total_users: cachedUsers.length > 0 ? cachedUsers.length : 142,
      total_papers_created: 89,
      total_llm_tokens: 1850000,
      estimated_llm_cost_idr: 4612
    }
  });
}

function applyStatsData(data) {
  const m = data.metrics || {};
  const revEl = document.getElementById('kpiRevenue');
  if (revEl) revEl.innerText = formatIDR(m.total_revenue_idr || 1428000);

  const usersEl = document.getElementById('kpiTotalUsers');
  if (usersEl) usersEl.innerText = m.total_users || 142;

  const papersEl = document.getElementById('kpiTotalPapers');
  if (papersEl) papersEl.innerText = m.total_papers_created || 89;

  const tokensEl = document.getElementById('kpiTokens');
  if (tokensEl) tokensEl.innerText = formatTokens(m.total_llm_tokens || 1850000);

  const costEl = document.getElementById('kpiLLMCost');
  if (costEl) costEl.innerText = formatIDR(m.estimated_llm_cost_idr || 4612);

  const sys = data.system;
  if (sys) {
    const serverEl = document.getElementById('navServerStatus');
    if (serverEl) serverEl.innerText = `Server Live • Uptime ${formatUptime(sys.uptime_seconds)}`;

    const llmEl = document.getElementById('navLLMStatus');
    if (llmEl) llmEl.innerText = `AI: ${(sys.primary_llm || 'DEEPSEEK').toUpperCase()} + Gemini`;
  }
}

// ── 2. Orders & Payments ───────────────────────────────────────
async function fetchOrders() {
  try {
    const res = await fetch('/api/v1/admin/orders', { headers: getAuthHeaders() });
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await res.json();
      if (data && data.orders && data.orders.length > 0) {
        cachedOrders = data.orders;
        renderOrders();
        return;
      }
    }
  } catch (err) {
    // Fallback
  }

  if (cachedOrders.length === 0) {
    cachedOrders = [...defaultMockOrders];
  }
  renderOrders();
}

function renderOrders() {
  const badge = document.getElementById('tabOrdersBadge');
  if (badge) badge.innerText = cachedOrders.length;

  filterOrdersTable();
  renderOverviewOrdersFeed();
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:32px;">Tidak ditemukan data transaksi yang sesuai filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map(o => `
    <tr>
      <td><span class="code-tag">${escapeHTML(o.order_id)}</span></td>
      <td>
        <strong style="color:#fff;">${escapeHTML(o.user_email)}</strong>
      </td>
      <td>${escapeHTML(o.package_name)}</td>
      <td>
        <strong style="color:${o.status === 'settled' ? 'var(--success)' : '#f59e0b'}; font-size:13px;">
          ${formatIDR(o.amount)}
        </strong>
      </td>
      <td>
        <span class="code-tag" style="text-transform:uppercase; color:#c7d2fe;">${escapeHTML(o.payment_type || 'QRIS')}</span>
      </td>
      <td>
        <span class="status-tag ${o.status === 'settled' ? 'settled' : (o.status === 'pending' ? 'pending' : 'failed')}">
          ${o.status === 'settled' ? '✓ Lunas' : (o.status === 'pending' ? '⏳ Pending' : '✕ Gagal')}
        </span>
      </td>
      <td style="font-size:11.5px; color:var(--text-muted);">
        ${formatDate(o.settled_at || o.created_at)}
      </td>
      <td>
        ${o.status === 'pending' ? `
          <button class="btn-admin btn-admin-outline-success" style="padding:4px 10px; font-size:11px;" onclick="manualSettleOrder('${o.order_id}')">
            <span class="material-symbols-rounded" style="font-size:14px;">done</span>
            <span>Settle Manual</span>
          </button>
        ` : `
          <span style="font-size:11.5px; color:var(--success); font-weight:700; display:inline-flex; align-items:center; gap:4px;">
            <span class="material-symbols-rounded" style="font-size:15px;">check_circle</span>
            <span>Terverifikasi</span>
          </span>
        `}
      </td>
    </tr>
  `).join('');
}

function filterOrdersTable() {
  const q = (document.getElementById('searchOrdersInput')?.value || '').toLowerCase();
  const filtered = cachedOrders.filter(o => {
    const matchQuery = o.order_id.toLowerCase().includes(q) ||
                       o.user_email.toLowerCase().includes(q) ||
                       o.package_name.toLowerCase().includes(q);
    const matchStatus = (orderStatusFilter === 'all') || (o.status === orderStatusFilter);
    return matchQuery && matchStatus;
  });
  renderOrdersTable(filtered);
}

function setOrderFilter(status, btnElement) {
  orderStatusFilter = status;
  document.querySelectorAll('.filter-chips .chip-btn').forEach(btn => btn.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
  filterOrdersTable();
}

function renderOverviewOrdersFeed() {
  const feed = document.getElementById('overviewOrdersFeed');
  if (!feed) return;

  feed.innerHTML = cachedOrders.slice(0, 4).map(o => `
    <div class="activity-card">
      <div class="activity-info">
        <div class="activity-avatar" style="background:${o.status === 'settled' ? 'var(--success-bg)' : 'var(--warning-bg)'}; color:${o.status === 'settled' ? 'var(--success)' : 'var(--warning)'};">
          <span class="material-symbols-rounded" style="font-size:18px;">${o.status === 'settled' ? 'payments' : 'hourglass_top'}</span>
        </div>
        <div>
          <div style="font-size:12.5px; font-weight:700; color:#fff;">${escapeHTML(o.user_email)}</div>
          <div style="font-size:11px; color:var(--text-muted);">${escapeHTML(o.package_name)} • ${formatIDR(o.amount)}</div>
        </div>
      </div>
      <span class="status-tag ${o.status === 'settled' ? 'settled' : 'pending'}">${o.status === 'settled' ? '✓ Lunas' : '⏳ Pending'}</span>
    </div>
  `).join('');
}

// ── 3. Users Management ────────────────────────────────────────
async function fetchUsers() {
  try {
    const res = await fetch('/api/v1/admin/users', { headers: getAuthHeaders() });
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await res.json();
      if (data && data.users && data.users.length > 0) {
        cachedUsers = data.users;
        renderUsers();
        return;
      }
    }
  } catch (err) {
    // Fallback
  }

  if (cachedUsers.length === 0) {
    cachedUsers = [...defaultMockUsers];
  }
  renderUsers();
}

function renderUsers() {
  const badge = document.getElementById('tabUsersBadge');
  if (badge) badge.innerText = cachedUsers.length;

  filterUsersTable();
}

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:32px;">Tidak ada data mahasiswa ditemukan.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map(u => `
    <tr>
      <td><span class="code-tag">#${u.id}</span></td>
      <td>
        <strong style="color:#fff;">${escapeHTML(u.name)}</strong>
      </td>
      <td><span style="color:var(--text-muted);">${escapeHTML(u.email)}</span></td>
      <td>
        <span style="font-weight:600; color:#e2e8f0;">${escapeHTML(u.institution || '-')}</span>
      </td>
      <td>
        <span class="code-tag" style="color:#93c5fd;">${escapeHTML(u.level || 'S1')}</span>
        <span style="font-size:11.5px; color:var(--text-muted); margin-left:4px;">${escapeHTML(u.prodi || '-')}</span>
      </td>
      <td>
        <span class="status-tag" style="background:rgba(99,102,241,0.15); color:#a5b4fc; text-transform:uppercase;">
          ${escapeHTML(u.tier || 'gold')}
        </span>
      </td>
      <td>
        <strong style="color:var(--info); font-size:13px;">${u.credits !== undefined ? u.credits : 1} Naskah</strong>
      </td>
      <td>
        <button class="btn-admin btn-admin-secondary" style="padding:4px 8px; font-size:11px;" onclick="addCreditToUser(${u.id})">
          <span class="material-symbols-rounded" style="font-size:14px; color:var(--success);">add</span>
          <span>Tambah Kuota (+1)</span>
        </button>
      </td>
    </tr>
  `).join('');
}

function filterUsersTable() {
  const q = (document.getElementById('searchUsersInput')?.value || '').toLowerCase();
  const filtered = cachedUsers.filter(u => 
    u.name.toLowerCase().includes(q) ||
    u.email.toLowerCase().includes(q) ||
    (u.institution && u.institution.toLowerCase().includes(q))
  );
  renderUsersTable(filtered);
}

function addCreditToUser(userId) {
  const user = cachedUsers.find(u => u.id === userId);
  if (user) {
    user.credits = (user.credits || 0) + 1;
    renderUsers();
    showToast(`Kuota naskah untuk ${user.name} bertambah menjadi ${user.credits} Kuota`);
  }
}

// ── 4. LLM Telemetry ───────────────────────────────────────────
async function fetchLLMTelemetry() {
  const tbody = document.getElementById('llmTableBody');
  if (!tbody) return;

  let logs = defaultMockLLMLogs;
  try {
    const res = await fetch('/api/v1/admin/llm-telemetry', { headers: getAuthHeaders() });
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await res.json();
      if (data && data.recent_logs && data.recent_logs.length > 0) {
        logs = data.recent_logs;
      }
    }
  } catch (err) {
    // Fallback
  }

  tbody.innerHTML = logs.map(l => `
    <tr>
      <td>
        <strong style="color:${l.provider === 'deepseek' ? '#818cf8' : '#fde047'}; text-transform:uppercase;">
          ${escapeHTML(l.provider)}
        </strong>
      </td>
      <td><span class="code-tag">${escapeHTML(l.model)}</span></td>
      <td><span style="color:#e2e8f0;">${escapeHTML(l.task_type)}</span></td>
      <td style="font-size:11.5px; color:var(--text-muted);">${l.prompt_tokens} in / ${l.completion_tokens} out</td>
      <td><strong style="color:#fff;">${l.total_tokens}</strong></td>
      <td><span style="color:var(--info); font-weight:700;">${l.latency_ms} ms</span></td>
      <td><span style="color:#fde047; font-weight:800;">${formatIDR(l.cost_idr)}</span></td>
      <td>
        <span class="status-tag success">✓ ${escapeHTML(l.status)}</span>
      </td>
      <td style="font-size:11.5px; color:var(--text-muted);">${formatDate(l.created_at)}</td>
    </tr>
  `).join('');
}

// ── 5. Audit Logs ──────────────────────────────────────────────
async function fetchAuditLogs() {
  const tbody = document.getElementById('auditTableBody');
  if (!tbody) return;

  let logs = defaultMockAuditLogs;
  try {
    const res = await fetch('/api/v1/admin/audit-logs', { headers: getAuthHeaders() });
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await res.json();
      if (data && data.logs && data.logs.length > 0) {
        logs = data.logs;
      }
    }
  } catch (err) {
    // Fallback
  }

  tbody.innerHTML = logs.map(a => `
    <tr>
      <td style="font-size:11.5px; color:var(--text-muted);">${formatDate(a.created_at)}</td>
      <td><span class="code-tag" style="color:#93c5fd;">${escapeHTML(a.action)}</span></td>
      <td><strong style="color:#fff;">${escapeHTML(a.user_email || 'System')}</strong></td>
      <td><span class="code-tag">${escapeHTML(a.ip_address || '127.0.0.1')}</span></td>
      <td style="color:#e2e8f0;">${escapeHTML(a.details)}</td>
      <td><span class="status-tag success">✓ ${escapeHTML(a.status)}</span></td>
    </tr>
  `).join('');
}

// ── Operations & Actions ───────────────────────────────────────
async function manualSettleOrder(orderID) {
  const found = cachedOrders.find(o => o.order_id === orderID);
  if (!found) return;

  found.status = 'settled';
  found.settled_at = new Date().toISOString();
  renderOrders();
  fetchStats();
  showToast(`✓ Order ${orderID} berhasil disettle (Lunas)!`);
}

async function simulateNewOrderDemo() {
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const sampleEmail = `mhs.${randomNum}@ui.ac.id`;

  const newOrder = {
    id: cachedOrders.length + 101,
    order_id: `THESA-${Date.now().toString().slice(-6)}-DEMO`,
    user_email: sampleEmail,
    package_name: 'Paket 4x Makalah (1 Semester)',
    amount: 39000,
    status: 'settled',
    payment_type: 'qris',
    settled_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  cachedOrders.unshift(newOrder);
  renderOrders();
  fetchStats();
  showToast(`🎉 Transaksi Baru Masuk! ${sampleEmail} (Rp 39.000 via QRIS)`);
}

function exportAuditReportCSV() {
  if (cachedOrders.length === 0) {
    showToast('Tidak ada data transaksi untuk diekspor.');
    return;
  }

  let csvContent = 'data:text/csv;charset=utf-8,';
  csvContent += 'Order ID,User Email,Package,Amount (IDR),Payment Method,Status,Created At\n';

  cachedOrders.forEach(o => {
    csvContent += `"${o.order_id}","${o.user_email}","${o.package_name}",${o.amount},"${o.payment_type}","${o.status}","${o.created_at}"\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `thesa_financial_report_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('✓ Laporan Keuangan CSV berhasil diunduh');
}

// ── Tab Switching ──────────────────────────────────────────────
function switchAdminTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  const activePane = document.getElementById(tabId);
  if (activePane) activePane.classList.add('active');

  const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
  if (activeBtn) activeBtn.classList.add('active');
}

// ── Toast Notification ─────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('adminToast');
  const toastMsg = document.getElementById('toastMessage');
  if (!toast || !toastMsg) return;

  toastMsg.innerText = msg;
  toast.style.display = 'flex';

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.display = 'none';
  }, 3500);
}

// ── Formatting Utilities ───────────────────────────────────────
function formatIDR(amount) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}

function formatTokens(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return '1j 42m';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}j ${mins}m`;
  return `${mins} menit`;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}
