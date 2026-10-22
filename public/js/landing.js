/**
 * ملاحظاتي — منطق صفحة الهبوط
 */

(() => {
  const nav = document.getElementById('nav');
  const themeBtn = document.getElementById('themeBtn');
  const burger = document.getElementById('burger');
  const mobileMenu = document.getElementById('mobileMenu');

  // شريط لاصق
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // الثيم
  themeBtn?.addEventListener('click', () => UI.toggleTheme());

  // القائمة الجوّالة
  burger?.addEventListener('click', () => {
    const open = mobileMenu.hasAttribute('hidden');
    mobileMenu.toggleAttribute('hidden', !open);
    burger.setAttribute('aria-expanded', String(open));
  });

  mobileMenu?.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => {
      mobileMenu.setAttribute('hidden', '');
      burger.setAttribute('aria-expanded', 'false');
    })
  );

  // سنة الحقوق
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // ظهور الأقسام عند التمرير
  const revealTargets = document.querySelectorAll('.feature, .step, .faq, .shield-card, .section-head');
  if ('IntersectionObserver' in window) {
    revealTargets.forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(18px)';
      el.style.transition = `opacity .5s var(--ease) ${(i % 3) * 70}ms, transform .5s var(--ease) ${(i % 3) * 70}ms`;
    });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.style.opacity = '1';
            e.target.style.transform = 'none';
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealTargets.forEach((el) => io.observe(el));
  }
})();
