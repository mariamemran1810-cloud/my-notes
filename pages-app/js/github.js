/**
 * ملاحظاتي — عميل GitHub API كقاعدة بيانات (نسخة GitHub Pages)
 *
 * كيف تعمل؟
 *   كل مستخدم يدخل «رمز وصول شخصي» (Personal Access Token) خاصًا به.
 *   التطبيق ينشئ له مستودعًا خاصًا اسمه mynotes-data تلقائيًا، ويخزّن كل
 *   الملاحظات في ملف notes.json واحد داخله عبر Contents API.
 *   العزل يفرضه GitHub نفسه: رمز المستخدم لا يصل إلا إلى مستودعاته هو.
 *
 * الرمز يُخزَّن في متصفح المستخدم فقط (sessionStorage دائمًا،
 * وlocalStorage اختياريًا عند «تذكرني») — ولا يُرسل إلى أي خادم وسيط.
 */

const GitHubNotes = (() => {
  // العنوان الأساسي — يقبل تجاوزًا عبر ?api=... للاختبار المحلي فقط (شفاف في الإنتاج)
  // التجاوز يُحفظ في sessionStorage حتى يبقى فعّالًا بعد الانتقال بين الصفحات
  const API = (() => {
    const override = new URLSearchParams(location.search).get('api');
    if (override) {
      try {
        sessionStorage.setItem('mynotes:api-override', override);
      } catch {
        /* ignore */
      }
      return override;
    }
    try {
      return sessionStorage.getItem('mynotes:api-override') || 'https://api.github.com';
    } catch {
      return 'https://api.github.com';
    }
  })();
  const REPO = 'mynotes-data';
  const FILE = 'notes.json';
  const LS_KEY = 'mynotes:gh-token';
  const SS_KEY = 'mynotes:gh-token-session';

  /* ------------------------------ تخزين الرمز ------------------------------ */
  function getToken() {
    try {
      return sessionStorage.getItem(SS_KEY) || localStorage.getItem(LS_KEY) || null;
    } catch {
      return null;
    }
  }

  function setToken(token, remember) {
    try {
      sessionStorage.setItem(SS_KEY, token);
      if (remember) localStorage.setItem(LS_KEY, token);
      else localStorage.removeItem(LS_KEY);
    } catch {
      /* التخزين غير متاح */
    }
  }

  function clearToken() {
    try {
      sessionStorage.removeItem(SS_KEY);
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------- أخطاء ------------------------------- */
  class GHError extends Error {
    constructor(message, status = 0) {
      super(message);
      this.status = status;
    }
  }

  /* ------------------------------ نداءات API ----------------------------- */
  async function api(path, { method = 'GET', body = null } = {}) {
    const token = getToken();
    if (!token) throw new GHError('لم يُدخَل رمز الوصول — سجّل الدخول أولًا', 401);

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body !== null) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body !== null ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GHError('تعذّر الاتصال بـ GitHub — تحقّق من اتصالك بالإنترنت', 0);
    }

    if (res.status === 204) return null;

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 401) throw new GHError('رمز الوصول غير صالح أو منتهي الصلاحية', 401);
      if (res.status === 403 || res.status === 429) {
        const msg = String(data.message || '');
        if (/rate limit/i.test(msg)) {
          throw new GHError('تجاوزت حد طلبات GitHub — انتظر دقائق ثم أعد المحاولة', 429);
        }
        throw new GHError('رفض GitHub الطلب — تأكّد أن الرمز يملك صلاحية repo', 403);
      }
      if (res.status === 404) throw new GHError('لم يُعثر على المورد المطلوب', 404);
      throw new GHError(data.message || `خطأ من GitHub (${res.status})`, res.status);
    }
    return data;
  }

  /* --------------------------- التحقق من الرمز --------------------------- */
  async function verify() {
    return api('/user'); // { login, name, email, ... }
  }

  /* ------------------- إنشاء المستودع الخاص (إن لم يوجد) ------------------ */
  async function ensureRepo(login) {
    try {
      await api('/user/repos', {
        method: 'POST',
        body: {
          name: REPO,
          description: 'ملاحظاتي — بيانات الملاحظات الشخصية',
          private: true,
          auto_init: true,
        },
      });
    } catch (e) {
      // 422 = المستودع موجود مسبقًا — تأكّد من ذلك ثم نكمل
      if (e.status !== 422) throw e;
      try {
        await api(`/repos/${login}/${REPO}`);
      } catch {
        throw new GHError(
          'تعذّر إنشاء مستودع البيانات — أنشئه يدويًا باسم mynotes-data (خاص) ثم أعد المحاولة',
          e.status
        );
      }
    }
  }

  /* ------------------------- ترميز Base64 آمن UTF-8 ----------------------- */
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64decode(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  /* ----------------------------- قراءة/حفظ ----------------------------- */
  let fileSha = null; // sha الحالي لملف notes.json (لحل تعارضات التحديث)

  /** يقرأ الملف؛ يُرجع null إذا لم يكن موجودًا بعد */
  async function load(login) {
    try {
      const file = await api(`/repos/${login}/${REPO}/contents/${FILE}`);
      fileSha = file.sha;
      return JSON.parse(b64decode(file.content));
    } catch (e) {
      if (e.status === 404) {
        fileSha = null;
        return null;
      }
      throw e;
    }
  }

  /** يحفظ الملف، مع إعادة محاولة واحدة عند تعارض الـ sha */
  async function save(login, data, message = 'تحديث الملاحظات', retry = true) {
    const payload = {
      message: `${message} — ${new Date().toISOString()}`,
      content: b64encode(JSON.stringify(data, null, 2)),
    };
    if (fileSha) payload.sha = fileSha;

    try {
      const res = await api(`/repos/${login}/${REPO}/contents/${FILE}`, {
        method: 'PUT',
        body: payload,
      });
      fileSha = res.content.sha;
    } catch (e) {
      // تعارض sha (409) أو رفض due to sha (422) — نعيد القرئية ثم الحفظ مرة واحدة
      if ((e.status === 409 || e.status === 422) && retry) {
        const file = await api(`/repos/${login}/${REPO}/contents/${FILE}`);
        fileSha = file.sha;
        return save(login, data, message, false);
      }
      throw e;
    }
  }

  /** بيانات ابتدائية فارغة عند أول دخول */
  function defaultData(user) {
    return {
      version: 1,
      profile: {
        name: user.name || user.login || '',
        email: user.email || '',
      },
      categories: [],
      notes: [],
    };
  }

  return {
    REPO,
    FILE,
    GHError,
    getToken,
    setToken,
    clearToken,
    verify,
    ensureRepo,
    load,
    save,
    defaultData,
    repoUrl: (login) => `https://github.com/${login}/${REPO}`,
  };
})();
