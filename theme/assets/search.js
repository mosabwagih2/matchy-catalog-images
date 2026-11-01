/* Header search: opens a bar under the header and shows results in place, no page change.
   Without JavaScript the search icon is still a normal link to the search page. */
(() => {
  const header = document.querySelector('.header');
  const bar = document.getElementById('search-bar');
  if (!header || !bar) return;

  const input = bar.querySelector('input[name="q"]');
  const form = bar.querySelector('form');
  const panel = bar.querySelector('[data-search-results]');
  const openers = [...document.querySelectorAll('[data-search-open]')];
  const root = (window.MATCHY && MATCHY.routes && MATCHY.routes.root) || '/';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const overlay = document.createElement('div');
  overlay.className = 'search-overlay';
  overlay.hidden = true;
  document.body.append(overlay);

  const quick = [...document.querySelectorAll('.header .nav-link')]
    .map(a => `<a href="${esc(a.getAttribute('href'))}">${esc(a.textContent.trim())}</a>`).join('');
  const idle = () => {
    panel.innerHTML = quick ? `<div class="sp-pad"><p class="sp-hint">أو تصفّحي:</p><div class="sp-chips">${quick}</div></div>` : '';
  };

  const placeOverlay = () => {
    overlay.style.top = Math.max(0, header.getBoundingClientRect().bottom) + 'px';
  };

  let isOpen = false;
  const open = () => {
    if (isOpen) return;
    isOpen = true;
    bar.hidden = false;
    overlay.hidden = false;
    placeOverlay();
    openers.forEach(o => o.setAttribute('aria-expanded', 'true'));
    idle();
    requestAnimationFrame(() => input.focus());
  };
  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    bar.hidden = true;
    overlay.hidden = true;
    input.value = '';
    if (controller) controller.abort();
    openers.forEach(o => o.setAttribute('aria-expanded', 'false'));
  };

  let controller;
  const run = async q => {
    if (controller) controller.abort();
    controller = new AbortController();
    panel.classList.add('loading');
    try {
      /* Shopify's predictive API does not support Arabic, so read the normal results section. */
      const url = `${root}search?q=${encodeURIComponent(q)}&type=product&section_id=main-search`;
      const response = await fetch(url, { signal: controller.signal });
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const cards = [...doc.querySelectorAll('.product-card[data-product-url]')].slice(0, 8);
      if (!cards.length) {
        panel.innerHTML = `<div class="sp-pad"><p class="sp-hint">مفيش نتايج لـ «${esc(q)}». جرّبي كلمة تانية.</p></div>`;
        return;
      }
      panel.innerHTML = '<div class="sp-grid">' + cards.map(card => {
        const img = card.querySelector('.primary-image');
        const src = img ? img.getAttribute('src').replace(/width=\d+/, 'width=200') : '';
        const title = (card.querySelector('.product-info h3') || {}).textContent || '';
        const price = (card.querySelector('.card-price strong') || {}).textContent || '';
        const was = (card.querySelector('.card-price del') || {}).textContent || '';
        return `<a class="sp-item" href="${esc(card.dataset.productUrl)}">` +
          (src ? `<img src="${esc(src)}" alt="" width="64" height="85" loading="lazy">` : '<span class="ph"></span>') +
          `<span class="sp-text"><strong>${esc(title.trim())}</strong><span>${esc(price.trim())}${was ? ` <del>${esc(was.trim())}</del>` : ''}</span></span></a>`;
      }).join('') + '</div>' +
        `<a class="sp-all" href="${root}search?q=${encodeURIComponent(q)}">عرض كل النتائج</a>`;
    } catch (error) {
      if (error.name !== 'AbortError') panel.innerHTML = '<div class="sp-pad"><p class="sp-hint">حصلت مشكلة في البحث، جرّبي تاني.</p></div>';
    } finally {
      panel.classList.remove('loading');
    }
  };

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { if (controller) controller.abort(); idle(); return; }
    timer = setTimeout(() => run(q), 200);
  });

  /* Enter keeps the shopper on the page and shows the results here. */
  form.addEventListener('submit', event => {
    event.preventDefault();
    const q = input.value.trim();
    if (q.length) { clearTimeout(timer); run(q); }
  });

  openers.forEach(o => o.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    isOpen ? close() : open();
  }));
  bar.querySelector('[data-search-close]').addEventListener('click', close);
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  addEventListener('scroll', () => { if (isOpen) placeOverlay(); }, { passive: true });
  addEventListener('resize', () => { if (isOpen) placeOverlay(); });
})();
