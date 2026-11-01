/* MATCHY UX layer, inspired by Shopify's Horizon theme: fly-to-cart, smart header, gallery swipe/zoom,
   grid density and predictive search. Everything degrades to the normal links and forms without JS. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hoverable = matchMedia('(hover: hover)').matches;
  const fmt = value => {
    const amount = Number(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return ((window.MATCHY && MATCHY.moneyFormat) || '{{amount}}').replace(/\{\{\s*\w+\s*\}\}/, amount);
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------------------------------------------------- fly to cart */
  function flyToCart(source) {
    const target = $('.header .cart-count')?.closest('a,button');
    if (reduced || !source || !target || !source.getBoundingClientRect) return;
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    if (!from.width || !to.width) return;
    const ghost = document.createElement('img');
    ghost.src = source.currentSrc || source.src;
    ghost.alt = '';
    ghost.className = 'fly-ghost';
    Object.assign(ghost.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' });
    document.body.append(ghost);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const animation = ghost.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1, borderRadius: '14px' },
      { transform: `translate(${dx}px,${dy}px) scale(.06)`, opacity: 0.4, borderRadius: '50%' }
    ], { duration: 650, easing: 'cubic-bezier(.5,0,.3,1)' });
    animation.onfinish = () => {
      ghost.remove();
      const bubble = $('.header .cart-count');
      if (bubble) bubble.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 350 });
    };
  }

  document.addEventListener('submit', event => {
    if (!event.target.matches('#product-form') || !event.target.checkValidity()) return;
    flyToCart($('#main-product-image'));
  }, true);

  /* ------------------------------------------------- header hides on scroll down */
  const header = $('.header');
  if (header && !reduced) {
    let last = scrollY;
    let ticking = false;
    addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = scrollY;
        const hide = y > last && y > 220 && !document.body.classList.contains('locked');
        header.classList.toggle('header-hidden', hide);
        last = y;
        ticking = false;
      });
    }, { passive: true });
    header.addEventListener('focusin', () => header.classList.remove('header-hidden'));
  }

  /* ------------------------------------------------------ gallery swipe + zoom */
  const main = $('#main-product-image');
  const thumbs = $$('.gallery-thumb');
  const holder = main ? main.closest('.main-image-button') : null;
  if (main && holder && thumbs.length > 1) {
    const badge = document.createElement('span');
    badge.className = 'gallery-counter';
    holder.append(badge);
    const current = () => Math.max(0, thumbs.findIndex(t => t.classList.contains('active')));
    const paint = () => { badge.textContent = `${current() + 1} / ${thumbs.length}`; };
    paint();
    new MutationObserver(paint).observe($('.gallery-thumbs'), { subtree: true, attributes: true, attributeFilter: ['class'] });

    let startX = 0;
    let startY = 0;
    holder.addEventListener('touchstart', e => { startX = e.touches[0].clientX; startY = e.touches[0].clientY; }, { passive: true });
    holder.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      const next = (current() + (dx < 0 ? 1 : -1) + thumbs.length) % thumbs.length;
      thumbs[next].click();
    }, { passive: true });
  }
  if (main && holder && hoverable && !reduced) {
    holder.classList.add('can-zoom');
    holder.addEventListener('mousemove', e => {
      const r = holder.getBoundingClientRect();
      main.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    });
  }

  /* ------------------------------------------------------------ grid density */
  const grid = $('#collection-products');
  const controls = $('.collection-controls');
  if (grid && controls) {
    const wrap = document.createElement('div');
    wrap.className = 'density';
    wrap.innerHTML = '<button type="button" data-density="large" aria-label="عرض كبير"><i></i><i></i></button>' +
      '<button type="button" data-density="compact" aria-label="عرض مضغوط"><i></i><i></i><i></i><i></i></button>';
    controls.append(wrap);
    const apply = mode => {
      grid.classList.toggle('is-large', mode === 'large');
      $$('[data-density]', wrap).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.density === mode)));
      try { localStorage.setItem('matchy-density', mode); } catch (error) { /* storage may be blocked */ }
    };
    let saved = 'compact';
    try { saved = localStorage.getItem('matchy-density') || 'compact'; } catch (error) { /* ignore */ }
    apply(saved);
    wrap.addEventListener('click', e => {
      const button = e.target.closest('[data-density]');
      if (button) apply(button.dataset.density);
    });
  }

  /* -------------------------------------------------------- predictive search */
  const searchLink = $('.header-tools a[href*="/search"]');
  if (searchLink) {
    const dialog = document.createElement('dialog');
    dialog.className = 'search-dialog';
    dialog.innerHTML =
      '<form class="search-dialog-form" action="/search" method="get" role="search">' +
      '<input type="search" name="q" placeholder="دوّري على عباية، فستان، سوت…" autocomplete="off" aria-label="بحث">' +
      '<button type="button" class="icon-btn" data-search-close aria-label="إغلاق">✕</button></form>' +
      '<div class="search-dialog-results" aria-live="polite"></div>';
    document.body.append(dialog);
    const input = $('input', dialog);
    const results = $('.search-dialog-results', dialog);
    const root = (window.MATCHY && MATCHY.routes && MATCHY.routes.root) || '/';
    const links = $$('.header .nav-link').map(a => `<a href="${esc(a.getAttribute('href'))}">${esc(a.textContent.trim())}</a>`).join('');
    const idle = () => { results.innerHTML = `<p class="search-hint">أو تصفّحي:</p><div class="search-chips">${links}</div>`; };
    idle();

    let timer;
    let controller;
    const run = async q => {
      if (controller) controller.abort();
      controller = new AbortController();
      results.classList.add('loading');
      try {
        /* Shopify's predictive API does not support Arabic, so read the normal search results instead. */
        const url = `${root}search?q=${encodeURIComponent(q)}&type=product&section_id=main-search`;
        const response = await fetch(url, { signal: controller.signal });
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const cards = $$('.product-card[data-product-url]', doc).slice(0, 6);
        results.innerHTML = cards.length
          ? cards.map(card => {
              const img = $('.primary-image', card);
              const src = img ? img.getAttribute('src').replace(/width=\d+/, 'width=200') : '';
              const title = ($('.product-info h3', card) || {}).textContent || '';
              const price = ($('.card-price strong', card) || {}).textContent || '';
              return `<a class="search-item" href="${esc(card.dataset.productUrl)}">` +
                (src ? `<img src="${esc(src)}" alt="" width="56" height="75" loading="lazy">` : '<span class="ph"></span>') +
                `<span><strong>${esc(title.trim())}</strong><em>${esc(price.trim())}</em></span></a>`;
            }).join('') + `<a class="search-all" href="${root}search?q=${encodeURIComponent(q)}">عرض كل النتائج</a>`
          : `<p class="search-hint">مفيش نتايج لـ «${esc(q)}». جرّبي كلمة تانية.</p>`;
      } catch (error) {
        if (error.name !== 'AbortError') results.innerHTML = '<p class="search-hint">حصلت مشكلة في البحث، جرّبي تاني.</p>';
      } finally {
        results.classList.remove('loading');
      }
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { if (controller) controller.abort(); idle(); return; }
      timer = setTimeout(() => run(q), 180);
    });
    searchLink.addEventListener('click', e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      dialog.showModal();
      input.focus();
    });
    dialog.addEventListener('click', e => {
      if (e.target === dialog || e.target.closest('[data-search-close]')) dialog.close();
    });
    dialog.addEventListener('close', () => { input.value = ''; idle(); });
  }
})();
