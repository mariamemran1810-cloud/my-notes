/**
 * ملاحظاتي — منطق صفحة الدخول برمز GitHub (نسخة Pages)
 * يتحقق من الرمز، ينشئ المستودع عند أول دخول، ثم ينقل إلى التطبيق.
 */

(() => {
  'use strict';

  const form = document.getElementById('loginForm');
  if (!form) return;

  const tokenInput = document.getElementById('token');
  const tokenError = document.getElementById('tokenError');
  const formAlert = document.getElementById('formAlert');
  const submitBtn = document.getElementById('submitBtn');
  const remember = document.getElementById('remember');

  document.getElementById('themeBtn')?.addEventListener('click', () => UI.toggleTheme());

  /* ---------------------------- إظهار/إخفاء الرمز --------------------------- */
  const pwToggle = document.getElementById('pwToggle');
  pwToggle?.addEventListener('click', () => {
    const showing = tokenInput.type === 'text';
    tokenInput.type = showing ? 'password' : 'text';
    pwToggle.classList.toggle('showing', !showing);
  });

  /* -------------------------------- أدوات --------------------------------- */
  function setError(message) {
    tokenError.textContent = message || '';
    if (message) tokenInput.setAttribute('aria-invalid', 'true');
    else tokenInput.removeAttribute('aria-invalid');
  }

  function showAlert(message) {
    if (!message) {
      formAlert.hidden = true;
      formAlert.textContent = '';
      return;
    }
    formAlert.hidden = false;
    formAlert.textContent = message;
  }

  // إذا كان هناك رمز محفوظ، ننتقل مباشرة إلى التطبيق
  if (GitHubNotes.getToken()) {
    window.location.replace('./app.html');
    return;
  }

  /* -------------------------------- الإرسال -------------------------------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showAlert('');
    setError('');

    const token = tokenInput.value.trim();
    if (!token) {
      setError('ألصق رمز الوصول الشخصي للمتابعة');
      return tokenInput.focus();
    }
    if (!/^(ghp_|gho_|ghu_|ghs_|github_pat_)/.test(token)) {
      setError('صيغة الرمز غير صحيحة — يجب أن يبدأ بـ ghp_ أو github_pat_');
      return tokenInput.focus();
    }

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn-label').textContent = 'جارٍ التحقق…';

    // نحفظ الرمز مؤقتًا حتى تتم عمليات API، ثم نحسم حفظه الدائم
    GitHubNotes.setToken(token, false);

    try {
      const user = await GitHubNotes.verify();
      await GitHubNotes.ensureRepo(user.login);

      // حفظ دائم حسب اختيار «تذكرني»
      GitHubNotes.setToken(token, remember.checked);

      UI.toast(`أهلًا ${user.name || user.login} 👋`, 'success');
      showAlert('تم التحقق بنجاح — جارٍ فتح ملاحظاتك…');
      setTimeout(() => {
        window.location.href = './app.html';
      }, 500);
    } catch (err) {
      GitHubNotes.clearToken();
      const msg = err && err.message ? err.message : 'تعذّر تسجيل الدخول';
      showAlert(msg);
      UI.toast(msg, 'error');
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
      submitBtn.querySelector('.btn-label').textContent = 'دخول إلى ملاحظاتي';
    }
  });

  // تنظيف الخطأ عند الكتابة
  tokenInput.addEventListener('input', () => setError(''));

  UI.watchConnection();
})();
