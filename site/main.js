(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const items = [...document.querySelectorAll('.reveal')];
  if (reduce) { items.forEach((el) => el.classList.add('in')); }
  else {
    document.documentElement.classList.add('motion-ready');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const siblings = [...(el.parentElement?.children || [])].filter((x) => x.classList.contains('reveal'));
        const index = Math.max(0, siblings.indexOf(el));
        el.style.transitionDelay = `${Math.min(index * 45, 220)}ms`;
        el.classList.add('in');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach((el) => io.observe(el));
  }

  document.querySelectorAll('.copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy || '');
        const old = btn.textContent;
        btn.textContent = 'Đã copy';
        setTimeout(() => { btn.textContent = old; }, 1400);
      } catch {
        btn.textContent = 'Lỗi';
      }
    });
  });
})();
