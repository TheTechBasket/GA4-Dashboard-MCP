/* ──────────────────────────────────────────────────────────────
   Pulseboard — main.js
   Handles: card reveal animations, count-up, quota bars,
            auto-refresh toggle, cache refresh, sort, card expand,
            privacy blur, quota live-polling, keyboard shortcuts,
            toast notifications.
─────────────────────────────────────────────────────────────── */

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const QUOTA_POLL_MS       = 60 * 1000;      // 1 minute
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Helpers ──────────────────────────────────────────────────

function qNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'object' && 'value' in v) return parseInt(v.value, 10) || 0;
  return parseInt(v, 10) || 0;
}

function formatRelativeTime(isoString) {
  if (!isoString) return '—';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

function formatISO(isoString) {
  if (!isoString) return '—';
  try { return new Date(isoString).toLocaleString(); } catch { return isoString; }
}

// ── Card entrance animation ───────────────────────────────────

function revealCards() {
  const cards = document.querySelectorAll('.prop-card');
  if (REDUCED_MOTION) { cards.forEach(c => c.classList.add('revealed')); return; }
  cards.forEach((card, i) => {
    setTimeout(() => {
      card.style.transition =
        'opacity 220ms cubic-bezier(0.215,0.61,0.355,1),' +
        'transform 220ms cubic-bezier(0.215,0.61,0.355,1)';
      card.classList.add('revealed');
      setTimeout(() => { card.style.transition = ''; }, 260);
    }, i * 35);
  });
}

// ── Number count-up ───────────────────────────────────────────

function countUp(el, target, duration) {
  const end = parseInt(target, 10) || 0;
  if (end === 0 || REDUCED_MOTION) { el.textContent = end.toLocaleString(); return; }
  const start = performance.now();
  function step(ts) {
    const p = Math.min((ts - start) / duration, 1);
    const eased = 1 - (1 - p) ** 2;
    el.textContent = Math.round(eased * end).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function animateStatNumbers() {
  document.querySelectorAll('.prop-stat-num[data-target]').forEach(el => {
    const target = el.dataset.target;
    const duration = Math.min(200 + parseInt(target, 10) * 2, 900);
    const cardIndex = [...document.querySelectorAll('.prop-card')]
      .indexOf(el.closest('.prop-card'));
    setTimeout(() => countUp(el, target, duration), cardIndex * 35 + 100);
  });
  const totalEl = document.getElementById('jsTotal');
  const viewsEl = document.getElementById('jsTotalViews');
  if (totalEl) countUp(totalEl, totalEl.textContent, 800);
  if (viewsEl) countUp(viewsEl, viewsEl.textContent, 800);
}

// ── Quota bars ────────────────────────────────────────────────

const QUOTA_DEFS = [
  { key: 'tokensPerProjectPerHour', label: 'Project · Hour', note: '(shared pool)' },
  { key: 'tokensPerHour',           label: 'Property · Hour', note: '' },
  { key: 'tokensPerDay',            label: 'Property · Day',  note: '' },
];

function barColorClass(pct) {
  if (pct > 80) return 'danger';
  if (pct > 50) return 'amber';
  return '';
}

function renderQuotaBars(quota) {
  const metersEl = document.getElementById('quotaMeters');
  const noneEl   = document.getElementById('quotaNone');
  if (!metersEl || !quota) return;

  noneEl && (noneEl.style.display = 'none');
  // Clear existing dynamic bars (keep noneEl)
  metersEl.querySelectorAll('.quota-meter').forEach(el => el.remove());

  QUOTA_DEFS.forEach(def => {
    const raw = quota[def.key];
    if (!raw) return;
    const consumed  = qNum(raw.consumed);
    const remaining = qNum(raw.remaining);
    const total     = consumed + remaining;
    if (total === 0) return;
    const pct = Math.round((consumed / total) * 100);

    const wrapper = document.createElement('div');
    wrapper.className = 'quota-meter';
    wrapper.innerHTML = `
      <div class="qm-head">
        <span class="qm-name">${def.label} <span style="font-weight:400;opacity:.6">${def.note}</span></span>
        <span class="qm-val">${consumed.toLocaleString()} / ${total.toLocaleString()} &nbsp;(${pct}%)</span>
      </div>
      <div class="qm-bar-bg">
        <div class="qm-bar-fill ${barColorClass(pct)}" data-pct="${pct}" style="width:0"></div>
      </div>
    `;
    metersEl.appendChild(wrapper);
  });

  if (!REDUCED_MOTION) {
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.querySelectorAll('.qm-bar-fill').forEach(el => {
          el.style.width = el.dataset.pct + '%';
        });
      }, 80);
    });
  } else {
    document.querySelectorAll('.qm-bar-fill').forEach(el => {
      el.style.width = el.dataset.pct + '%';
      el.style.transition = 'none';
    });
  }

  // Show updated-at time if present
  if (quota.updatedAt) {
    let tsEl = document.getElementById('quotaUpdatedAt');
    if (!tsEl) {
      tsEl = document.createElement('div');
      tsEl.id = 'quotaUpdatedAt';
      tsEl.style.cssText = 'font-size:10px;color:var(--xmuted);margin-top:6px;';
      document.getElementById('quotaPanel')?.appendChild(tsEl);
    }
    tsEl.textContent = `Updated ${formatRelativeTime(quota.updatedAt)}`;
  }
}

function buildQuotaBars() { renderQuotaBars(window.QUOTA); }

// ── Live quota polling ────────────────────────────────────────

async function pollQuota() {
  try {
    const res  = await fetch('/api/quota');
    const json = await res.json();
    if (json.ok && json.quota) {
      window.QUOTA = json.quota;
      renderQuotaBars(json.quota);
    }
  } catch { /* silent */ }
}

setInterval(pollQuota, QUOTA_POLL_MS);

// ── Sort cards ────────────────────────────────────────────────

const SORT_KEY = 'pb_sort';

function sortCards(by) {
  const grid  = document.getElementById('propGrid');
  if (!grid) return;
  const cards = [...grid.querySelectorAll('.prop-card')];

  cards.sort((a, b) => {
    if (by === 'active') return parseInt(b.dataset.active || 0) - parseInt(a.dataset.active || 0);
    if (by === 'views')  return parseInt(b.dataset.views  || 0) - parseInt(a.dataset.views  || 0);
    if (by === 'name') {
      const an = (a.dataset.name || '').toLowerCase();
      const bn = (b.dataset.name || '').toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    }
    return 0;
  });

  // Re-order DOM nodes
  cards.forEach(c => grid.appendChild(c));

  // Update active button
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === by);
  });

  localStorage.setItem(SORT_KEY, by);
}

document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => sortCards(btn.dataset.sort));
});

// Apply saved sort on load
const savedSort = localStorage.getItem(SORT_KEY);
if (savedSort) sortCards(savedSort);

// ── Card expand (click → load detail) ────────────────────────

const detailCache = {}; // pid → data, to avoid re-fetching

function flagEmoji(id) {
  if (!id || id.length !== 2) return '';
  return String.fromCodePoint(...[...id.toUpperCase()].map(c => 0x1F1A5 + c.charCodeAt(0)));
}

function escHtmlMain(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDetail(pid, data) {
  const el = document.getElementById(`cd-${pid}`);
  if (!el) return;
  const max = arr => Math.max(1, ...arr.map(r => r.users ?? r.views ?? r.count));

  const rows = (arr, field, labelFn) =>
    arr.slice(0, 5).map(r => {
      const val = r.users ?? r.views ?? r.count ?? 0;
      const pct = Math.round(val / max(arr) * 100);
      return `
        <div class="cd-row">
          <span style="flex-shrink:0;font-size:13px">${labelFn(r)}</span>
          <div class="cd-bar-wrap"><div class="cd-bar" style="width:${pct}%"></div></div>
          <span class="cd-num">${val}</span>
        </div>`;
    }).join('');

  const countriesHtml = data.countries?.length ? `
    <div class="cd-section">
      <div class="cd-title">Countries</div>
      ${rows(data.countries, 'users', r => `${flagEmoji(r.id)} ${escHtmlMain(r.name)}`)}
    </div>` : '';

  const eventsHtml = data.events?.length ? `
    <div class="cd-section">
      <div class="cd-title">Top Events</div>
      ${rows(data.events, 'users', r => escHtmlMain(r.name || '(unknown)'))}
    </div>` : '';

  const pagesHtml = data.pages?.length ? `
    <div class="cd-section">
      <div class="cd-title">Top Pages</div>
      ${data.pages.slice(0, 5).map(r => {
        const pct = Math.round(r.views / Math.max(1, ...data.pages.map(x => x.views)) * 100);
        return `
          <div class="cd-row">
            <span class="cd-page" title="${escHtmlMain(r.path)}">${escHtmlMain(r.path)}</span>
            <div class="cd-bar-wrap"><div class="cd-bar" style="width:${pct}%"></div></div>
            <span class="cd-num">${r.views}</span>
          </div>`;
      }).join('')}
    </div>` : '';

  const empty = !countriesHtml && !eventsHtml && !pagesHtml;
  el.innerHTML = empty
    ? '<div class="cd-loading" style="color:var(--xmuted)">No real-time data right now.</div>'
    : countriesHtml + eventsHtml + pagesHtml;
}

async function loadCardDetail(pid) {
  const detailEl = document.getElementById(`cd-${pid}`);
  if (!detailEl) return;

  if (detailCache[pid]) {
    // Already fetched — just re-render
    renderDetail(pid, detailCache[pid]);
    return;
  }

  // Show spinner (already in DOM from template)
  try {
    const res  = await fetch(`/api/property-detail/${pid}`);
    const json = await res.json();
    if (json.ok) {
      detailCache[pid] = json;
      renderDetail(pid, json);
    } else {
      detailEl.textContent = json.error || 'Error loading data';
      detailEl.style.color = 'var(--danger)';
      detailEl.className = 'cd-loading';
    }
  } catch {
    detailEl.innerHTML = '<div class="cd-loading" style="color:var(--danger)">Network error</div>';
  }
}

document.querySelectorAll('.prop-card[data-pid]').forEach(card => {
  card.addEventListener('click', function() {
    const pid = this.dataset.pid;
    const detailEl = document.getElementById(`cd-${pid}`);
    if (!detailEl) return;
    const isOpen = detailEl.classList.toggle('is-open');
    if (isOpen) loadCardDetail(pid);
  });
});

// ── Privacy blur ──────────────────────────────────────────────

const privacyBtn = document.getElementById('privacyBtn');
if (privacyBtn) {
  const saved = localStorage.getItem('pb_privacy') === '1';
  if (saved) { document.body.classList.add('privacy-blur'); privacyBtn.classList.add('is-active'); }

  privacyBtn.addEventListener('click', () => {
    const on = document.body.classList.toggle('privacy-blur');
    privacyBtn.classList.toggle('is-active', on);
    localStorage.setItem('pb_privacy', on ? '1' : '0');
  });
}

// ── Auto-refresh toggle ───────────────────────────────────────

let countdownTimer = null;
let countdownSecs  = REFRESH_INTERVAL_MS / 1000;

const toggleEl    = document.getElementById('autoRefreshToggle');
const countdownEl = document.getElementById('refreshCountdown');

function formatCountdown(secs) {
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function startCountdown() {
  countdownSecs = REFRESH_INTERVAL_MS / 1000;
  if (countdownEl) countdownEl.textContent = formatCountdown(countdownSecs);
  countdownTimer = setInterval(() => {
    countdownSecs--;
    if (countdownEl) countdownEl.textContent = formatCountdown(countdownSecs);
    if (countdownSecs <= 0) { clearInterval(countdownTimer); location.reload(); }
  }, 1000);
}

function stopCountdown() {
  clearInterval(countdownTimer);
  if (countdownEl) countdownEl.textContent = '—';
}

function setAutoRefresh(on) {
  if (on) { toggleEl && toggleEl.classList.add('is-on'); startCountdown(); }
  else    { toggleEl && toggleEl.classList.remove('is-on'); stopCountdown(); }
  localStorage.setItem('pb_autoRefresh', on ? '1' : '0');
}

if (toggleEl) {
  const saved = localStorage.getItem('pb_autoRefresh') === '1';
  setAutoRefresh(saved);
  toggleEl.addEventListener('click', () => setAutoRefresh(!toggleEl.classList.contains('is-on')));
}

// ── Reload button spinner ─────────────────────────────────────

const reloadIcon = document.getElementById('reloadIcon');
const reloadBtn  = document.getElementById('reloadBtn');
if (reloadBtn && reloadIcon) {
  reloadBtn.addEventListener('click', () => reloadIcon.classList.add('spinning'));
}

// ── Cache refresh button ──────────────────────────────────────

const refreshCacheBtn = document.getElementById('refreshCacheBtn');
if (refreshCacheBtn) {
  refreshCacheBtn.addEventListener('click', async () => {
    refreshCacheBtn.textContent = 'Refreshing…';
    refreshCacheBtn.disabled = true;
    try {
      const res  = await fetch('/api/refresh-cache', { method: 'POST' });
      const json = await res.json();
      if (json.ok) {
        refreshCacheBtn.textContent = `✓ ${json.count} properties`;
        setTimeout(() => location.reload(), 800);
      } else {
        refreshCacheBtn.textContent = 'Error — retry?';
        refreshCacheBtn.disabled = false;
      }
    } catch {
      refreshCacheBtn.textContent = 'Network error';
      refreshCacheBtn.disabled = false;
    }
  });
}

// ── Cache age footer ──────────────────────────────────────────

const cacheAgeEl = document.getElementById('jsCacheAge');
if (cacheAgeEl && window.CACHE_AGE) {
  cacheAgeEl.title = formatISO(window.CACHE_AGE);
  cacheAgeEl.textContent = formatRelativeTime(window.CACHE_AGE);
}

// ── Favicon error fallback ────────────────────────────────────

document.querySelectorAll('.prop-favicon').forEach(img => {
  if (img.complete && img.naturalWidth === 0) {
    img.style.display = 'none';
    const fb = img.nextElementSibling;
    if (fb) fb.style.display = 'flex';
  }
});

// ── Init ──────────────────────────────────────────────────────

window.addEventListener('load', () => {
  revealCards();
  animateStatNumbers();
  buildQuotaBars();
});

// ── Toast notification system ──────────────────────────────────

function showToast(msg) {
  let container = document.getElementById('pbToast');
  if (!container) {
    container = document.createElement('div');
    container.id = 'pbToast';
    container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.style.cssText = 'background:var(--card-bg,#fff);border:1px solid var(--card-bdr,#e9e5df);border-radius:8px;padding:10px 16px;font-size:12px;font-weight:600;color:var(--text,#18181c);box-shadow:0 4px 20px rgba(0,0,0,.12);display:flex;align-items:center;gap:8px;opacity:0;transform:translateY(8px);transition:opacity 250ms cubic-bezier(0.215,0.61,0.355,1),transform 250ms cubic-bezier(0.215,0.61,0.355,1)';
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

// ── Keyboard shortcuts (dashboard) ─────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  switch (e.key.toLowerCase()) {
    case 'r':
      e.preventDefault();
      const reloadBtn = document.getElementById('reloadBtn');
      if (reloadBtn) { reloadBtn.click(); showToast('Reloading…'); }
      break;
    case 'p':
      e.preventDefault();
      const privBtn = document.getElementById('privacyBtn');
      if (privBtn) privBtn.click();
      break;
    case 'a':
      e.preventDefault();
      const toggleEl2 = document.getElementById('autoRefreshToggle');
      if (toggleEl2) toggleEl2.click();
      break;
    case 'g':
      e.preventDefault();
      window.location.href = '/globe';
      break;
    case '?':
      e.preventDefault();
      showToast('R Reload · P Privacy · A Auto-refresh · G Globe · 1-3 Sort');
      break;
  }
});

// ── Sort via number keys ───────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '1') sortCards('active');
  if (e.key === '2') sortCards('views');
  if (e.key === '3') sortCards('name');
});
