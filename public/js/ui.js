/**
 * ملاحظاتي — أدوات الواجهة المشتركة (ثيم، توست، تنسيق، أيقونات)
 */

const UI = (() => {
  /* ---------------------------------- الثيم --------------------------------- */
  const THEME_KEY = 'mynotes:theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* التخزين غير متاح */
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#0b1020' : '#4f46e5';
  }

  function initTheme() {
    let stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      /* ignore */
    }
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(stored || (prefersDark ? 'dark' : 'light'));
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    return next;
  }

  /* --------------------------------- التوست -------------------------------- */
  const ICONS = {
    success: '<svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    error: '<svg class="icon icon-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>',
    warning: '<svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M12 9v4M12 17v.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    info: '<svg class="icon icon-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/></svg>',
  };

  function toast(message, type = 'info', ms = 3000) {
    const stack = document.getElementById('toasts');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${ICONS[type] || ICONS.info}<span></span>`;
    el.lastElementChild.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add('hide');
      setTimeout(() => el.remove(), 280);
    }, ms);
    return el;
  }

  /* -------------------------------- الأدوات -------------------------------- */
  const escapeHtml = (str) =>
    String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));

  function highlight(text, query) {
    const safe = escapeHtml(text);
    const q = String(query || '').trim();
    if (!q) return safe;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
  }

  function formatRelative(ts) {
    if (!ts) return '';
    const diff = Date.now() - Number(ts);
    const min = 60000;
    const hour = 3600000;
    const day = 86400000;
    if (diff < min) return 'الآن';
    if (diff < hour) return `منذ ${Math.floor(diff / min)} دقيقة`;
    if (diff < day) return `منذ ${Math.floor(diff / hour)} ساعة`;
    if (diff < day * 7) return `منذ ${Math.floor(diff / day)} يوم`;
    try {
      return new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ts));
    } catch {
      return new Date(ts).toLocaleDateString('ar');
    }
  }

  function debounce(fn, wait = 300) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function initial(name) {
    const clean = String(name || '?').trim();
    return clean ? clean[0].toUpperCase() : '?';
  }

  /* ------------------------------- نافذة حوارية ------------------------------ */
  function confirmDialog({ title = 'تأكيد', message = '', confirmText = 'تأكيد', cancelText = 'إلغاء', danger = true }) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-backdrop';
      back.innerHTML = `
        <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="dlgTitle" style="width:min(430px,100%)">
          <div class="modal-head"><h3 id="dlgTitle"></h3>
            <button class="btn btn-ghost btn-icon" data-close aria-label="إغلاق">
              <svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="modal-body"><p style="color:var(--text-muted);font-size:15px"></p></div>
          <div class="modal-foot">
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok></button>
            <button class="btn" data-cancel></button>
          </div>
        </div>`;
      back.querySelector('#dlgTitle').textContent = title;
      back.querySelector('.modal-body p').textContent = message;
      const okBtn = back.querySelector('[data-ok]');
      const cancelBtn = back.querySelector('[data-cancel]');
      okBtn.textContent = confirmText;
      cancelBtn.textContent = cancelText;

      const close = (val) => {
        back.remove();
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter') close(true);
      };

      okBtn.addEventListener('click', () => close(true));
      cancelBtn.addEventListener('click', () => close(false));
      back.querySelector('[data-close]').addEventListener('click', () => close(false));
      back.addEventListener('mousedown', (e) => {
        if (e.target === back) close(false);
      });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(back);
      cancelBtn.focus();
    });
  }

  /* --------------------------- كشف الاتصال بالخادم --------------------------- */
  function watchConnection() {
    const show = () => toast('لا يوجد اتصال بالإنترنت — التغييرات لن تُحفظ', 'warning', 5000);
    const hide = () => toast('عاد الاتصال بالإنترنت', 'success');
    let online = navigator.onLine;
    window.addEventListener('online', () => {
      if (!online) hide();
      online = true;
    });
    window.addEventListener('offline', () => {
      show();
      online = false;
    });
  }

  initTheme();

  return {
    initTheme,
    toggleTheme,
    getTheme: () => document.documentElement.getAttribute('data-theme'),
    toast,
    escapeHtml,
    highlight,
    formatRelative,
    debounce,
    initial,
    confirmDialog,
    watchConnection,
  };
})();
