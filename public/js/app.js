/**
 * ملاحظاتي — منطق لوحة التطبيق
 * تحميل البيانات · التصفية والبحث · المحرّر مع الحفظ التلقائي · التصنيفات · الإعدادات
 */

(() => {
  'use strict';

  /* ================================== الحالة ================================= */
  const state = {
    user: null,
    scope: 'all',
    category: 'all',
    q: '',
    sort: 'updated',
    view: localStorage.getItem('mynotes:view') || 'grid',
    notes: [],
    categories: [],
    stats: {},
    editing: null, // الملاحظة المفتوحة حاليًا
    draft: null,
    dirty: false,
    catMode: 'create', // create | edit
    catEditId: null,
    catColor: 'indigo',
    saveTimer: null,
  };

  const SCOPE_TITLES = {
    all: 'كل الملاحظات',
    pinned: 'المثبّتة',
    favorite: 'المفضلة',
    archived: 'الأرشيف',
    trash: 'سلة المهملات',
  };

  const SCOPE_SUBS = {
    all: 'ملاحظاتك النشطة مرتبة حسب آخر تحديث',
    pinned: 'ما ثبّته في الأعلى للوصول السريع',
    favorite: 'ملاحظاتك المميّزة بنجمة',
    archived: 'ما أنتهيته وأبقينته للرجوع لاحقًا',
    trash: 'تُحذف نهائيًا بعد 30 يومًا — يمكنك الاستعادة في أي وقت',
  };

  const EMPTY_TEXTS = {
    all: ['لا توجد ملاحظات بعد', 'أنشئ أول ملاحظة وابدأ في ترتيب أفكارك.'],
    pinned: ['لا توجد ملاحظات مثبّتة', 'ثبّت أي ملاحظة لتظهر هنا في الأعلى.'],
    favorite: ['لا توجد ملاحظات مفضلة', 'اضغط النجمة على أي ملاحظة لتضيفها إلى المفضلة.'],
    archived: ['الأرشفة فارغة', 'عندما تنتهي من ملاحظة، أرشفها لتبقى محفوظة هنا.'],
    trash: ['سلة المهملات فارغة', 'الملاحظات المحذوفة تظهر هنا قبل حذفها نهائيًا.'],
  };

  const NOTE_COLORS = [
    ['slate', 'رمادي'],
    ['indigo', 'نيلي'],
    ['violet', 'بنفسجي'],
    ['emerald', 'أخضر'],
    ['amber', 'كهرماني'],
    ['rose', 'وردي'],
    ['sky', 'أزرق'],
  ];

  const COLOR_VAR = (c) => `var(--note-${c || 'slate'})`;

  /* ================================ العناصر ================================= */
  const $ = (id) => document.getElementById(id);
  const els = {
    sidebar: $('sidebar'),
    sideScrim: $('sideScrim'),
    burger: $('burger'),
    sideClose: $('sideClose'),
    notesGrid: $('notesGrid'),
    loading: $('loadingState'),
    empty: $('emptyState'),
    emptyTitle: $('emptyTitle'),
    emptyText: $('emptyText'),
    emptyAction: $('emptyAction'),
    search: $('searchInput'),
    searchClear: $('searchClear'),
    sort: $('sortSelect'),
    scopeTitle: $('scopeTitle'),
    scopeSub: $('scopeSub'),
    catList: $('catList'),
    footCount: $('footCount'),
    editorBackdrop: $('editorBackdrop'),
    catBackdrop: $('catBackdrop'),
    settingsBackdrop: $('settingsBackdrop'),
  };

  /* ================================= أدوات ================================== */
  const esc = UI.escapeHtml;
  const rel = UI.formatRelative;

  function setStats(stats) {
    if (!stats) return;
    state.stats = stats;
    document.querySelectorAll('[data-count]').forEach((el) => {
      const key = el.dataset.count;
      el.textContent = stats[key] ?? 0;
    });
  }

  function openModal(el) {
    el.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal(el) {
    el.hidden = true;
    if (
      els.editorBackdrop.hidden &&
      els.catBackdrop.hidden &&
      els.settingsBackdrop.hidden
    ) {
      document.body.style.overflow = '';
    }
  }

  /* ============================== جلب البيانات ============================== */
  async function fetchNotes({ silent = false } = {}) {
    if (!silent) {
      els.loading.hidden = false;
      els.notesGrid.hidden = true;
      els.empty.hidden = true;
    }

    try {
      const params = new URLSearchParams({
        scope: state.scope,
        sort: state.sort,
      });
      if (state.q) params.set('q', state.q);
      if (state.category !== 'all') params.set('category', state.category);

      const data = await API.get(`/api/notes?${params}`);
      state.notes = data.notes || [];
      setStats(data.stats);
      renderNotes();
      renderScopeHead();
    } catch (err) {
      els.loading.hidden = true;
      if (err.status === 401) return (window.location.href = '/login');
      UI.toast(err.message, 'error');
    }
  }

  async function fetchCategories() {
    try {
      const data = await API.get('/api/categories');
      state.categories = data.categories || [];
      renderCategories();
      renderCategoryOptions();
    } catch (err) {
      if (err.status === 401) return (window.location.href = '/login');
    }
  }

  async function loadMe() {
    try {
      const data = await API.get('/api/auth/me');
      API.setCsrf(data.csrfToken);
      state.user = data.user;
      setStats(data.stats);
      renderUser();
    } catch {
      window.location.href = '/login';
      throw new Error('unauthenticated');
    }
  }

  /* ================================ العرض ================================== */
  function renderUser() {
    if (!state.user) return;
    const initial = UI.initial(state.user.name);
    $('userAvatar').textContent = initial;
    $('userName').textContent = state.user.name;
    $('userEmail').textContent = state.user.email;
    $('ddName').textContent = state.user.name;
    $('ddEmail').textContent = state.user.email;
    $('setName').value = state.user.name;
    $('setEmail').value = state.user.email;
    document.title = `${state.user.name} — ملاحظاتي`;
  }

  function renderScopeHead() {
    const title =
      state.category !== 'all'
        ? state.categories.find((c) => String(c.id) === String(state.category))?.name || 'تصنيف'
        : SCOPE_TITLES[state.scope];

    els.scopeTitle.textContent = title;

    const total = state.notes.length;
    let sub = SCOPE_SUBS[state.scope];
    if (state.q) sub = `${total} نتيجة للبحث عن «${state.q}»`;
    else if (state.category !== 'all') sub = `${total} ملاحظة في هذا التصنيف`;
    else if (total) sub = `${total} ملاحظة · ${sub}`;
    els.scopeSub.textContent = sub;

    els.footCount.textContent = `إجمالي الملاحظات: ${state.stats.total ?? 0} · المعروضة الآن: ${total}`;
  }

  function noteCard(n, index) {
    const hasContent = n.content && n.content.trim();
    const title = esc(n.title || 'بدون عنوان');
    const q = state.q;
    const inTrash = !!n.deleted_at;

    const actions = inTrash
      ? `
      <button class="note-act" data-act="restore" title="استعادة" aria-label="استعادة">
        <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
      </button>
      <button class="note-act danger" data-act="purge" title="حذف نهائي" aria-label="حذف نهائي">
        <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/></svg>
      </button>`
      : `
      <button class="note-act ${n.pinned ? 'on' : ''}" data-act="pin" title="${n.pinned ? 'إلغاء التثبيت' : 'تثبيت'}" aria-pressed="${!!n.pinned}">
        <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M12 17v5M9 3h6l-1 8 3 3H7l3-3z"/></svg>
      </button>
      <button class="note-act ${n.favorite ? 'on' : ''}" data-act="fav" title="${n.favorite ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}" aria-pressed="${!!n.favorite}">
        <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg>
      </button>
      <button class="note-act" data-act="archive" title="${n.archived ? 'إلغاء الأرشفة' : 'أرشفة'}" aria-pressed="${!!n.archived}">
        <svg class="icon icon-sm" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/></svg>
      </button>
      <button class="note-act danger" data-act="delete" title="نقل إلى السلة" aria-label="حذف">
        <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/></svg>
      </button>`;

    return `
      <article class="note ${n.pinned ? 'pinned' : ''}" data-id="${n.id}" tabindex="0"
        style="--accent:${COLOR_VAR(n.color)}; animation-delay:${Math.min(index * 35, 350)}ms">
        <div class="note-top">
          <h3 class="note-title">${q ? UI.highlight(n.title || 'بدون عنوان', q) : title}</h3>
          <div class="note-actions">${actions}</div>
        </div>
        <p class="note-body ${hasContent ? '' : 'blank'}">${
          hasContent
            ? q
              ? UI.highlight(n.content.trim(), q)
              : esc(n.content.trim())
            : '— بدون نص —'
        }</p>
        <div class="note-foot">
          ${
            n.category_name
              ? `<span class="note-cat"><span class="dot" style="--c:${COLOR_VAR(n.category_color)}"></span>${esc(
                  n.category_name
                )}</span>`
              : ''
          }
          ${n.favorite ? '<span class="note-fav" title="مفضلة"><svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg></span>' : ''}
          <span class="note-time">${rel(n.updated_at)}</span>
        </div>
      </article>`;
  }

  function renderNotes() {
    els.loading.hidden = true;

    if (!state.notes.length) {
      els.notesGrid.hidden = true;
      els.empty.hidden = false;
      const [title, text] = state.q
        ? ['لا نتائج', `لم نعثر على ملاحظات تطابق «${state.q}». جرّب كلمات أخرى.`]
        : EMPTY_TEXTS[state.scope];
      els.emptyTitle.textContent = title;
      els.emptyText.textContent = text;
      els.emptyAction.hidden = state.scope === 'trash' || !!state.q;
      return;
    }

    els.empty.hidden = true;
    els.notesGrid.hidden = false;
    els.notesGrid.className = `notes-grid ${state.view === 'list' ? 'list' : ''}`;
    els.notesGrid.innerHTML = state.notes.map(noteCard).join('');
  }

  function renderCategories() {
    const active = state.category;
    const html = state.categories.length
      ? state.categories
          .map(
            (c) => `
        <button class="cat-item ${String(active) === String(c.id) ? 'active' : ''}" data-cat="${c.id}">
          <span class="dot" style="--c:${COLOR_VAR(c.color)}"></span>
          <span class="cat-name">${esc(c.name)}</span>
          <span class="count">${c.notes_count || 0}</span>
          <span class="cat-menu-btn" role="button" tabindex="0" data-edit="${c.id}" title="تعديل التصنيف">
            <svg class="icon icon-sm" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg>
          </span>
        </button>`
          )
          .join('')
      : '<p class="cat-empty">لا توجد تصنيفات — أنشئ تصنيفك الأول.</p>';

    els.catList.innerHTML = html;
  }

  function renderCategoryOptions() {
    const sel = $('edCategory');
    const current = sel.value;
    sel.innerHTML =
      '<option value="">بدون تصنيف</option>' +
      state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    if (current) sel.value = current;
  }

  /* ================================ التصفية ================================ */
  function setScope(scope) {
    state.scope = scope;
    state.category = 'all';
    document.querySelectorAll('.nav-item[data-scope]').forEach((b) => {
      b.classList.toggle('active', b.dataset.scope === scope);
    });
    fetchNotes();
  }

  function setCategory(catId) {
    state.category = String(catId);
    state.scope = 'all';
    document.querySelectorAll('.nav-item[data-scope]').forEach((b) => b.classList.remove('active'));
    document.querySelector('.nav-item[data-scope="all"]')?.classList.add('active');
    renderCategories();
    fetchNotes();
    closeSidebar();
  }

  /* ================================ المحرّر ================================ */
  function renderColors(container, selected, onPick) {
    container.innerHTML = NOTE_COLORS.map(
      ([key, label]) => `
      <button type="button" class="color-chip" role="radio" data-color="${key}" aria-label="${label}"
        aria-checked="${key === selected}" style="--c:${COLOR_VAR(key)}"></button>`
    ).join('');
    container.querySelectorAll('.color-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        container.querySelectorAll('.color-chip').forEach((c) => c.setAttribute('aria-checked', 'false'));
        chip.setAttribute('aria-checked', 'true');
        onPick(chip.dataset.color);
      });
    });
  }

  function setSaveState(kind, text) {
    const el = $('saveState');
    el.className = `save-state ${kind}`;
    el.innerHTML = `<span class="dot-ok"></span> ${text}`;
  }

  function openEditor(note = null) {
    state.editing = note;
    state.dirty = false;
    renderCategoryOptions();

    $('editorTitle').textContent = note ? 'تعديل الملاحظة' : 'ملاحظة جديدة';
    $('edTitle').value = note ? note.title || '' : '';
    $('edContent').value = note ? note.content || '' : '';
    $('edCategory').value = note && note.category_id ? String(note.category_id) : '';
    $('edPin').setAttribute('aria-pressed', String(!!(note && note.pinned)));
    $('edFavorite').setAttribute('aria-pressed', String(!!(note && note.favorite)));
    $('edDelete').hidden = !note || !!note.deleted_at;

    const color = note ? note.color || 'slate' : 'slate';
    renderColors($('edColors'), color, (c) => {
      state.draft = { ...(state.draft || {}), color: c };
      markDirty();
    });
    state.draft = { color, pinned: !!(note && note.pinned), favorite: !!(note && note.favorite) };

    setSaveState('', note ? `آخر تحديث ${rel(note.updated_at)}` : 'جاهز للكتابة');
    openModal(els.editorBackdrop);
    setTimeout(() => (note ? $('edContent') : $('edTitle')).focus(), 60);
    autoGrow();
  }

  function closeEditor(force = false) {
    if (state.dirty && !force) {
      saveNote({ silent: true }).finally(() => closeModal(els.editorBackdrop));
      return;
    }
    closeModal(els.editorBackdrop);
    state.editing = null;
    state.dirty = false;
  }

  function markDirty() {
    state.dirty = true;
    setSaveState('dirty', 'تغييرات غير محفوظة');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveNote({ silent: true }), 900);
  }

  async function saveNote({ silent = false } = {}) {
    clearTimeout(state.saveTimer);
    const title = $('edTitle').value;
    const content = $('edContent').value;
    const categoryId = $('edCategory').value ? Number($('edCategory').value) : null;
    const payload = {
      title,
      content,
      categoryId,
      color: state.draft?.color || 'slate',
      pinned: $('edPin').getAttribute('aria-pressed') === 'true',
      favorite: $('edFavorite').getAttribute('aria-pressed') === 'true',
    };

    if (!title.trim() && !content.trim()) {
      state.dirty = false;
      setSaveState('', 'لا يوجد ما يُحفظ');
      return null;
    }

    setSaveState('saving', 'جارٍ الحفظ…');

    try {
      let note;
      if (state.editing) {
        const data = await API.patch(`/api/notes/${state.editing.id}`, payload);
        note = data.note;
        setStats(data.stats);
      } else {
        const data = await API.post('/api/notes', payload);
        note = data.note;
        state.editing = note;
        setStats(data.stats);
        $('editorTitle').textContent = 'تعديل الملاحظة';
        $('edDelete').hidden = false;
      }
      state.dirty = false;
      setSaveState('', `تم الحفظ ${rel(note.updated_at)}`);
      if (!silent) UI.toast('تم حفظ الملاحظة', 'success');
      fetchNotes({ silent: true });
      fetchCategories();
      return note;
    } catch (err) {
      setSaveState('error', 'تعذّر الحفظ');
      if (!silent) UI.toast(err.message, 'error');
      else UI.toast(err.message, 'error');
      if (err.status === 401) window.location.href = '/login';
      return null;
    }
  }

  function autoGrow() {
    const ta = $('edContent');
    ta.style.height = 'auto';
    ta.style.height = Math.max(230, Math.min(ta.scrollHeight + 4, 420)) + 'px';
  }

  /* ============================ عمليات الملاحظات ============================ */
  async function toggleNote(note, field) {
    try {
      const data = await API.patch(`/api/notes/${note.id}`, { [field]: !note[field] });
      setStats(data.stats);
      const labels = { pinned: 'التثبيت', favorite: 'المفضلة', archived: 'الأرشفة' };
      UI.toast(
        `${data.note[field] ? 'تم تفعيل' : 'تم إلغاء'} ${labels[field]}`,
        'success',
        1800
      );
      fetchNotes({ silent: true });
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  }

  async function deleteNote(note) {
    if (note.deleted_at) return;
    const yes = await UI.confirmDialog({
      title: 'نقل إلى السلة؟',
      message: `«${note.title || 'بدون عنوان'}» ستُنقل إلى سلة المهملات وتبقى 30 يومًا.`,
      confirmText: 'نقل إلى السلة',
    });
    if (!yes) return;
    try {
      const data = await API.del(`/api/notes/${note.id}`);
      setStats(data.stats);
      UI.toast(data.message, 'success');
      if (state.editing?.id === note.id) closeEditor(true);
      fetchNotes({ silent: true });
      fetchCategories();
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  }

  async function restoreNote(note) {
    try {
      const data = await API.post(`/api/notes/${note.id}/restore`);
      setStats(data.stats);
      UI.toast('تمت استعادة الملاحظة', 'success');
      fetchNotes({ silent: true });
      fetchCategories();
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  }

  async function purgeNote(note) {
    const yes = await UI.confirmDialog({
      title: 'حذف نهائي؟',
      message: `لن يمكن استعادة «${note.title || 'بدون عنوان'}» بعد الحذف النهائي.`,
      confirmText: 'حذف نهائي',
    });
    if (!yes) return;
    try {
      const data = await API.del(`/api/notes/${note.id}?permanent=1`);
      setStats(data.stats);
      UI.toast(data.message, 'success');
      fetchNotes({ silent: true });
      fetchCategories();
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  }

  /* ================================ التصنيفات =============================== */
  function openCatModal(mode, category = null) {
    state.catMode = mode;
    state.catEditId = category ? category.id : null;
    $('catTitle').textContent = mode === 'edit' ? 'تعديل التصنيف' : 'تصنيف جديد';
    $('catName').value = category ? category.name : '';
    $('catError').textContent = '';
    const color = category ? category.color : 'indigo';
    state.catColor = color;
    renderColors($('catColors'), color, (c) => (state.catColor = c));
    openModal(els.catBackdrop);
    setTimeout(() => $('catName').focus(), 60);
  }

  async function saveCategory() {
    const name = $('catName').value.trim();
    if (name.length < 2) {
      $('catError').textContent = 'اسم التصنيف قصير جدًا';
      return;
    }
    try {
      if (state.catMode === 'edit') {
        await API.patch(`/api/categories/${state.catEditId}`, { name, color: state.catColor });
        UI.toast('تم تحديث التصنيف', 'success');
      } else {
        await API.post('/api/categories', { name, color: state.catColor });
        UI.toast('تم إنشاء التصنيف', 'success');
      }
      closeModal(els.catBackdrop);
      await fetchCategories();
      fetchNotes({ silent: true });
    } catch (err) {
      $('catError').textContent = err.message;
    }
  }

  async function deleteCategory(id) {
    const cat = state.categories.find((c) => String(c.id) === String(id));
    const yes = await UI.confirmDialog({
      title: 'حذف التصنيف',
      message: `سيُحذف تصنيف «${cat?.name}» وتصبح ملاحظاته بلا تصنيف (لن تُحذف الملاحظات).`,
      confirmText: 'حذف التصنيف',
    });
    if (!yes) return;
    try {
      const data = await API.del(`/api/categories/${id}`);
      state.categories = data.categories;
      if (String(state.category) === String(id)) state.category = 'all';
      setStats(data.stats);
      renderCategories();
      renderCategoryOptions();
      UI.toast('تم حذف التصنيف', 'success');
      fetchNotes({ silent: true });
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  }

  /* ================================ الإعدادات =============================== */
  function openSettings() {
    renderUser();
    const s = state.stats;
    $('setStats').innerHTML = `
      <div><dt>الملاحظات النشطة</dt><dd>${s.active ?? 0}</dd></div>
      <div><dt>المثبّتة</dt><dd>${s.pinned ?? 0}</dd></div>
      <div><dt>المفضلة</dt><dd>${s.favorite ?? 0}</dd></div>
      <div><dt>المؤرشفة</dt><dd>${s.archived ?? 0}</dd></div>
      <div><dt>في السلة</dt><dd>${s.trash ?? 0}</dd></div>
      <div><dt>التصنيفات</dt><dd>${s.categories ?? 0}</dd></div>`;
    $('setNewPw').value = '';
    $('setCurrentPw').value = '';
    $('setPwError').textContent = '';
    showSetAlert('');
    openModal(els.settingsBackdrop);
  }

  function showSetAlert(msg, ok = false) {
    const el = $('setAlert');
    if (!msg) return (el.hidden = true);
    el.hidden = false;
    el.classList.toggle('success', ok);
    el.textContent = msg;
  }

  async function saveSettings() {
    showSetAlert('');
    $('setPwError').textContent = '';
    const name = $('setName').value.trim();
    const email = $('setEmail').value.trim();
    const newPassword = $('setNewPw').value;
    const currentPassword = $('setCurrentPw').value;

    if (name.length < 2) return showSetAlert('الاسم قصير جدًا');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showSetAlert('البريد الإلكتروني غير صالح');
    if (!currentPassword) {
      $('setPwError').textContent = 'أدخل كلمة المرور الحالية لتأكيد التغييرات';
      return $('setCurrentPw').focus();
    }

    try {
      const data = await API.patch('/api/auth/profile', { name, email, newPassword, currentPassword });
      API.setCsrf(data.csrfToken);
      state.user = data.user;
      renderUser();
      UI.toast('تم حفظ التغييرات', 'success');
      closeModal(els.settingsBackdrop);
    } catch (err) {
      if (err.field === 'currentPassword') $('setPwError').textContent = err.message;
      else showSetAlert(err.message);
    }
  }

  async function emptyTrash() {
    const yes = await UI.confirmDialog({
      title: 'تفريغ سلة المهملات؟',
      message: 'سيُحذف كل ما في السلة نهائيًا ولا يمكن استعادته.',
      confirmText: 'تفريغ السلة',
    });
    if (!yes) return;
    try {
      const data = await API.post('/api/notes/empty-trash');
      setStats(data.stats);
      UI.toast(data.message, 'success');
      closeModal(els.settingsBackdrop);
      fetchNotes({ silent: true });
      fetchCategories();
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  }

  async function logout() {
    try {
      await API.post('/api/auth/logout');
    } catch {
      /* تجاهل */
    }
    window.location.href = '/login';
  }

  /* ================================ القائمة ================================ */
  function openSidebar() {
    els.sidebar.classList.add('open');
    els.sideScrim.hidden = false;
  }

  function closeSidebar() {
    els.sidebar.classList.remove('open');
    els.sideScrim.hidden = true;
  }

  /* ================================= الأحداث ================================ */
  function bind() {
    // الشريط الجانبي
    els.burger.addEventListener('click', openSidebar);
    els.sideClose.addEventListener('click', closeSidebar);
    els.sideScrim.addEventListener('click', closeSidebar);

    // النطاقات
    document.querySelectorAll('.nav-item[data-scope]').forEach((btn) =>
      btn.addEventListener('click', () => {
        setScope(btn.dataset.scope);
        closeSidebar();
      })
    );

    // التصنيفات (نقر + تعديل)
    els.catList.addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) {
        e.stopPropagation();
        const cat = state.categories.find((c) => String(c.id) === String(edit.dataset.edit));
        if (cat) openCatModal('edit', cat);
        return;
      }
      const item = e.target.closest('[data-cat]');
      if (item) setCategory(item.dataset.cat);
    });

    $('addCatBtn').addEventListener('click', () => openCatModal('create'));
    $('catSave').addEventListener('click', saveCategory);
    $('catCancel').addEventListener('click', () => closeModal(els.catBackdrop));
    $('catClose').addEventListener('click', () => closeModal(els.catBackdrop));
    $('catName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveCategory();
    });

    // البحث
    els.search.addEventListener(
      'input',
      UI.debounce(() => {
        state.q = els.search.value.trim();
        els.searchClear.hidden = !state.q;
        fetchNotes({ silent: !state.q });
      }, 260)
    );
    els.searchClear.addEventListener('click', () => {
      els.search.value = '';
      state.q = '';
      els.searchClear.hidden = true;
      els.search.focus();
      fetchNotes();
    });

    // الترتيب والعرض
    els.sort.addEventListener('change', () => {
      state.sort = els.sort.value;
      fetchNotes({ silent: true });
    });

    document.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.view = btn.dataset.view;
        localStorage.setItem('mynotes:view', state.view);
        document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
        renderNotes();
      });
    });

    // الملاحظات: فتح + أزرار
    els.notesGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.note');
      if (!card) return;
      const note = state.notes.find((n) => String(n.id) === card.dataset.id);
      if (!note) return;

      const act = e.target.closest('[data-act]');
      if (act) {
        e.stopPropagation();
        const kind = act.dataset.act;
        if (kind === 'pin') toggleNote(note, 'pinned');
        else if (kind === 'fav') toggleNote(note, 'favorite');
        else if (kind === 'archive') toggleNote(note, 'archived');
        else if (kind === 'delete') deleteNote(note);
        else if (kind === 'restore') restoreNote(note);
        else if (kind === 'purge') purgeNote(note);
        return;
      }
      openEditor(note);
    });

    els.notesGrid.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList.contains('note')) e.target.click();
    });

    // المحرّر
    $('newNoteBtn').addEventListener('click', () => openEditor());
    $('newNoteBtnTop').addEventListener('click', () => openEditor());
    els.emptyAction.addEventListener('click', () => openEditor());
    $('edClose').addEventListener('click', () => closeEditor());
    $('edCancel').addEventListener('click', () => closeEditor());
    $('edSave').addEventListener('click', () => saveNote());
    $('edDelete').addEventListener('click', () => state.editing && deleteNote(state.editing));

    $('edPin').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const on = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', String(!on));
      markDirty();
    });
    $('edFavorite').addEventListener('click', () => {
      const btn = $('edFavorite');
      const on = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', String(!on));
      markDirty();
    });

    $('edTitle').addEventListener('input', markDirty);
    $('edCategory').addEventListener('change', markDirty);
    $('edContent').addEventListener('input', () => {
      autoGrow();
      markDirty();
    });

    els.editorBackdrop.addEventListener('mousedown', (e) => {
      if (e.target === els.editorBackdrop) closeEditor();
    });
    els.catBackdrop.addEventListener('mousedown', (e) => {
      if (e.target === els.catBackdrop) closeModal(els.catBackdrop);
    });
    els.settingsBackdrop.addEventListener('mousedown', (e) => {
      if (e.target === els.settingsBackdrop) closeModal(els.settingsBackdrop);
    });

    // قائمة المستخدم
    const dd = $('userDropdown');
    $('userBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const open = dd.hidden;
      dd.hidden = !open;
      $('userBtn').setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!dd.hidden && !dd.contains(e.target) && e.target !== $('userBtn')) {
        dd.hidden = true;
        $('userBtn').setAttribute('aria-expanded', 'false');
      }
    });

    $('ddSettings').addEventListener('click', () => {
      dd.hidden = true;
      openSettings();
    });
    $('settingsBtn').addEventListener('click', openSettings);
    $('ddExport').addEventListener('click', () => {
      dd.hidden = true;
      window.location.href = '/api/export?format=json';
    });
    $('logoutBtn').addEventListener('click', logout);

    // الإعدادات
    $('setSave').addEventListener('click', saveSettings);
    $('setCancel').addEventListener('click', () => closeModal(els.settingsBackdrop));
    $('setClose').addEventListener('click', () => closeModal(els.settingsBackdrop));
    $('emptyTrashBtn').addEventListener('click', emptyTrash);

    // الثيم
    $('themeBtn').addEventListener('click', () => UI.toggleTheme());

    // اختصارات لوحة المفاتيح
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        els.search.focus();
        els.search.select();
        return;
      }
      if (e.key === 'Escape') {
        if (!els.settingsBackdrop.hidden) return closeModal(els.settingsBackdrop);
        if (!els.catBackdrop.hidden) return closeModal(els.catBackdrop);
        if (!els.editorBackdrop.hidden) return closeEditor();
        closeSidebar();
        return;
      }
      if (!typing && (e.key === 'n' || e.key === 'N') && els.editorBackdrop.hidden) {
        e.preventDefault();
        openEditor();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !els.editorBackdrop.hidden) {
        e.preventDefault();
        saveNote();
      }
    });

    // تحذير قبل مغادرة الصفحة أثناء الكتابة
    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  /* ================================ البدء ================================== */
  async function init() {
    bind();
    document.querySelectorAll('.seg-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === state.view)
    );
    UI.watchConnection();

    try {
      await loadMe();
    } catch {
      return;
    }

    await Promise.all([fetchCategories(), fetchNotes()]);
  }

  init();
})();
