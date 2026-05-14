let _instance = null;

window.addEventListener('error', (e) => {
  console.error('[Fannalo]', e.error?.message || e.message);
  const toast = document.querySelector('.toast:last-child');
  if (!toast || !toast.textContent.includes(e.error?.message)) {
    showToast('Something went wrong. Check console.', 'error', 6000);
  }
});

window.addEventListener('offline', () => showToast('You are offline — changes will sync when reconnected', 'warning', 8000));
window.addEventListener('online', () => showToast('Back online!', 'success'));

export async function initApp() {
  if (_instance) return _instance;

  if (window.__preloadedDone) await window.__preloadedDone;

  const db = new window.FannaloDB();
  await db.init();

  const p2p = new window.FannaloP2P();
  await p2p.init('fannalo', 'global');

  const auth = new window.FannaloAuth(db, p2p);
  await auth.init();

  const wallet = new window.FannaloWallet(db, p2p);
  const torrent = new window.FannaloTorrent();
  await torrent.init();

  const superPeer = new window.FannaloSuperPeer(db, p2p);
  const feed = new window.FannaloFeed(db, p2p, auth, torrent);
  const profile = new window.FannaloProfile(db, p2p, auth);
  const notifications = new window.FannaloNotifications(db, p2p);
  const admin = new window.FannaloAdmin(db, p2p);
  const chat = new window.FannaloChat(db, p2p, auth);
  const video = new window.FannaloVideo(db, p2p, auth);
  const live = new window.FannaloLive(db, p2p, auth, torrent);
  const earnings = new window.FannaloEarnings(db, auth);
  const events = new window.FannaloEvents(db, auth);
  const analytics = new window.FannaloAnalytics(db, p2p, auth);
  const stories = new window.FannaloStories(db, auth);

  _instance = { db, p2p, auth, wallet, torrent, superPeer, feed, profile, notifications, admin, chat, video, live, earnings, events, analytics, stories };

  if (auth.authenticated && auth.currentUser) {
    notifications.listenForRealtime(auth.currentUser.id);
    chat.init();
    video.init();
    analytics.startRealtime();
  }

  p2p.on('peer:connect', () => updateP2PStatus());
  p2p.on('peer:disconnect', () => updateP2PStatus());

  return _instance;
}

function updateP2PStatus() {
  const indicators = document.querySelectorAll('.p2p-indicator');
  const count = window._instance?.p2p?.getPeerCount() || 0;
  indicators.forEach(el => {
    el.textContent = `🌐 ${count} peers`;
    el.style.color = count > 0 ? 'var(--success)' : 'var(--text-muted)';
  });
}

export async function requireAuth() {
  const { auth } = await initApp();
  if (!auth.authenticated) {
    const current = window.location.pathname.split('/').pop();
    if (current !== 'login.html' && current !== 'register.html' && current !== 'index.html') {
      const page = current || 'feed.html';
      window.location.href = `login.html?redirect=${encodeURIComponent(page)}`;
    }
    return false;
  }
  return true;
}

export function showToast(message, type = 'info', duration = 4000) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const colors = { success: 'var(--success)', error: 'var(--danger)', info: 'var(--accent)', warning: 'var(--warning)' };
  const icons = { success: '✓', error: '✕', info: '●', warning: '⚠' };
  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;width:100%;">
      <div style="width:8px;height:8px;border-radius:50%;background:${colors[type] || colors.info};flex-shrink:0;"></div>
      <span style="flex:1;font-size:14px;">${message}</span>
      <button onclick="this.closest('.toast').remove()" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer;">&times;</button>
    </div>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

export function showConfirm(message, confirmText = 'Confirm', cancelText = 'Cancel') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px;">
        <div class="modal-body" style="text-align:center;padding:32px 24px;">
          <div style="font-size:40px;margin-bottom:12px;">⚠️</div>
          <p style="font-size:15px;color:var(--text-primary);line-height:1.6;">${message}</p>
        </div>
        <div class="modal-footer" style="justify-content:center;">
          <button class="btn btn-secondary" id="confirmNo">${cancelText}</button>
          <button class="btn btn-primary" id="confirmYes" style="background:var(--danger);">${confirmText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('confirmYes').onclick = () => { overlay.remove(); resolve(true); };
    document.getElementById('confirmNo').onclick = () => { overlay.remove(); resolve(false); };
  });
}

export function showSkeleton(count = 3, height = '60px') {
  return Array.from({ length: count }, () =>
    `<div class="skeleton" style="width:100%;height:${height};margin-bottom:10px;border-radius:var(--radius-md);"></div>`
  ).join('');
}

export function showLoading(container, msg = 'Loading...') {
  container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:14px;">${msg}</div>`;
}

export function renderNavbar(currentUser) {
  if (document.querySelector('.navbar')) return;
  const nav = document.createElement('nav');
  nav.className = 'navbar';
  const page = getPageName();
  nav.innerHTML = `
    <div class="navbar-inner">
      <a href="../index.html" class="navbar-brand"><img src="../assets/img/full_logo.png" alt="Fannalo" style="height:24px;"></a>
      <div class="navbar-nav">
        <a href="feed.html" class="nav-link ${page === 'feed' ? 'active' : ''}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          Feed
        </a>
        <a href="notifications.html" class="nav-link ${page === 'notifications' ? 'active' : ''}" style="position:relative;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          <span id="notifBadge" style="display:none;position:absolute;top:2px;right:2px;width:8px;height:8px;border-radius:50%;background:var(--danger);"></span>
        </a>
        <span class="p2p-indicator" style="font-size:11px;color:var(--text-muted);margin:0 4px;"></span>
        ${currentUser ? `
          <a href="profile.html" class="nav-link ${page === 'profile' ? 'active' : ''}">
            <div class="avatar avatar-sm" style="background:var(--gradient-1);font-size:12px;width:28px;height:28px;">${escapeHtml((currentUser.displayName || '?')[0])}</div>
          </a>
        ` : `
          <a href="login.html" class="btn btn-primary btn-sm">Log In</a>
        `}
      </div>
    </div>
  `;
  document.body.prepend(nav);
}

function getPageName() {
  const path = window.location.pathname.split('/').pop() || '';
  return path.replace('.html', '');
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function renderSidebar(currentUser) {
  if (document.querySelector('.sidebar')) return;
  const page = getPageName();
  const isActive = (p) => page === p ? 'active' : '';
  const theme = localStorage.getItem('fannalo-theme') || 'light';
  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.innerHTML = `
    <div class="sidebar-nav">
      <a href="feed.html" class="sidebar-link ${isActive('feed')}">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></span>
        Feed
      </a>
      <a href="stories.html" class="sidebar-link ${isActive('stories')}">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
        Stories
      </a>
      <a href="profile.html" class="sidebar-link ${isActive('profile')}">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
        Profile
      </a>
      <a href="wallet.html" class="sidebar-link ${isActive('wallet')}">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></span>
        Wallet
      </a>
      <a href="chat.html" class="sidebar-link ${isActive('chat')}">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>
        Chat
      </a>
      <a href="notifications.html" class="sidebar-link ${isActive('notifications')}">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
        Notifications
      </a>
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;padding:16px 14px 8px;">Create</div>
      <a href="live.html" class="sidebar-link ${isActive('live')}">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></span>
        Go Live
      </a>
      <a href="events.html" class="sidebar-link ${isActive('events')}">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
        Events
      </a>
      <a href="calendar.html" class="sidebar-link ${isActive('calendar')}">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
        Calendar
      </a>
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;padding:16px 14px 8px;">Finance</div>
      <a href="earnings.html" class="sidebar-link ${isActive('earnings')}">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span>
        Earnings
      </a>
      <a href="withdraw.html" class="sidebar-link ${isActive('withdraw')}">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="7 17 2 12 7 7"/><polyline points="17 17 22 12 17 7"/></svg></span>
        Withdraw
      </a>
      <a href="analytics.html" class="sidebar-link ${isActive('analytics')}">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg></span>
        Analytics
      </a>
      ${currentUser?.role === 'admin' ? `
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;padding:16px 14px 8px;">Admin</div>
        <a href="admin/dashboard.html" class="sidebar-link ${isActive('dashboard')}">
          <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span>
          Dashboard
        </a>
      ` : ''}
      <div style="flex:1;"></div>
      <button id="themeToggle" class="sidebar-link" style="color:var(--text-secondary);">
        <span class="icon" id="themeIcon">${theme === 'light' ? '☀️' : '🌙'}</span>
        <span id="themeLabel">${theme === 'light' ? 'Light' : 'Dark'}</span>
      </button>
      <button id="logoutBtn" class="sidebar-link" style="color:var(--danger);">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span>
        Log Out
      </button>
    </div>
  `;
  document.body.appendChild(sidebar);
}

export function renderSidebarToggle() {
  if (document.querySelector('.sidebar-toggle')) return;
  if (!document.querySelector('.sidebar-backdrop')) {
    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    backdrop.onclick = () => { document.querySelector('.sidebar')?.classList.remove('open'); backdrop.classList.remove('show'); };
    document.body.appendChild(backdrop);
  }
  const btn = document.createElement('button');
  btn.className = 'btn btn-ghost btn-icon sidebar-toggle';
  btn.style.cssText = 'display:none;';
  btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
  btn.onclick = () => {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.querySelector('.sidebar-backdrop');
    sidebar?.classList.toggle('open');
    backdrop?.classList.toggle('show');
  };
  const navbar = document.querySelector('.navbar-inner');
  if (navbar) navbar.prepend(btn);
}

/* ========== PHASE 6 — Page Transition ========== */
export function initPageTransition() {
  let overlay = document.querySelector('.page-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'page-overlay active';
    document.body.prepend(overlay);
  } else {
    overlay.classList.add('active');
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.remove('active');
    });
  });
}

/* ========== PHASE 6 — Scroll Reveal ========== */
export function initScrollReveal() {
  const els = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');
  if (!els.length) return;
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  els.forEach(el => obs.observe(el));
}

/* ========== PHASE 6 — Theme Toggle ========== */
export function setupThemeToggle() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('fannalo-theme', next);
    const icon = document.getElementById('themeIcon');
    const label = document.getElementById('themeLabel');
    if (icon) icon.textContent = next === 'light' ? '☀️' : '🌙';
    if (label) label.textContent = next === 'light' ? 'Light' : 'Dark';
    showToast(next === 'light' ? 'Light mode enabled' : 'Dark mode enabled', 'info', 2000);
  });
}

/* ========== Init ========== */
export async function initPage(requiresAuth = true) {
  const app = await initApp();
  if (requiresAuth) {
    const ok = await requireAuth();
    if (!ok) return null;
  }

  initPageTransition();

  if (app.auth.currentUser) {
    renderNavbar(app.auth.currentUser);
    renderSidebar(app.auth.currentUser);
    renderSidebarToggle();
    updateP2PStatus();
  }

  const savedTheme = localStorage.getItem('fannalo-theme');
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    const ok = await showConfirm('Are you sure you want to log out?', 'Log Out');
    if (!ok) return;
    await app.auth.logout();
    window.location.href = '../index.html';
  });

  setupThemeToggle();
  requestAnimationFrame(() => initScrollReveal());

  return app;
}
