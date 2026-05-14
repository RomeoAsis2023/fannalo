(function() {
  if (window.__preloaded) return;
  window.__preloaded = true;
  var base = (function() {
    var s = document.currentScript;
    if (!s) {
      s = document.querySelector('script[src*="preload.js"]');
    }
    return s ? s.src.replace(/core\/preload\.js.*$/, '') : '../assets/js/';
  })();
  var scripts = [
    base + 'core/db.js', base + 'core/p2p.js', base + 'core/auth.js', base + 'core/wallet.js',
    base + 'core/torrent.js', base + 'core/superpeer.js',
    base + 'core/chat.js', base + 'core/video.js', base + 'core/live.js',
    base + 'features/feed.js', base + 'features/profile.js', base + 'features/notifications.js',
    base + 'features/earnings.js', base + 'features/events.js', base + 'features/analytics.js',
    base + 'features/stories.js', base + 'admin/dashboard.js'
  ];
  var resolve;
  window.__preloadedDone = new Promise(function(r) { resolve = r; });
  function load(i) {
    if (i >= scripts.length) { resolve(); return; }
    var el = document.createElement('script');
    el.src = scripts[i];
    el.onload = function() { load(i + 1); };
    el.onerror = function() { console.warn('Failed to load ' + scripts[i]); load(i + 1); };
    document.head.appendChild(el);
  }
  load(0);
})();
