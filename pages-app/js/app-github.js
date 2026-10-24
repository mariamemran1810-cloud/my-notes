/**
 * ملاحظاتي — منطق لوحة التطبيق (نسخة GitHub Pages)
 *
 * الفرق عن النسخة الخادمية:
 *   لا يوجد خادم — البيانات كلها في ملف notes.json داخل مستودع المستخدم الخاص.
 *   القراءة عند التشغيل، والكتابة مؤجّلة (debounce) لتقليل عدد نداءات GitHub.
 *   التصفية والبحث والترتيب تتم كلها محليًا في المتصفح.
 */

(() => {
  'use strict';

  /* ================================== الحالة ================================= */
  const state = {
    user: null, // { login, name, email }
    data: { version: 1, profile: { name: '', email: '' }, categories: [], notes: [] },
    scope: 'all',
    category: 'all',
    q: '',
    sort: 'updated',
    view: localStorage.getItem('mynotes:view') || 'grid',
    visible: [], // النتائج المعروضة بعد التصفية
    editing: null, // الملاحظة المفتوحة في المحرّر
    draft: null,
    dirty: false, // تغييرات غير محفوظة في المحرّر
    catMode: 'create',
    catEditId: null,
    catColor: 'indigo',
    saveTimer: null, // مؤقّت حفظ المحرّر (autosave)
    syncTimer: null, // مؤقّت رفع التغييرات إلى GitHub
    syncing: false,
    pending: false,
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
  const DAY = 86400000;

  const uid = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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

  const notes = () => state.data.notes;
  const categories = () => state.data.categories;

  function computeStats() {
    const ns = state.data.notes;
    const notTrashed = ns.filter((n) => !n.deleted_at);
    return {
      active: notTrashed.filter((n) => !n.archived).length,
      pinned: notTrashed.filter((n) => n.pinned).length,
      favorite: notTrashed.filter((n) => n.favorite).length,
      archived: notTrashed.filter((n) => n.archived).length,
      trash: ns.filter((n) => n.deleted_at).length,
      categories: state.data.categories.length,
      total: notTrashed.length,
    };
  }

  function setStats() {
    const stats = computeStats();
    document.querySelectorAll('[data-count]').forEach((el) => {
      el.textContent = stats[el.dataset.count] ?? 0;
    });
    return stats;
  }

  function openModal(el) {
    el.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal(el) {
    el.hidden = true;
    if (els.editorBackdrop.hidden && els.catBackdrop.hidden && els.settingsBackdrop.hidden) {
      document.body.style.overflow = '';
    }
  }

  /* =========================== المزامنة مع GitHub =========================== */
  function setSaveState(kind, text) {
    const el = $('saveState');
    el.className = `save-state ${kind}`;
    el.innerHTML = `<span class="dot-ok"></span> ${text}`;
  }

  /** نسخة نظيفة للحفظ — بدون حقول العرض المؤقتة */
  function cleanData() {
    return {
      ...state.data,
      notes: state.data.notes.map(({ category_name, category_color, ...rest }) => rest),
    };
  }

  /** حفظ مؤجّل: ينتظر توقف الكتابة ثم يرفع الملف مرة واحدة */
  function scheduleSave({ immediate = false, message = 'تحديث الملاحظات' } = {}) {
    clearTimeout(state.syncTimer);
    state.syncTimer = null;
    if (immediate) {
      syncNow(message);
      return;
    }
    state.syncTimer = setTimeout(() => {
      state.syncTimer = null; // يبقى null بعد الانطفاء حتى لا يخدع فحص beforeunload
      syncNow(message);
    }, 1200);
  }

  async function syncNow(message) {
    clearTimeout(state.syncTimer);
    state.syncTimer = null;
    if (state.syncing) {
      state.pending = true; // سيعاد بعد انتهاء المزامنة الحالية
      return;
    }
    state.syncing = true;
    setSaveState('saving', 'جارٍ الحفظ في GitHub…');
    try {
      await GitHubNotes.save(state.user.login, cleanData(), message);
      setSaveState('', `تم الحفظ ${rel(Date.now())}`);
    } catch (err) {
      setSaveState('error', 'تعذّر الحفظ — تحقّق من اتصالك ورمز GitHub');
      UI.toast(err.message || 'تعذّر الحفظ في GitHub', 'error');
    } finally {
      state.syncing = false;
      if (state.pending) {
        state.pending = false;
        scheduleSave({ immediate: true, message });
      }
    }
  }

  /** حذف نهائي لما انتهى عمره في السلة (30 يومًا) */
  function purgeExpired() {
    const now = Date.now();
    const before = notes().length;
    state.data.notes = notes().filter((n) => !n.deleted_at || now - n.deleted_at < 30 * DAY);
    if (notes().length !== before) scheduleSave({ message: 'تنظيف سلة المهملات' });
  }

  /* ================================ التصفية ================================ */
  function applyFilters() {
    const q = state.q.toLowerCase();
    let list = notes().filter((n) => {
      if (state.scope === 'trash') return !!n.deleted_at;
      if (n.deleted_at) return false;
      if (state.scope === 'archived') return !!n.archived;
      if (n.archived) return false;
      if (state.scope === 'pinned') return !!n.pinned;
      if (state.scope === 'favorite') return !!n.favorite;
      return true;
    });

    if (state.category !== 'all') {
      list = list.filter((n) => String(n.category_id) === String(state.category));
    }

    if (q) {
      list = list.filter(
        (n) =>
          String(n.title || '').toLowerCase().includes(q) ||
          String(n.content || '').toLowerCase().includes(q)
      );
    }

    const bySort = {
      updated: (a, b) => (b.updated_at || 0) - (a.updated_at || 0),
      created: (a, b) => (b.created_at || 0) - (a.created_at || 0),
      title: (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ar'),
    };
    list.sort((a, b) => (state.scope === 'all' ? (b.pinned || 0) - (a.pinned || 0) : 0) || bySort[state.sort](a, b));

    state.visible = list;
    return list;
  }

  /* ================================ العرض ================================== */
  function renderUser() {
    const p = state.data.profile;
    const name = p.name || state.user.login;
    $('userAvatar').textContent = UI.initial(name);
    $('userName').textContent = name;
    $('userEmail').textContent = `@${state.user.login}`;
    $('ddName').textContent = name;
    $('ddEmail').textContent = state.user.login;
    $('setName').value = name;
    $('setEmail').value = p.email || '';
    $('ghLogin').textContent = state.user.login;
    $('ghRepoLink').textContent = GitHubNotes.REPO;
    $('ghRepoLink').href = GitHubNotes.repoUrl(state.user.login);
    document.title = `${name} — ملاحظاتي`;
  }

  function renderScopeHead() {
    const title =
      state.category !== 'all'
        ? state.data.categories.find((c) => String(c.id) === String(state.category))?.name || 'تصنيف'
        : SCOPE_TITLES[state.scope];

    els.scopeTitle.textContent = title;

    const total = state.visible.length;
    let sub = SCOPE_SUBS[state.scope];
    if (state.q) sub = `${total} نتيجة للبحث عن «${state.q}»`;
    else if (state.category !== 'all') sub = `${total} ملاحظة في هذا التصنيف`;
    else if (total) sub = `${total} ملاحظة · ${sub}`;
    els.scopeSub.textContent = sub;

    const stats = computeStats();
    els.footCount.textContent = `إجمالي الملاحظات: ${stats.total ?? 0} · المعروضة الآن: ${total}`;
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
      <article class="note ${n.pinned ? 'pinned' : ''}" data-id="${esc(n.id)}" tabindex="0"
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

  /** يضيف اسم ولون التصنيف إلى كل ملاحظة قبل العرض */
  function decorateVisible() {
    const catMap = new Map(state.data.categories.map((c) => [String(c.id), c]));
    state.visible.forEach((n) => {
      const cat = n.category_id ? catMap.get(String(n.category_id)) : null;
      n.category_name = cat ? cat.name : null;
      n.category_color = cat ? cat.color : null;
    });
  }

  function renderNotes() {
    els.loading.hidden = true;
    applyFilters();
    decorateVisible();
    setStats();
    renderScopeHead();

    if (!state.visible.length) {
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
    els.notesGrid.innerHTML = state.visible.map(noteCard).join('');
  }

  function renderCategories() {
    const active = state.category;
    const counts = new Map();
    notes()
      .filter((n) => !n.deleted_at && !n.archived)
      .forEach((n) => {
        if (n.category_id) counts.set(String(n.category_id), (counts.get(String(n.category_id)) || 0) + 1);
      });

    const html = state.data.categories.length
      ? state.data.categories
          .map(
            (c) => `
        <button class="cat-item ${String(active) === String(c.id) ? 'active' : ''}" data-cat="${esc(c.id)}">
          <span class="dot" style="--c:${COLOR_VAR(c.color)}"></span>
          <span class="cat-name">${esc(c.name)}</span>
          <span class="count">${counts.get(String(c.id)) || 0}</span>
          <span class="cat-menu-btn" role="button" tabindex="0" data-edit="${esc(c.id)}" title="تعديل التصنيف">
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
      state.data.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    if (current) sel.value = current;
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
      saveNote({ silent: true }).finally(() => {
        closeModal(els.editorBackdrop);
        state.editing = null;
        state.dirty = false;
      });
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
    // حارس صارم: ما دام المحرّر مغلقًا فلا يوجد ما يُحفظ — يمنع أي حفظ عرضي
    // لبقايا نص في الحقول بعد إغلاق المحرّر (ملاحظات شبحية فارغة العنوان)
    if (els.editorBackdrop.hidden) {
      state.dirty = false;
      return null;
    }
    clearTimeout(state.saveTimer);
    const title = $('edTitle').value;
    const content = $('edContent').value;
    const categoryId = $('edCategory').value || null;
    const now = Date.now();

    if (!title.trim() && !content.trim()) {
      state.dirty = false;
      setSaveState('', 'لا يوجد ما يُحفظ');
      return null;
    }

    setSaveState('saving', 'جارٍ الحفظ…');

    const payload = {
      title,
      content,
      category_id: categoryId,
      color: state.draft?.color || 'slate',
      pinned: $('edPin').getAttribute('aria-pressed') === 'true',
      favorite: $('edFavorite').getAttribute('aria-pressed') === 'true',
    };

    let note;
    if (state.editing && state.editing.id) {
      note = state.editing;
      Object.assign(note, payload, { updated_at: now });
    } else {
      note = {
        id: uid(),
        ...payload,
        archived: false,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      };
      state.data.notes.unshift(note);
      state.editing = note;
      $('editorTitle').textContent = 'تعديل الملاحظة';
      $('edDelete').hidden = false;
    }

    state.dirty = false;
    setSaveState('', `تم الحفظ ${rel(note.updated_at)}`);
    if (!silent) UI.toast('تم حفظ الملاحظة', 'success');

    scheduleSave({ message: 'حفظ ملاحظة' });
    renderNotes();
    renderCategories();
    return note;
  }

  function autoGrow() {
    const ta = $('edContent');
    ta.style.height = 'auto';
    ta.style.height = Math.max(230, Math.min(ta.scrollHeight + 4, 420)) + 'px';
  }

  /* ============================ عمليات الملاحظات ============================ */
  function touch(note) {
    note.updated_at = Date.now();
    scheduleSave({ message: 'تحديث ملاحظة' });
    renderNotes();
    renderCategories();
  }

  function toggleNote(note, field) {
    note[field] = !note[field];
    const labels = { pinned: 'التثبيت', favorite: 'المفضلة', archived: 'الأرشفة' };
    UI.toast(`${note[field] ? 'تم تفعيل' : 'تم إلغاء'} ${labels[field]}`, 'success', 1800);
    touch(note);
  }

  function deleteNote(note) {
    if (note.deleted_at) return;
    UI.confirmDialog({
      title: 'نقل إلى السلة؟',
      message: `«${note.title || 'بدون عنوان'}» ستُنقل إلى سلة المهملات وتبقى 30 يومًا.`,
      confirmText: 'نقل إلى السلة',
    }).then((yes) => {
      if (!yes) return;
      note.deleted_at = Date.now();
      UI.toast('نُقلت الملاحظة إلى السلة', 'success');
      if (state.editing === note) closeEditor(true);
      scheduleSave({ message: 'نقل ملاحظة إلى السلة' });
      renderNotes();
      renderCategories();
    });
  }

  function restoreNote(note) {
    note.deleted_at = null;
    UI.toast('تمت استعادة الملاحظة', 'success');
    scheduleSave({ message: 'استعادة ملاحظة' });
    renderNotes();
    renderCategories();
  }

  function purgeNote(note) {
    UI.confirmDialog({
      title: 'حذف نهائي؟',
      message: `لن يمكن استعادة «${note.title || 'بدون عنوان'}» بعد الحذف النهائي.`,
      confirmText: 'حذف نهائي',
    }).then((yes) => {
      if (!yes) return;
      state.data.notes = notes().filter((n) => n !== note);
      UI.toast('حُذفت الملاحظة نهائيًا', 'success');
      scheduleSave({ message: 'حذف نهائي' });
      renderNotes();
      renderCategories();
    });
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

  function saveCategory() {
    const name = $('catName').value.trim();
    if (name.length < 2) {
      $('catError').textContent = 'اسم التصنيف قصير جدًا';
      return;
    }
    if (state.catMode === 'edit') {
      const cat = state.data.categories.find((c) => String(c.id) === String(state.catEditId));
      if (cat) {
        cat.name = name;
        cat.color = state.catColor;
      }
      UI.toast('تم تحديث التصنيف', 'success');
    } else {
      state.data.categories.push({ id: uid(), name, color: state.catColor, created_at: Date.now() });
      UI.toast('تم إنشاء التصنيف', 'success');
    }
    closeModal(els.catBackdrop);
    scheduleSave({ message: 'تحديث التصنيفات' });
    renderCategories();
    renderCategoryOptions();
    renderNotes();
  }

  function deleteCategory(id) {
    const cat = state.data.categories.find((c) => String(c.id) === String(id));
    UI.confirmDialog({
      title: 'حذف التصنيف',
      message: `سيُحذف تصنيف «${cat?.name}» وتصبح ملاحظاته بلا تصنيف (لن تُحذف الملاحظات).`,
      confirmText: 'حذف التصنيف',
    }).then((yes) => {
      if (!yes) return;
      state.data.categories = categories().filter((c) => String(c.id) !== String(id));
      notes().forEach((n) => {
        if (String(n.category_id) === String(id)) n.category_id = null;
      });
      if (String(state.category) === String(id)) state.category = 'all';
      UI.toast('تم حذف التصنيف', 'success');
      scheduleSave({ message: 'حذف تصنيف' });
      renderCategories();
      renderCategoryOptions();
      renderNotes();
    });
  }

  /* ================================ التصدير ================================= */
  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJson() {
    download('mynotes-backup.json', JSON.stringify(cleanData(), null, 2), 'application/json;charset=utf-8');
    UI.toast('تم تنزيل نسخة JSON', 'success');
  }

  function exportMarkdown() {
    const catMap = new Map(state.data.categories.map((c) => [String(c.id), c]));
    const parts = ['# ملاحظاتي\n', `> تصدير ${new Date().toLocaleString('ar')}\n`];
    notes()
      .filter((n) => !n.deleted_at)
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      .forEach((n) => {
        const cat = n.category_id ? catMap.get(String(n.category_id)) : null;
        const flags = [cat ? `التصنيف: ${cat.name}` : null, n.pinned ? 'مثبّتة' : null, n.favorite ? 'مفضلة' : null, n.archived ? 'مؤرشفة' : null]
          .filter(Boolean)
          .join(' · ');
        parts.push(`## ${n.title || 'بدون عنوان'}\n`);
        if (flags) parts.push(`*${flags}*\n`);
        if (n.content && n.content.trim()) parts.push(`${n.content.trim()}\n`);
        parts.push(`---\n`);
      });
    download('mynotes-export.md', parts.join('\n'), 'text/markdown;charset=utf-8');
    UI.toast('تم تنزيل ملف Markdown', 'success');
  }

  /* ================================ الإعدادات =============================== */
  function openSettings() {
    renderUser();
    const s = computeStats();
    $('setStats').innerHTML = `
      <div><dt>الملاحظات النشطة</dt><dd>${s.active ?? 0}</dd></div>
      <div><dt>المثبّتة</dt><dd>${s.pinned ?? 0}</dd></div>
      <div><dt>المفضلة</dt><dd>${s.favorite ?? 0}</dd></div>
      <div><dt>المؤرشفة</dt><dd>${s.archived ?? 0}</dd></div>
      <div><dt>في السلة</dt><dd>${s.trash ?? 0}</dd></div>
      <div><dt>التصنيفات</dt><dd>${s.categories ?? 0}</dd></div>`;

    try {
      const bytes = new Blob([JSON.stringify(state.data)]).size;
      $('ghSize').textContent = bytes < 1024 ? `${bytes} بايت` : `${(bytes / 1024).toFixed(1)} كيلوبايت`;
    } catch {
      $('ghSize').textContent = '—';
    }

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
    const name = $('setName').value.trim();
    const email = $('setEmail').value.trim();

    if (name.length < 1) return showSetAlert('الاسم قصير جدًا');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showSetAlert('البريد الإلكتروني غير صالح');

    state.data.profile.name = name;
    state.data.profile.email = email;
    renderUser();

    setSaveState('saving', 'جارٍ الحفظ…');
    try {
      await GitHubNotes.save(state.user.login, cleanData(), 'تحديث الملف الشخصي');
      setSaveState('', `تم الحفظ ${rel(Date.now())}`);
      UI.toast('تم حفظ التغييرات', 'success');
      closeModal(els.settingsBackdrop);
    } catch (err) {
      setSaveState('error', 'تعذّر الحفظ');
      showSetAlert(err.message || 'تعذّر الحفظ في GitHub');
    }
  }

  function emptyTrash() {
    UI.confirmDialog({
      title: 'تفريغ سلة المهملات؟',
      message: 'سيُحذف كل ما في السلة نهائيًا ولا يمكن استعادته.',
      confirmText: 'تفريغ السلة',
    }).then((yes) => {
      if (!yes) return;
      const before = notes().length;
      state.data.notes = notes().filter((n) => !n.deleted_at);
      UI.toast(`حُذف ${before - notes().length} ملاحظة نهائيًا`, 'success');
      scheduleSave({ message: 'تفريغ السلة' });
      closeModal(els.settingsBackdrop);
      renderNotes();
      renderCategories();
    });
  }

  function logout() {
    UI.confirmDialog({
      title: 'تسجيل الخروج؟',
      message: 'ستحتاج إلى رمز GitHub مرة أخرى للدخول — ملاحظاتك تبقى محفوظة في مستودعك.',
      confirmText: 'تسجيل الخروج',
      danger: false,
    }).then((yes) => {
      if (!yes) return;
      GitHubNotes.clearToken();
      window.location.href = './login.html';
    });
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
    els.burger.addEventListener('click', openSidebar);
    els.sideClose.addEventListener('click', closeSidebar);
    els.sideScrim.addEventListener('click', closeSidebar);

    document.querySelectorAll('.nav-item[data-scope]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.scope = btn.dataset.scope;
        state.category = 'all';
        document.querySelectorAll('.nav-item[data-scope]').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        renderCategories();
        renderNotes();
        closeSidebar();
      })
    );

    els.catList.addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) {
        e.stopPropagation();
        const cat = state.data.categories.find((c) => String(c.id) === String(edit.dataset.edit));
        if (cat) openCatModal('edit', cat);
        return;
      }
      const item = e.target.closest('[data-cat]');
      if (item) {
        state.category = String(item.dataset.cat);
        state.scope = 'all';
        document.querySelectorAll('.nav-item[data-scope]').forEach((b) => b.classList.remove('active'));
        document.querySelector('.nav-item[data-scope="all"]')?.classList.add('active');
        renderCategories();
        renderNotes();
        closeSidebar();
      }
    });

    $('addCatBtn').addEventListener('click', () => openCatModal('create'));
    $('catSave').addEventListener('click', saveCategory);
    $('catCancel').addEventListener('click', () => closeModal(els.catBackdrop));
    $('catClose').addEventListener('click', () => closeModal(els.catBackdrop));
    $('catName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveCategory();
    });

    els.search.addEventListener(
      'input',
      UI.debounce(() => {
        state.q = els.search.value.trim();
        els.searchClear.hidden = !state.q;
        renderNotes();
      }, 200)
    );
    els.searchClear.addEventListener('click', () => {
      els.search.value = '';
      state.q = '';
      els.searchClear.hidden = true;
      els.search.focus();
      renderNotes();
    });

    els.sort.addEventListener('change', () => {
      state.sort = els.sort.value;
      renderNotes();
    });

    document.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.view = btn.dataset.view;
        localStorage.setItem('mynotes:view', state.view);
        document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
        renderNotes();
      });
    });

    els.notesGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.note');
      if (!card) return;
      const note = state.visible.find((n) => String(n.id) === card.dataset.id);
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

    $('newNoteBtn').addEventListener('click', () => openEditor());
    $('newNoteBtnTop').addEventListener('click', () => openEditor());
    els.emptyAction.addEventListener('click', () => openEditor());
    $('edClose').addEventListener('click', () => closeEditor());
    $('edCancel').addEventListener('click', () => closeEditor());
    $('edSave').addEventListener('click', () => saveNote());
    $('edDelete').addEventListener('click', () => state.editing && deleteNote(state.editing));

    $('edPin').addEventListener('click', () => {
      const btn = $('edPin');
      btn.setAttribute('aria-pressed', String(btn.getAttribute('aria-pressed') !== 'true'));
      markDirty();
    });
    $('edFavorite').addEventListener('click', () => {
      const btn = $('edFavorite');
      btn.setAttribute('aria-pressed', String(btn.getAttribute('aria-pressed') !== 'true'));
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
      exportJson();
    });
    $('logoutBtn').addEventListener('click', logout);

    $('setSave').addEventListener('click', saveSettings);
    $('setCancel').addEventListener('click', () => closeModal(els.settingsBackdrop));
    $('setClose').addEventListener('click', () => closeModal(els.settingsBackdrop));
    $('emptyTrashBtn').addEventListener('click', emptyTrash);
    $('exportJsonBtn').addEventListener('click', exportJson);
    $('exportMdBtn').addEventListener('click', exportMarkdown);

    $('themeBtn').addEventListener('click', () => UI.toggleTheme());

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

    window.addEventListener('beforeunload', (e) => {
      // نُنذر إن كان هناك تحرير غير محفوظ أو حفظ مؤجّل لم يُرفع بعد
      if (state.dirty || state.syncing || state.syncTimer) {
        if (state.syncTimer) scheduleSave({ immediate: true, message: 'حفظ قبل الإغلاق' });
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // محاولة أخيرة للحفظ عند إخفاء الصفحة (إغلاق تبويب أو تبديل تطبيق)
    window.addEventListener('pagehide', () => {
      if (state.dirty) saveNote({ silent: true });
      if (state.syncTimer || state.dirty) scheduleSave({ immediate: true, message: 'حفظ قبل الإغلاق' });
    });

    window.addEventListener('online', () => UI.toast('عاد الاتصال بالإنترنت', 'success'));
    window.addEventListener('offline', () =>
      UI.toast('لا يوجد اتصال — التغييرات ستُحفظ عند عودة الشبكة', 'warning', 5000)
    );
  }

  /* ================================ البدء ================================== */
  async function init() {
    bind();
    document.querySelectorAll('.seg-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === state.view)
    );

    const token = GitHubNotes.getToken();
    if (!token) {
      window.location.replace('./login.html');
      return;
    }

    els.loading.hidden = false;

    try {
      const user = await GitHubNotes.verify();
      state.user = user;

      await GitHubNotes.ensureRepo(user.login);

      const stored = await GitHubNotes.load(user.login);
      if (stored && Array.isArray(stored.notes)) {
        state.data = {
          version: stored.version || 1,
          profile: { name: '', email: '', ...(stored.profile || {}) },
          categories: Array.isArray(stored.categories) ? stored.categories : [],
          notes: stored.notes,
        };
      } else {
        state.data = GitHubNotes.defaultData(user);
      }

      purgeExpired();
      renderUser();
      renderCategories();
      renderCategoryOptions();
      renderNotes();
    } catch (err) {
      els.loading.hidden = true;
      if (err && err.status === 401) {
        GitHubNotes.clearToken();
        UI.toast('انتهت صلاحية رمز GitHub — سجّل الدخول مجددًا', 'warning');
        setTimeout(() => (window.location.replace('./login.html')), 1200);
        return;
      }
      UI.toast(err.message || 'تعذّر تحميل بياناتك من GitHub', 'error');
      els.empty.hidden = false;
      els.emptyTitle.textContent = 'تعذّر تحميل الملاحظات';
      els.emptyText.textContent = err.message || 'تحقّق من اتصالك ثم أعد تحميل الصفحة.';
    }
  }

  init();
})();
