/**
 * ملاحظاتي — عميل الـ API المشترك
 * يرسل طلبات JSON مع رمز CSRF ويحوّل الأخطاء إلى رسائل عربية.
 */

const API = (() => {
  let csrfToken = null;

  function setCsrf(token) {
    if (token) csrfToken = token;
  }

  function getCsrf() {
    return csrfToken;
  }

  class ApiError extends Error {
    constructor(message, status = 0, field = null) {
      super(message);
      this.status = status;
      this.field = field;
    }
  }

  async function request(path, { method = 'GET', body = null } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== null) headers['Content-Type'] = 'application/json';
    if (!['GET', 'HEAD'].includes(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;

    let res;
    try {
      res = await fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        body: body !== null ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('تعذّر الاتصال بالخادم، تحقّق من اتصالك بالإنترنت', 0);
    }

    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await res.json().catch(() => ({})) : {};

    if (!res.ok || data.ok === false) {
      if (data.csrfToken) setCsrf(data.csrfToken);
      throw new ApiError(data.error || `حدث خطأ (${res.status})`, res.status, data.field || null);
    }

    if (data.csrfToken) setCsrf(data.csrfToken);
    return data;
  }

  return {
    setCsrf,
    getCsrf,
    ApiError,
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body: body ?? {} }),
    patch: (path, body) => request(path, { method: 'PATCH', body: body ?? {} }),
    del: (path) => request(path, { method: 'DELETE' }),
    request,
  };
})();
