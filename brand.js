import { TASIGO_ESG_BRAND } from './brand-presets/tasigo-esg.js';

export const SANCHEZ_BRAND = {
  key: 'sanchez',
  name: 'SANCHEZ_AI_SOLUTIONS',
  mark: 'S',
  productName: 'Live Q&A',
  csvPrefix: 'sanchez-qna',
  logoUrl: null,
  faviconUrl: null,
  stylesheetHref: './brands/sanchez.css'
};

export const BRAND = SANCHEZ_BRAND;

const TASIGO_ESG_ROOM_PREFIX = 'tasigo-esg-';
const TASIGO_ESG_ROOM_BRAND = {
  ...TASIGO_ESG_BRAND,
  stylesheetHref: './brands/tasigo-esg.css'
};

const ADMIN_ACCORDION_MEDIA = '(max-width: 1024px)';
let adminAccordionInertGuardInitialized = false;

function initAdminAccordionInertGuard() {
  if (adminAccordionInertGuardInitialized || typeof window.matchMedia !== 'function') return;
  adminAccordionInertGuardInitialized = true;

  const media = window.matchMedia(ADMIN_ACCORDION_MEDIA);
  const sync = () => {
    const accordionMode = media.matches;
    document.querySelectorAll('.admin-console [data-responsive-section]').forEach((section) => {
      const body = section.querySelector('.responsive-section-body');
      if (!body) return;
      body.inert = accordionMode && section.dataset.accordionCollapsed === 'true';
    });
  };

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.attributeName === 'data-accordion-collapsed')) sync();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-accordion-collapsed']
  });
  media.addEventListener('change', sync);
  sync();
}

export function getBrandForRoute(roomSlug, eventKey = null) {
  if (roomSlug?.startsWith(TASIGO_ESG_ROOM_PREFIX) || eventKey?.startsWith(TASIGO_ESG_ROOM_PREFIX)) {
    return TASIGO_ESG_ROOM_BRAND;
  }
  return SANCHEZ_BRAND;
}

export function getBrandForRoomSlug(roomSlug) {
  return getBrandForRoute(roomSlug, null);
}

const PAGE_TITLES = {
  admin: 'Админка — {name} · {productName}',
  moderator: 'Модератор — {name} · {productName}',
  guest: 'Задать вопрос — {name}',
  login: '{name} · {productName} — Вход'
};

export function applyBrandIdentity(page, brand = BRAND) {
  if (page === 'admin') initAdminAccordionInertGuard();

  const stylesheet = document.querySelector('[data-brand-stylesheet]');
  if (stylesheet) stylesheet.href = brand.stylesheetHref;

  document.querySelectorAll('[data-brand-mark]').forEach((element) => {
    if (!brand.logoUrl) {
      element.classList.remove('has-brand-image');
      element.textContent = brand.mark;
      return;
    }

    const image = document.createElement('img');
    image.className = 'brand-logo-image';
    image.src = brand.logoUrl;
    image.alt = brand.name;
    image.addEventListener('error', () => {
      element.classList.remove('has-brand-image');
      element.textContent = brand.mark;
    }, { once: true });

    element.classList.add('has-brand-image');
    element.replaceChildren(image);
  });
  document.querySelectorAll('[data-brand-name]').forEach((element) => {
    element.textContent = brand.name;
  });
  document.querySelectorAll('[data-brand-product]').forEach((element) => {
    element.textContent = brand.productName;
  });

  const title = PAGE_TITLES[page];
  if (title) {
    document.title = title
      .replace('{name}', brand.name)
      .replace('{productName}', brand.productName);
  }

  const existingFavicon = document.head.querySelector('link[data-brand-favicon]');
  if (!brand.faviconUrl) {
    existingFavicon?.remove();
    return;
  }

  const favicon = existingFavicon || document.createElement('link');
  favicon.rel = 'icon';
  favicon.dataset.brandFavicon = '';
  favicon.href = brand.faviconUrl;
  if (!existingFavicon) {
    document.head.append(favicon);
  }
}
