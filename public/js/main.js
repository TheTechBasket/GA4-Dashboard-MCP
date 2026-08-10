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
const visitorInsightCache = {}; // `${pid}:${range}` → aggregate visitor intent data

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

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins < 60) return secs ? `${mins}m ${secs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function formatGaDate(value) {
  const raw = String(value || '');
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw || '—';
}

function renderPersonaSection(pid) {
  return `
    <div class="cd-section persona-section" id="persona-${pid}">
      <div class="persona-head">
        <div class="cd-title" style="margin:0">Visitor intent</div>
        <div class="persona-range" aria-label="Visitor insight range">
          <button type="button" class="active" data-pid="${pid}" data-range="28d">28d</button>
          <button type="button" data-pid="${pid}" data-range="7d">7d</button>
          <button type="button" data-pid="${pid}" data-range="today">Today</button>
        </div>
      </div>
      <div class="persona-loading cd-loading">Loading aggregate visitor insights...</div>
    </div>`;
}

function renderDetail(pid, data) {
  const el = document.getElementById('cardModalBody');
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

  const liveBadge = '<span class="cd-live-badge"><span class="live-dot"></span>LIVE · 30 MIN</span>';

  const countriesHtml = data.countries?.length ? `
    <div class="cd-section">
      <div class="cd-title">Countries${liveBadge}</div>
      ${rows(data.countries, 'users', r => `${flagEmoji(r.id)} ${escHtmlMain(r.name)}`)}
    </div>` : '';

  const eventsHtml = data.events?.length ? `
    <div class="cd-section">
      <div class="cd-title">Top Events${liveBadge}</div>
      ${rows(data.events, 'users', r => escHtmlMain(r.name || '(unknown)'))}
    </div>` : '';

  const pagesHtml = data.pages?.length ? `
    <div class="cd-section">
      <div class="cd-title">Top Pages${liveBadge}</div>
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

  const personaHtml = renderPersonaSection(pid);
  const empty = !countriesHtml && !eventsHtml && !pagesHtml;
  el.innerHTML = empty
    ? '<div class="cd-loading" style="color:var(--xmuted)">No real-time data right now.</div>' + personaHtml
    : countriesHtml + eventsHtml + pagesHtml + personaHtml;
  wirePersonaRange(pid);
  loadVisitorInsights(pid, '28d');
}

function personaMetric(label, value) {
  return `
    <div class="persona-metric">
      <strong>${escHtmlMain(value)}</strong>
      <span>${escHtmlMain(label)}</span>
    </div>`;
}

function renderVisitorInsights(pid, data, range) {
  const target = document.getElementById(`persona-${pid}`);
  if (!target) return;
  target.querySelectorAll('.persona-range button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === range);
  });

  if (!data.ok || !Array.isArray(data.personas) || data.personas.length === 0) {
    const message = data.error || 'No aggregate visitor intent data for this range.';
    target.innerHTML = `
      <div class="persona-head">
        <div class="cd-title" style="margin:0">Visitor intent</div>
        <div class="persona-range" aria-label="Visitor insight range">
          <button type="button" data-pid="${pid}" data-range="28d" class="${range === '28d' ? 'active' : ''}">28d</button>
          <button type="button" data-pid="${pid}" data-range="7d" class="${range === '7d' ? 'active' : ''}">7d</button>
          <button type="button" data-pid="${pid}" data-range="today" class="${range === 'today' ? 'active' : ''}">Today</button>
        </div>
      </div>
      <div class="persona-note">${escHtmlMain(message)}</div>`;
    wirePersonaRange(pid);
    return;
  }

  const cards = data.personas.slice(0, 3).map((persona, idx) => {
    const topPages = (persona.topPages || []).slice(0, 4).map(page => `
      <div class="persona-list-row">
        <span title="${escHtmlMain(page.path)}" data-privacy>${escHtmlMain(page.path)}</span>
        <strong>${Number(page.views || 0).toLocaleString()} views</strong>
      </div>`).join('') || '<div class="persona-note">No page path breakdown available.</div>';

    const timeline = (persona.timeline || []).slice(-5).map(day => `
      <div class="persona-list-row">
        <span>${escHtmlMain(formatGaDate(day.date))}</span>
        <strong>${Number(day.activeUsers || 0).toLocaleString()} users · ${formatDuration(day.avgEngagementSeconds || 0)}</strong>
      </div>`).join('') || '<div class="persona-note">No timeline available.</div>';

    return `
      <article class="persona-card ${idx === 0 ? 'is-open' : ''}" data-persona-card>
        <div class="persona-card-main">
          <div>
            <div class="persona-name">${escHtmlMain(persona.label || 'Visitor segment')}</div>
            <div class="persona-intent">${escHtmlMain(persona.intent || 'Browsing')} · ${escHtmlMain(persona.channel || 'Unknown channel')}</div>
          </div>
          <div class="persona-note">${escHtmlMain(persona.visitType || 'Aggregate')}</div>
        </div>
        <div class="persona-metrics">
          ${personaMetric('users', Number(persona.activeUsers || 0).toLocaleString())}
          ${personaMetric('engagement', formatDuration(persona.avgEngagementSeconds || 0))}
          ${personaMetric('engaged', `${Number(persona.engagementRate || 0).toLocaleString()}%`)}
          ${personaMetric('sessions', Number(persona.sessions || 0).toLocaleString())}
          ${personaMetric('key events', Number(persona.keyEvents || 0).toLocaleString())}
        </div>
        <div class="persona-detail">
          <div>
            <div class="persona-mini-title">Page path history</div>
            ${topPages}
          </div>
          <div>
            <div class="persona-mini-title">Engagement timeline</div>
            ${timeline}
          </div>
        </div>
      </article>`;
  }).join('');

  target.innerHTML = `
    <div class="persona-head">
      <div>
        <div class="cd-title" style="margin:0">Visitor intent</div>
        <div class="persona-note">${escHtmlMain(data.note || 'Aggregate GA4 segment data.')} · reports data, not live</div>
      </div>
      <div class="persona-range" aria-label="Visitor insight range">
        <button type="button" data-pid="${pid}" data-range="28d" class="${range === '28d' ? 'active' : ''}">28d</button>
        <button type="button" data-pid="${pid}" data-range="7d" class="${range === '7d' ? 'active' : ''}">7d</button>
        <button type="button" data-pid="${pid}" data-range="today" class="${range === 'today' ? 'active' : ''}">Today</button>
      </div>
    </div>
    <div class="persona-grid">${cards}</div>
  `;
  wirePersonaRange(pid);
  target.querySelectorAll('[data-persona-card]').forEach(card => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('.persona-range')) return;
      card.classList.toggle('is-open');
    });
  });
}

function wirePersonaRange(pid) {
  const target = document.getElementById(`persona-${pid}`);
  if (!target) return;
  target.querySelectorAll('.persona-range button').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      loadVisitorInsights(btn.dataset.pid, btn.dataset.range);
    });
  });
}

async function loadVisitorInsights(pid, range = '28d') {
  const target = document.getElementById(`persona-${pid}`);
  if (!target) return;
  const cacheKey = `${pid}:${range}`;
  if (visitorInsightCache[cacheKey]) {
    renderVisitorInsights(pid, visitorInsightCache[cacheKey], range);
    return;
  }

  const loading = target.querySelector('.persona-loading');
  if (loading) loading.textContent = 'Loading aggregate visitor insights...';
  try {
    const res = await fetch(`/api/visitor-insights/${pid}?range=${encodeURIComponent(range)}`);
    const json = await res.json();
    visitorInsightCache[cacheKey] = json;
    renderVisitorInsights(pid, json, range);
  } catch {
    renderVisitorInsights(pid, { ok: false, error: 'Network error loading visitor insights.' }, range);
  }
}

async function loadCardDetail(pid) {
  const detailEl = document.getElementById('cardModalBody');
  if (!detailEl) return;

  if (detailCache[pid]) {
    // Already fetched — just re-render
    renderDetail(pid, detailCache[pid]);
    return;
  }

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

// ── Card detail modal ──────────────────────────────────────────
// One shared <dialog>, populated per-property on open — avoids stretching
// the grid the way an inline per-card expand used to.

const cardModal     = document.getElementById('cardModal');
const cardModalBody = document.getElementById('cardModalBody');

function openCardModal(pid) {
  const card = document.querySelector(`.prop-card[data-pid="${pid}"]`);
  if (!card || !cardModal) return;

  const name = card.dataset.name || '';
  const info = (typeof PAGE_DATA !== 'undefined' ? PAGE_DATA : []).find(p => String(p.propertyId) === String(pid));

  document.getElementById('cardModalName').textContent = name;
  document.getElementById('cardModalSub').textContent = info?.domain || `Property ${pid}`;
  const linkBtn = document.getElementById('cardModalLink');
  if (linkBtn) linkBtn.href = info?.dashboardUrl || '#';

  if (!detailCache[pid]) {
    cardModalBody.innerHTML = `
      <div class="cd-loading">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 700ms linear infinite">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        Loading…
      </div>`;
  }

  if (typeof cardModal.showModal === 'function') cardModal.showModal();
  loadCardDetail(pid);
}

document.querySelectorAll('.prop-actions-toggle').forEach(toggle => {
  toggle.addEventListener('click', event => {
    event.stopPropagation();
    const menu = document.getElementById(toggle.getAttribute('aria-controls'));
    if (!menu) return;
    const isOpen = !menu.hidden;
    menu.hidden = isOpen;
    toggle.setAttribute('aria-expanded', String(!isOpen));
  });
});

document.querySelectorAll('[data-card-action]').forEach(link => {
  link.addEventListener('click', event => event.stopPropagation());
});

document.querySelectorAll('.prop-card[data-pid]').forEach(card => {
  card.addEventListener('click', function() {
    openCardModal(this.dataset.pid);
  });
});

document.getElementById('cardModalClose')?.addEventListener('click', () => cardModal.close());
cardModal?.addEventListener('click', (e) => {
  if (e.target === cardModal) cardModal.close(); // click on backdrop
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
  if (countdownEl) countdownEl.textContent = '';
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

// ── Async Realtime Data Hydration ──────────────────────────────

async function hydrateRealtimeData() {
  try {
    const res = await fetch('/api/realtime-all');
    const json = await res.json();
    if (!json.ok || !Array.isArray(json.data)) return;

    let totalUsers = 0;
    let totalViews = 0;

    json.data.forEach(item => {
      totalUsers += item.activeUsers || 0;
      totalViews += item.pageViews || 0;

      const card = document.querySelector(`.prop-card[data-pid="${item.propertyId}"]`);
      if (!card) return;

      card.dataset.active = item.activeUsers || 0;
      card.dataset.views  = item.pageViews  || 0;
      if (item.activeUsers > 0) card.classList.add('has-users');
      if (item.error) card.classList.add('is-error');

      const statNums = card.querySelectorAll('.prop-stat-num');
      const activeEl = statNums[0];
      const viewsEl  = statNums[1];

      if (activeEl) {
        activeEl.dataset.target = item.activeUsers || 0;
        if (item.activeUsers > 0) activeEl.classList.add('green');
        countUp(activeEl, item.activeUsers || 0, 600);
      }
      if (viewsEl) {
        viewsEl.dataset.target = item.pageViews || 0;
        countUp(viewsEl, item.pageViews || 0, 600);
      }
    });

    const jsTotal = document.getElementById('jsTotal');
    const jsTotalViews = document.getElementById('jsTotalViews');
    if (jsTotal) countUp(jsTotal, totalUsers, 600);
    if (jsTotalViews) countUp(jsTotalViews, totalViews, 600);

    if (json.quota) {
      window.QUOTA = json.quota;
      renderQuotaBars(json.quota);
    }
  } catch { /* silent */ }
}

// ── Traffic Spike HUD Hydration ──────────────────────────────

async function fetchTrafficSpikes() {
  try {
    const res = await fetch('/api/spikes');
    const json = await res.json();

    document.querySelectorAll('.prop-alert').forEach(el => el.remove());

    if (!json.ok || !json.spikes || json.spikes.length === 0) {
      return;
    }

    json.spikes.forEach(s => {
      const card = document.querySelector(`.prop-card[data-pid="${s.propertyId}"]`);
      if (!card) return;
      const alert = document.createElement('button');
      alert.className = 'prop-alert';
      alert.type = 'button';
      alert.innerHTML = `
        <span class="prop-alert-title">${Number(s.activeUsers || 0).toLocaleString()} active · ${escHtmlMain(s.spikeMultiplier)}x normal</span>
        <span class="prop-alert-copy" data-privacy>${escHtmlMain(s.reasonSummary)}</span>
      `;
      alert.addEventListener('click', (event) => {
        event.stopPropagation();
        openCardModal(card.dataset.pid);
      });
      const stats = card.querySelector('.prop-stats');
      if (stats) stats.insertAdjacentElement('afterend', alert);
    });
  } catch { /* silent */ }
}

// ── Init ──────────────────────────────────────────────────────

window.addEventListener('load', () => {
  revealCards();
  animateStatNumbers();
  buildQuotaBars();
  hydrateRealtimeData();
  fetchTrafficSpikes();
});

// ── Toast notification system ──────────────────────────────────

function showToast(msg) {
  let container = document.getElementById('pbToast');
  if (!container) {
    container = document.createElement('div');
    container.id = 'pbToast';
    container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:40;display:flex;flex-direction:column;gap:8px';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.style.cssText = 'background:var(--card-bg,#fff);border:1px solid var(--card-bdr,#cccfd3);border-radius:var(--radius,2px);padding:10px 14px;font-size:12px;font-weight:600;color:var(--text,#3a3d43);box-shadow:rgba(111,123,144,0.1) 0 -2px 0 0 inset;display:flex;align-items:center;gap:8px;opacity:0;transform:translateY(8px);transition:opacity 250ms cubic-bezier(0.215,0.61,0.355,1),transform 250ms cubic-bezier(0.215,0.61,0.355,1)';
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
