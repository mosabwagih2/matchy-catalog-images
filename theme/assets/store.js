'use strict';
/*
 * MATCHY storefront behaviour.
 *
 * Markup comes from Liquid, so this file only reacts to it: drawers, rails, the
 * gallery, variant selection and the cart. The cart itself always lives on
 * Shopify — every mutation goes through the Cart AJAX API and the drawer is
 * re-rendered from the cart-drawer section, so nothing about the cart is kept
 * here. localStorage holds the wishlist only, which Shopify does not store.
 */

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

const config = window.MATCHY || {};
const routes = config.routes || {};
const strings = config.strings || {};
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const WISHLIST_KEY = 'matchy-wishlist';

let activePanel = null;
let previousFocus = null;
let toastTimer = null;

/* id -> handle, so the drawer can fetch each saved product by handle. */
let wishlist = new Map();

try {
  const stored = JSON.parse(localStorage.getItem(WISHLIST_KEY));
  if (stored && typeof stored === 'object') {
    for (const [id, handle] of Object.entries(stored)) {
      if (typeof handle === 'string' && handle) wishlist.set(Number(id), handle);
    }
  }
} catch { /* private mode or blocked storage: wishlist stays empty */ }

function saveWishlist() {
  try {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(Object.fromEntries(wishlist)));
  } catch { /* nothing to do: the wishlist is a convenience only */ }
}

const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const icons = {
  bag: '<path d="M5 7h14l1 14H4L5 7Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>'
};
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24">${icons[name] || icons.bag}</svg>`;

/* Shopify returns prices in cents. Format them with the shop's own money format. */
function money(cents) {
  const amount = (Number(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
  const format = config.moneyFormat || '{{amount}}';
  return format.replace(/\{\{\s*\w+\s*\}\}/, amount);
}

function toast(text) {
  const t = $('.toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

/* ---------------------------------------------------------------- drawers */

function closePanel(restore = true) {
  if (activePanel) {
    activePanel.classList.remove('open');
    activePanel.inert = true;
    activePanel = null;
  }
  $('.overlay')?.classList.remove('open');
  document.body.classList.remove('locked');
  if (restore && previousFocus?.isConnected) previousFocus.focus();
}

function openPanel(name) {
  const next = $('#' + name + '-panel');
  if (!next) return;
  const currentFocus = document.activeElement;
  closePanel(false);
  previousFocus = currentFocus;
  if (name === 'wishlist') renderWishlist();
  activePanel = next;
  next.inert = false;
  $('.overlay')?.classList.add('open');
  next.classList.add('open');
  document.body.classList.add('locked');
  setTimeout(() => next.querySelector('button,a,input')?.focus(), 80);
}

/* ------------------------------------------------------------------- cart */

function setCartCount(count) {
  $$('.cart-count').forEach(e => {
    e.textContent = String(Number(count));
  });
}

function setWishCount() {
  $$('.wish-count').forEach(e => {
    e.textContent = String(wishlist.size);
  });
}

/* Re-render the drawer from the section so the markup has one source of truth. */
async function refreshCartDrawer(html) {
  const target = $('[data-cart-drawer-target]');
  if (!target) return;
  try {
    if (!html) {
      const response = await fetch(`${routes.root || '/'}?sections=cart-drawer`);
      if (!response.ok) throw new Error('cart section');
      html = (await response.json())['cart-drawer'];
    }
    target.innerHTML = html;
    const contents = $('#cart-drawer-contents', target);
    if (contents) setCartCount(contents.dataset.cartCount || 0);
  } catch {
    /* Leave the drawer as it is; the cart page is still correct. */
  }
}

async function cartRequest(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...body, sections: 'cart-drawer' })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.description || data.message || strings.error);
  return data;
}

/* Show the new line in the drawer straight away; the server answer replaces it a moment later. */
function showPendingCartItem(id, quantity, preview) {
  const items = $('#cart-items');
  if (!items) return;
  const existing = $(`[data-cart-item^="${id}:"]`, items);
  if (existing) {
    const label = $('.cart-quantity span', existing);
    const next = Number(label.textContent) + quantity;
    label.textContent = String(next);
    const buttons = $$('.cart-quantity [data-cart-change]', existing);
    if (buttons[0]) buttons[0].dataset.quantity = String(next - 1);
    if (buttons[1]) buttons[1].dataset.quantity = String(next + 1);
    updateCartTotals(existing, next);
    return;
  }
  if ($('.empty-state', items)) items.innerHTML = '';
  const row = document.createElement('article');
  row.className = 'cart-item is-updating';
  row.dataset.cartItem = id + ':pending';
  row.dataset.unitPrice = String(preview.price);
  row.dataset.unitOriginal = String(preview.price);
  row.innerHTML =
    `<a href="${escapeText(preview.url || '#')}">${preview.image ? `<img src="${escapeText(preview.image)}" alt="" width="100" height="133">` : ''}</a>` +
    `<div><h3><a href="${escapeText(preview.url || '#')}">${escapeText(preview.title || '')}</a></h3>` +
    (preview.options ? `<p>${escapeText(preview.options)}</p>` : '') +
    `<strong data-line-price></strong>` +
    `<div class="cart-quantity"><span>${quantity}</span></div></div>`;
  items.prepend(row);
  updateCartTotals(row, quantity);
}

async function addToCart(id, quantity, preview) {
  const amount = Number(quantity) || 1;
  if (preview) {
    showPendingCartItem(id, amount, preview);
    setCartCount(Number($('.cart-count')?.textContent || 0) + amount);
  }
  openPanel('cart');
  toast(strings.addedToCart || '');
  let data;
  try {
    data = await cartRequest(routes.cartAdd || '/cart/add.js', {
      items: [{ id: Number(id), quantity: amount }]
    });
  } catch (error) {
    await refreshCartDrawer();
    throw error;
  }
  await refreshCartDrawer(data.sections && data.sections['cart-drawer']);
  return data;
}

async function refreshCartPage() {
  const current = $('.cart-page');
  if (!current) return;
  const response = await fetch(location.pathname, { headers: { Accept: 'text/html' } });
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const next = $('.cart-page', doc);
  if (next) current.replaceWith(next);
}

async function changeCartLine(key, quantity) {
  const data = await cartRequest(routes.cartChange || '/cart/change.js', { id: key, quantity: Number(quantity) });
  await refreshCartDrawer(data.sections && data.sections['cart-drawer']);
  if (document.body.classList.contains('template-cart')) await refreshCartPage();
}

/* Quantity buttons update the screen at once and send one request after a short pause. */
const pendingCartChanges = new Map();

function updateCartTotals(item, quantity) {
  const unit = Number(item.dataset.unitPrice);
  const original = Number(item.dataset.unitOriginal);
  if (!Number.isFinite(unit)) return;
  item.dataset.qty = String(quantity);
  const line = $('[data-line-price]', item);
  if (line) {
    const compare = $('[data-line-original]', line);
    const text = money(unit * quantity);
    if (compare) {
      compare.textContent = money(original * quantity);
      line.firstChild.textContent = text + ' ';
    } else {
      line.textContent = text;
    }
  }
  const scope = item.closest('#cart-drawer-contents, .cart-page') || document;
  let total = 0;
  $$('[data-cart-item]', scope).forEach(row => {
    const q = row.dataset.qty !== undefined ? Number(row.dataset.qty) : Number($('.cart-quantity span', row)?.textContent || 0);
    total += Number(row.dataset.unitPrice) * q;
  });
  $$('[data-cart-subtotal]', scope).forEach(e => { e.textContent = money(total); });
}

function queueCartChange(button) {
  const key = button.dataset.cartChange;
  const quantity = Number(button.dataset.quantity);
  const item = button.closest('[data-cart-item]');
  if (item) {
    item.classList.add('is-updating');
    if (quantity <= 0) {
      item.classList.add('is-removing');
    } else {
      const label = $('.cart-quantity span', item);
      if (label) label.textContent = String(quantity);
      const buttons = $$('.cart-quantity [data-cart-change]', item);
      if (buttons[0]) buttons[0].dataset.quantity = String(quantity - 1);
      if (buttons[1]) buttons[1].dataset.quantity = String(quantity + 1);
    }
    updateCartTotals(item, quantity);
  }
  clearTimeout(pendingCartChanges.get(key));
  pendingCartChanges.set(key, setTimeout(async () => {
    pendingCartChanges.delete(key);
    try {
      await changeCartLine(key, quantity);
    } catch (error) {
      toast(error.message || strings.error);
      await refreshCartDrawer();
      if (document.body.classList.contains('template-cart')) await refreshCartPage();
    }
  }, 250));
}

/* --------------------------------------------------------------- wishlist */

async function renderWishlist() {
  const host = $('#wishlist-items');
  if (!host) return;

  const emptyTitle = strings.wishlistEmptyTitle || '';
  const emptyText = strings.wishlistEmptyText || '';

  if (!wishlist.size) {
    host.innerHTML = emptyState(emptyTitle, emptyText);
    return;
  }

  host.innerHTML = '<div class="loading-state"><div class="loading-ring"></div></div>';

  /* Read each saved product straight from Shopify so titles, prices and
     availability in the drawer are never a stale local copy. */
  const cards = await Promise.all([...wishlist].map(async ([id, handle]) => {
    try {
      const response = await fetch(`${routes.root || '/'}products/${encodeURIComponent(handle)}.js`);
      if (!response.ok) {
        /* The product was removed or unpublished: drop it from the wishlist. */
        wishlist.delete(id);
        return null;
      }
      const product = await response.json();
      const image = product.featured_image
        ? product.featured_image.replace(/(\.[a-z]+)(\?|$)/i, '_200x$1$2')
        : '';
      const url = `${routes.root || '/'}products/${product.handle}`;
      return `<article class="cart-item">
        <a href="${url}">${image ? `<img src="${image}" alt="${escapeText(product.title)}" loading="lazy">` : ''}</a>
        <div>
          <h3><a href="${url}">${escapeText(product.title)}</a></h3>
          <strong>${money(product.price)}</strong>
          <a class="text-link" href="${url}">${escapeText(strings.viewProduct || '')}</a>
        </div>
      </article>`;
    } catch {
      return null;
    }
  }));

  const html = cards.filter(Boolean).join('');
  saveWishlist();
  syncWishButtons();
  host.innerHTML = html || emptyState(emptyTitle, emptyText);
}

function emptyState(title, text) {
  return `<div class="empty-state">${icon('bag')}<h3>${escapeText(title)}</h3><p>${escapeText(text)}</p>` +
    `<a class="pill" href="${routes.root || '/'}collections/all">${escapeText(strings.continueShopping || '')}</a></div>`;
}

function syncWishButtons() {
  $$('[data-wish]').forEach(button => {
    const on = wishlist.has(Number(button.dataset.wish));
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
  });
  setWishCount();
}

/* -------------------------------------------------------- product variants */

const productState = {
  variants: [],
  selected: null,
  quantity: 1,
  optionCount: 0
};

function readVariantData() {
  const script = $('[data-variant-data]');
  if (!script) return;
  try {
    productState.variants = JSON.parse(script.textContent) || [];
  } catch {
    productState.variants = [];
  }
  const form = $('#product-form');
  if (!form) return;
  productState.optionCount = $$('[data-option-index]', form)
    .reduce((max, el) => Math.max(max, Number(el.dataset.optionIndex)), 0);
  productState.selected = productState.variants.find(
    v => String(v.id) === $('[data-variant-id]', form)?.value
  ) || productState.variants[0];
}

function currentOptions() {
  const form = $('#product-form');
  const values = [];
  for (let position = 1; position <= productState.optionCount; position += 1) {
    const swatch = $(`.color-option[data-option-index="${position}"][aria-checked="true"]`, form);
    if (swatch) {
      values.push(swatch.dataset.optionValue);
      continue;
    }
    const radio = $(`input[data-option-index="${position}"]:checked`, form);
    values.push(radio ? radio.value : null);
  }
  return values;
}

function matchVariant(values) {
  return productState.variants.find(variant =>
    values.every((value, index) => value === null || variant.options[index] === value)
  );
}

function updateVariant() {
  const form = $('#product-form');
  if (!form) return;

  const variant = matchVariant(currentOptions());
  productState.selected = variant;

  const idInput = $('[data-variant-id]', form);
  const button = $('[data-add-to-cart]', form);
  const label = $('[data-add-label]', form);
  const priceEl = $('[data-price]');
  const compareEl = $('[data-compare-price]');
  const stickyPrice = $('[data-sticky-price]');

  if (!variant) {
    button.disabled = true;
    if (label) label.textContent = strings.soldOut || '';
    return;
  }

  idInput.value = variant.id;
  button.disabled = !variant.available;
  if (label) label.textContent = variant.available ? (strings.addToCart || label.textContent) : (strings.soldOut || '');
  if (priceEl) priceEl.textContent = money(variant.price);
  if (stickyPrice) stickyPrice.textContent = money(variant.price);

  if (compareEl) {
    if (variant.compare_at_price > variant.price) {
      compareEl.textContent = money(variant.compare_at_price);
      compareEl.hidden = false;
    } else {
      compareEl.hidden = true;
    }
  }

  /* Keep the URL shareable, the way Shopify's own themes do. */
  const url = new URL(location.href);
  url.searchParams.set('variant', variant.id);
  history.replaceState({}, '', url);

  if (variant.featured_media) showMedia(variant.featured_media.id);
}

function showMedia(mediaId) {
  const thumb = $(`.gallery-thumb[data-media-id="${mediaId}"]`);
  if (!thumb) return;
  selectMedia(thumb);
}

function selectMedia(thumb) {
  const main = $('#main-product-image');
  const img = $('img', thumb);
  if (!main || !img) return;
  main.src = img.src.replace(/width=\d+/, 'width=1200');
  main.srcset = '';
  main.alt = img.alt;
  main.dataset.full = thumb.dataset.full || main.src;
  $$('.gallery-thumb').forEach(b => {
    const on = b === thumb;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function selectColorSwatch(button) {
  const position = button.dataset.optionIndex;
  $$(`.color-option[data-option-index="${position}"]`).forEach(b => {
    const on = b === button;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  const label = $('#selected-color');
  if (label) label.textContent = button.dataset.optionValue;
  updateVariant();
}

/* ------------------------------------------------------------- quick view */

async function showQuickView(handle) {
  let dialog = $('#quick-modal');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'quick-modal';
    dialog.className = 'quick-modal';
    document.body.append(dialog);
  }

  dialog.innerHTML = '<div class="loading-state"><div class="loading-ring"></div></div>';
  dialog.showModal();

  let product;
  try {
    const response = await fetch(`${routes.root || '/'}products/${handle}.js`);
    if (!response.ok) throw new Error('product');
    product = await response.json();
  } catch {
    dialog.innerHTML = `<button class="icon-btn popup-close" aria-label="إغلاق">${icon('close')}</button>` +
      `<div class="quick-content"><p>${escapeText(strings.error || '')}</p></div>`;
    $('.popup-close', dialog).onclick = () => dialog.close();
    return;
  }

  const image = product.featured_image ? product.featured_image.replace(/(\.[a-z]+)(\?|$)/i, '_800x$1$2') : '';

  dialog.innerHTML = `
    <button class="icon-btn popup-close" aria-label="إغلاق العرض السريع">${icon('close')}</button>
    ${image ? `<img class="quick-photo" src="${image}" alt="${escapeText(product.title)}">` : ''}
    <div class="quick-content">
      <h2>${escapeText(product.title)}</h2>
      <p class="quick-price">${money(product.price)}</p>
      <form id="quick-form">
        ${product.options.map((option, index) => `
          <label>${escapeText(option.name)}
            <select name="option${index}" required>
              ${option.values.map(v => `<option>${escapeText(v)}</option>`).join('')}
            </select>
          </label>`).join('')}
        <button class="pill" type="submit">أضف للحقيبة</button>
      </form>
      <a class="text-link" href="${routes.root || '/'}products/${product.handle}">شوف كل التفاصيل</a>
    </div>`;

  $('.popup-close', dialog).onclick = () => dialog.close();

  $('#quick-form', dialog).onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const chosen = product.options.map((_, index) => form.elements[`option${index}`].value);
    const variant = product.variants.find(v => chosen.every((value, i) => v.options[i] === value));

    if (!variant) {
      toast(strings.soldOut || '');
      return;
    }

    const submit = $('button[type=submit]', form);
    submit.disabled = true;
    try {
      await addToCart(variant.id, 1, {
        price: variant.price,
        title: product.title,
        image: image,
        url: `${routes.root || '/'}products/${product.handle}`,
        options: variant.options.join(' / ')
      });
      dialog.close();
    } catch (error) {
      toast(error.message || strings.error);
    } finally {
      submit.disabled = false;
    }
  };
}

/* ----------------------------------------------------------------- motion */

function setupMotion() {
  if (reduced) return;
  document.documentElement.classList.add('js-motion');
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  }), { threshold: 0.08 });
  $$('.reveal').forEach(el => {
    observer.observe(el);
  });
}

/* ----------------------------------------------------------------- events */

function bindEvents() {
  document.addEventListener('click', async event => {
    const button = event.target.closest('button,a');
    if (!button) return;

    if (button.hasAttribute('data-panel')) {
      /* The cart icon is a real link to /cart, so only hijack it with JS. */
      event.preventDefault();
      openPanel(button.dataset.panel);
      return;
    }

    if (button.hasAttribute('data-close-panel')) closePanel();
    if (button.hasAttribute('data-dialog-close')) button.closest('dialog')?.close();

    if (button.hasAttribute('data-wish')) {
      event.preventDefault();
      const id = Number(button.dataset.wish);
      const added = !wishlist.has(id);
      if (added) wishlist.set(id, button.dataset.wishHandle || ''); else wishlist.delete(id);
      saveWishlist();
      syncWishButtons();
      toast(added ? strings.addedToWishlist : strings.removedFromWishlist);
    }

    if (button.hasAttribute('data-quick')) {
      event.preventDefault();
      showQuickView(button.dataset.quick);
    }

    if (button.hasAttribute('data-card-color')) {
      const card = button.closest('.product-card');
      const image = button.dataset.cardColor;
      if (card && image) {
        const primary = $('.primary-image', card);
        if (primary) {
          primary.src = image;
          primary.srcset = '';
        }
      }
      $$('.card-swatch', card).forEach(x => {
        x.classList.toggle('active', x === button);
        x.setAttribute('aria-pressed', String(x === button));
      });
    }

    if (button.hasAttribute('data-rail')) {
      const rail = $('#' + button.dataset.rail);
      if (rail) {
        const direction = getComputedStyle(rail).direction === 'rtl' ? -1 : 1;
        rail.scrollBy({
          left: Number(button.dataset.dir) * rail.clientWidth * 0.85 * direction,
          behavior: reduced ? 'instant' : 'smooth'
        });
      }
    }

    if (button.hasAttribute('data-rail-dot')) {
      const rail = $('#' + button.dataset.railId);
      const card = rail?.firstElementChild;
      if (rail && card) {
        const gap = parseFloat(getComputedStyle(rail).gap) || 0;
        const direction = getComputedStyle(rail).direction === 'rtl' ? -1 : 1;
        rail.scrollTo({
          left: Number(button.dataset.railDot) * (card.getBoundingClientRect().width + gap) * direction,
          behavior: reduced ? 'instant' : 'smooth'
        });
      }
      $$('.dot', button.parentElement).forEach(x => x.setAttribute('aria-pressed', String(x === button)));
    }

    if (button.hasAttribute('data-gallery')) {
      event.preventDefault();
      selectMedia(button);
    }

    if (button.classList.contains('color-option')) {
      selectColorSwatch(button);
    }

    if (button.hasAttribute('data-product-qty')) {
      const input = $('[data-quantity-input]');
      productState.quantity = Math.max(1, Math.min(99, productState.quantity + Number(button.dataset.productQty)));
      $('#selected-qty').textContent = productState.quantity;
      if (input) input.value = productState.quantity;
    }

    if (button.hasAttribute('data-cart-change')) {
      event.preventDefault();
      queueCartChange(button);
    }

    if (button.hasAttribute('data-back-options')) {
      $('#product-form')?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'center' });
      $('#product-form input[type=radio]')?.focus({ preventScroll: true });
    }

    if (button.classList.contains('main-image-button')) {
      event.preventDefault();
      const dialog = $('#zoom-modal');
      const main = $('#main-product-image');
      if (dialog && main) {
        const img = $('img', dialog);
        img.src = main.dataset.full || main.src;
        img.alt = main.alt;
        dialog.classList.remove('expanded');
        dialog.showModal();
      }
    }

    if (button.classList.contains('back-top')) {
      window.scrollTo({ top: 0, behavior: reduced ? 'instant' : 'smooth' });
    }
  });

  $('.overlay')?.addEventListener('click', () => closePanel());

  /* Add to cart. */
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('#product-form')) return;
    event.preventDefault();

    if (!form.reportValidity()) {
      const error = $('[data-form-error]', form);
      if (error) error.hidden = false;
      return;
    }
    const error = $('[data-form-error]', form);
    if (error) error.hidden = true;

    const submit = $('[data-add-to-cart]', form);
    const id = $('[data-variant-id]', form).value;
    submit.disabled = true;
    try {
      const chosen = productState.selected;
      await addToCart(id, productState.quantity, chosen && {
        price: chosen.price,
        title: $('.product-panel h1')?.textContent.trim(),
        image: $('#main-product-image')?.currentSrc || $('#main-product-image')?.src,
        url: location.pathname,
        options: chosen.options ? chosen.options.join(' / ') : ''
      });
    } catch (err) {
      toast(err.message || strings.error);
    } finally {
      submit.disabled = false;
    }
  });

  /* Variant radios. */
  document.addEventListener('change', event => {
    if (event.target.matches('#product-form input[data-option-index]')) {
      updateVariant();
    }
    if (event.target.id === 'collection-sort') {
      event.target.closest('form')?.submit();
    }
  });

  /* Colour swatch keyboard support. */
  document.addEventListener('keydown', event => {
    const group = event.target.closest('.color-options');
    if (!group) return;
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const options = $$('.color-option', group);
    const current = options.findIndex(b => b.getAttribute('aria-checked') === 'true');
    const last = options.length - 1;
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else {
      const step = event.key === 'ArrowLeft' ? 1 : -1;
      next = (current + step + options.length) % options.length;
    }
    selectColorSwatch(options[next]);
    options[next].focus();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePanel();

    if (event.key === 'Tab' && activePanel) {
      const controls = $$('button:not(:disabled),a,input,select,textarea', activePanel)
        .filter(x => x.getClientRects().length);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  $('#zoom-modal img')?.addEventListener('click', () => $('#zoom-modal').classList.toggle('expanded'));

  $$('dialog').forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right ||
                    event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) dialog.close();
  }));

  const scrollUpdate = () => {
    $('.header')?.classList.toggle('scrolled', scrollY > 40);
    const backTop = $('.back-top');
    if (backTop) backTop.hidden = scrollY < 500;
    const form = $('#product-form');
    const sticky = $('.sticky-buy');
    if (form && sticky) {
      sticky.classList.toggle('show', form.getBoundingClientRect().bottom < 80);
    }
  };
  window.addEventListener('scroll', scrollUpdate, { passive: true });
  scrollUpdate();
}

function init() {
  setCartCount(config.cartCount || 0);
  syncWishButtons();
  readVariantData();
  bindEvents();
  setupMotion();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
