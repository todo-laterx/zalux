(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1. Staggered IntersectionObserver Reveals (no scroll event listeners)
  const items = [...document.querySelectorAll('.reveal')];
  if (reduce) {
    items.forEach((el) => el.classList.add('in'));
  } else {
    document.documentElement.classList.add('motion-ready');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const siblings = [...(el.parentElement?.children || [])].filter((x) => x.classList.contains('reveal'));
        const index = Math.max(0, siblings.indexOf(el));
        el.style.transitionDelay = `${Math.min(index * 55, 220)}ms`;
        el.classList.add('in');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
    items.forEach((el) => io.observe(el));
  }

  // 2. Fluid Sliding Pill Indicator Helper
  function bindSlidingTabs(containerSelector, tabSelector, onSelect) {
    const container = document.querySelector(containerSelector);
    if (!container) return;
    const indicator = container.querySelector('.tab-indicator');
    const tabs = [...container.querySelectorAll(tabSelector)];

    const syncIndicator = (activeTab) => {
      if (!indicator || !activeTab) return;
      indicator.style.width = `${activeTab.offsetWidth}px`;
      indicator.style.transform = `translate3d(${activeTab.offsetLeft}px, 0, 0)`;
    };

    const initial = tabs.find((t) => t.classList.contains('active')) || tabs[0];
    if (initial) {
      requestAnimationFrame(() => syncIndicator(initial));
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => syncIndicator(tabs.find((t) => t.classList.contains('active')) || initial));
      }
    }

    window.addEventListener('resize', () => {
      const current = tabs.find((t) => t.classList.contains('active'));
      if (current) syncIndicator(current);
    }, { passive: true });

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        if (tab.classList.contains('active')) return;
        tabs.forEach((t) => {
          const isTarget = t === tab;
          t.classList.toggle('active', isTarget);
          t.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        });
        syncIndicator(tab);
        onSelect(tab);
      });
    });
  }

  // 3. Call Cinema Showcase Switcher with Blur-Bridge Crossfade
  const showcaseImg = document.getElementById('showcaseImg');
  const showcaseCaption = document.getElementById('showcaseCaption');
  const showcaseTag = document.getElementById('showcaseTag');
  let swapTimer = 0;

  bindSlidingTabs('.showcase-tabs', '.tab', (tab) => {
    const nextSrc = tab.dataset.shot;
    const nextCap = tab.dataset.caption;
    const nextTag = tab.dataset.tag;
    if (!showcaseImg || !nextSrc) return;

    if (reduce) {
      showcaseImg.src = nextSrc;
      if (showcaseCaption && nextCap) showcaseCaption.textContent = nextCap;
      if (showcaseTag && nextTag) showcaseTag.textContent = nextTag;
      return;
    }

    clearTimeout(swapTimer);
    showcaseImg.classList.add('is-switching');
    const pre = new Image();
    pre.src = nextSrc;
    swapTimer = window.setTimeout(() => {
      showcaseImg.src = nextSrc;
      if (showcaseCaption && nextCap) showcaseCaption.textContent = nextCap;
      if (showcaseTag && nextTag) showcaseTag.textContent = nextTag;
      requestAnimationFrame(() => {
        showcaseImg.classList.remove('is-switching');
      });
    }, 110);
  });

  // 3b. Zalux Studio Interactive Companion Switcher (with Auto-Slide & Progress)
  const studioCard = document.getElementById('companionStudio');
  const studioTabsWrap = document.querySelector('.studio-tabs');
  const studioTabsList = [...document.querySelectorAll('.studio-tab')];
  const studioImg = document.getElementById('studioImg');
  const studioTitle = document.getElementById('studioTitle');
  const studioDesc = document.getElementById('studioDesc');
  const studioPoints = document.getElementById('studioPoints');
  const studioCopy = studioDesc?.closest('.studio-copy');
  const studioProgress = document.getElementById('studioProgress');
  let studioSwapTimer = 0;

  const restartStudioProgress = () => {
    if (!studioTabsWrap || !studioProgress || reduce) return;
    studioTabsWrap.classList.remove('is-autoplaying');
    // Force reflow to restart CSS keyframe animation cleanly
    void studioProgress.offsetWidth;
    studioTabsWrap.classList.add('is-autoplaying');
  };

  bindSlidingTabs('.studio-tabs', '.studio-tab', (tab) => {
    const nextSrc = tab.dataset.shot;
    const nextAlt = tab.dataset.alt;
    const nextTitle = tab.dataset.title;
    const nextDesc = tab.dataset.desc;
    const pts = [tab.dataset.p1, tab.dataset.p2, tab.dataset.p3].filter(Boolean);
    if (!studioImg || !nextSrc) return;

    restartStudioProgress();

    const applyStudioContent = () => {
      studioImg.src = nextSrc;
      if (nextAlt) studioImg.alt = nextAlt;
      if (studioTitle && nextTitle) studioTitle.textContent = nextTitle;
      if (studioDesc && nextDesc) studioDesc.textContent = nextDesc;
      if (studioPoints && pts.length) {
        studioPoints.replaceChildren(
          ...pts.map((text) => {
            const li = document.createElement('li');
            li.textContent = text;
            return li;
          })
        );
      }
    };

    if (reduce) {
      applyStudioContent();
      return;
    }

    clearTimeout(studioSwapTimer);
    studioImg.classList.add('is-switching');
    studioTitle?.classList.add('is-switching');
    studioCopy?.classList.add('is-switching');
    studioPoints?.classList.add('is-switching');
    const pre = new Image();
    pre.src = nextSrc;
    studioSwapTimer = window.setTimeout(() => {
      applyStudioContent();
      requestAnimationFrame(() => {
        studioImg.classList.remove('is-switching');
        studioTitle?.classList.remove('is-switching');
        studioCopy?.classList.remove('is-switching');
        studioPoints?.classList.remove('is-switching');
      });
    }, 110);
  });

  if (studioProgress && studioTabsWrap && studioTabsList.length > 1 && !reduce) {
    restartStudioProgress();
    studioProgress.addEventListener('animationend', () => {
      const currentIdx = studioTabsList.findIndex((t) => t.classList.contains('active'));
      const nextIdx = (currentIdx + 1) % studioTabsList.length;
      studioTabsList[nextIdx]?.click();
    });
    if (studioCard) {
      studioCard.addEventListener('mouseenter', () => {
        studioTabsWrap.classList.add('is-paused');
      });
      studioCard.addEventListener('mouseleave', () => {
        studioTabsWrap.classList.remove('is-paused');
      });
    }
  }

  // 4. Distro Switcher
  const distroStatus = document.getElementById('distroStatus');
  const distroPanels = [...document.querySelectorAll('.distro-panel')];

  bindSlidingTabs('.distro-tabs', '.distro-tab', (tab) => {
    const key = tab.dataset.distro;
    if (distroStatus && tab.dataset.status) {
      distroStatus.textContent = tab.dataset.status;
    }
    distroPanels.forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.panel === key);
    });
  });

  // 5. Mobile Fluid Island Hamburger Menu
  const menuBtn = document.getElementById('menuBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  if (menuBtn && mobileMenu) {
    const closeMenu = () => {
      menuBtn.setAttribute('aria-expanded', 'false');
      mobileMenu.classList.remove('open');
      document.body.style.overflow = '';
    };
    menuBtn.addEventListener('click', () => {
      const expanded = menuBtn.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        closeMenu();
      } else {
        menuBtn.setAttribute('aria-expanded', 'true');
        mobileMenu.classList.add('open');
        document.body.style.overflow = 'hidden';
      }
    });
    mobileMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeMenu);
    });
  }

  // 6. Tactile Copy Buttons with Checkmark Morph
  const COPY_SVG = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M216,34H88a6,6,0,0,0-6,6V82H40a6,6,0,0,0-6,6V216a6,6,0,0,0,6,6H168a6,6,0,0,0,6-6V174h42a6,6,0,0,0,6-6V40A6,6,0,0,0,216,34ZM162,210H46V94H162Zm48-48H174V88a6,6,0,0,0-6-6H94V46H210Z"/></svg>';
  const CHECK_SVG = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M228.24,76.24l-128,128a6,6,0,0,1-8.48,0l-56-56a6,6,0,0,1,8.48-8.48L96,191.51,219.76,67.76a6,6,0,0,1,8.48,8.48Z"/></svg>';

  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy || '');
        btn.classList.add('copied');
        btn.innerHTML = `${CHECK_SVG}<span>Đã chép</span>`;
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = `${COPY_SVG}<span>Sao chép</span>`;
        }, 1500);
      } catch {
        const span = btn.querySelector('span');
        if (span) span.textContent = 'Lỗi';
      }
    });
  });
})();
