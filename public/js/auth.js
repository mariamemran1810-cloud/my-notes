/**
 * ملاحظاتي — منطق صفحات الدخول والتسجيل (login.html / register.html)
 */

(() => {
  const isRegister = Boolean(document.getElementById('registerForm'));
  const form = document.getElementById(isRegister ? 'registerForm' : 'loginForm');
  if (!form) return;

  const submitBtn = document.getElementById('submitBtn');
  const formAlert = document.getElementById('formAlert');
  const themeBtn = document.getElementById('themeBtn');

  themeBtn?.addEventListener('click', () => UI.toggleTheme());

  /* ----------------------------- إظهار/إخفاء المرور ---------------------------- */
  const pwToggle = document.getElementById('pwToggle');
  const password = document.getElementById('password');
  pwToggle?.addEventListener('click', () => {
    const showing = password.type === 'text';
    password.type = showing ? 'password' : 'text';
    pwToggle.classList.toggle('showing', !showing);
    pwToggle.setAttribute('aria-label', showing ? 'إظهار كلمة المرور' : 'إخفاء كلمة المرور');
  });

  /* -------------------------------- التحقق ---------------------------------- */
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function setError(id, message) {
    const input = document.getElementById(id);
    const box = document.getElementById(`${id}Error`);
    if (box) box.textContent = message || '';
    if (input) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    return !message;
  }

  function showAlert(message, type = 'error') {
    if (!formAlert) return;
    if (!message) {
      formAlert.hidden = true;
      formAlert.textContent = '';
      return;
    }
    formAlert.hidden = false;
    formAlert.classList.toggle('success', type === 'success');
    formAlert.textContent = message;
  }

  function validate() {
    let valid = true;
    const email = document.getElementById('email').value.trim();
    if (!email) valid = setError('email', 'أدخل بريدك الإلكتروني') && valid;
    else if (!emailRe.test(email)) valid = setError('email', 'صيغة البريد الإلكتروني غير صحيحة') && valid;
    else setError('email', '');

    const pw = document.getElementById('password').value;
    if (!pw) valid = setError('password', 'أدخل كلمة المرور') && valid;
    else if (isRegister && pw.length < 8) valid = setError('password', 'كلمة المرور يجب ألا تقل عن 8 أحرف') && valid;
    else setError('password', '');

    if (isRegister) {
      const name = document.getElementById('name').value.trim();
      if (name.length < 2) valid = setError('name', 'أدخل اسمك (حرفان على الأقل)') && valid;
      else setError('name', '');

      const pw2 = document.getElementById('password2').value;
      if (pw2 !== pw) valid = setError('password2', 'كلمتا المرور غير متطابقتين') && valid;
      else setError('password2', '');

      const terms = document.getElementById('terms');
      if (!terms.checked) {
        showAlert('يرجى الموافقة على الشروط للمتابعة');
        valid = false;
      }
    }
    return valid;
  }

  /* ------------------------------ قوة كلمة المرور ----------------------------- */
  const strength = document.getElementById('strength');
  const strengthLabel = document.getElementById('strengthLabel');
  const STRENGTH_TEXT = ['ضعيفة جدًا', 'ضعيفة', 'متوسطة', 'قوية', 'ممتازة'];

  password?.addEventListener('input', () => {
    if (!strength) return;
    const v = password.value;
    let score = 0;
    if (v.length >= 8) score++;
    if (v.length >= 12) score++;
    if (/[A-Zأ-ي]/.test(v) && /[a-zأ-ي]/.test(v)) score++;
    if (/\d/.test(v) && /[^A-Za-z0-9أ-ي]/.test(v)) score++;
    if (!v) score = 0;
    strength.dataset.score = String(Math.min(score, 4));
    strengthLabel.textContent = v ? `قوة كلمة المرور: ${STRENGTH_TEXT[Math.min(score, 4)]}` : '8 أحرف على الأقل';
  });

  /* --------------------------------- الإرسال -------------------------------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showAlert('');
    if (!validate()) {
      form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    const payload = {
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
    };
    if (isRegister) {
      payload.name = document.getElementById('name').value.trim();
    }

    try {
      const path = isRegister ? '/api/auth/register' : '/api/auth/login';
      const data = await API.post(path, payload);
      API.setCsrf(data.csrfToken);
      localStorage.setItem('mynotes:user', JSON.stringify(data.user));
      showAlert(isRegister ? 'تم إنشاء حسابك بنجاح…' : 'تم تسجيل الدخول…', 'success');
      UI.toast(isRegister ? 'مرحبًا بك في ملاحظاتي 🎉' : `أهلًا ${data.user.name} 👋`, 'success');
      // نعطي التوست لحظة ظهور ثم ننتقل للتطبيق
      setTimeout(() => {
        window.location.href = '/app';
      }, 450);
    } catch (err) {
      const map = {
        email: 'email',
        password: 'password',
        name: 'name',
        password2: 'password2',
      };
      if (err.field && map[err.field]) setError(map[err.field], err.message);
      else showAlert(err.message);
      UI.toast(err.message, 'error');
    } finally {
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
    }
  });

  // تنظيف الخطأ عند الكتابة
  form.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => setError(input.id, ''));
  });

  UI.watchConnection();
})();
