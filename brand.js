export const BRAND = {
  key: 'sanchez',
  name: 'SANCHEZ',
  mark: 'S',
  productName: 'Live Q&A',
  csvPrefix: 'sanchez-qna',
  logoUrl: null,
  faviconUrl: null
};

const PAGE_TITLES = {
  admin: 'Админка — {name} · {productName}',
  moderator: 'Модератор — {name} · {productName}',
  guest: 'Задать вопрос — {name}',
  login: '{name} · {productName} — Вход'
};

export function applyBrandIdentity(page) {
  document.querySelectorAll('[data-brand-mark]').forEach((element) => {
    if (!BRAND.logoUrl) {
      element.classList.remove('has-brand-image');
      element.textContent = BRAND.mark;
      return;
    }

    const image = document.createElement('img');
    image.className = 'brand-logo-image';
    image.src = BRAND.logoUrl;
    image.alt = BRAND.name;
    image.addEventListener('error', () => {
      element.classList.remove('has-brand-image');
      element.textContent = BRAND.mark;
    }, { once: true });

    element.classList.add('has-brand-image');
    element.replaceChildren(image);
  });
  document.querySelectorAll('[data-brand-name]').forEach((element) => {
    element.textContent = BRAND.name;
  });
  document.querySelectorAll('[data-brand-product]').forEach((element) => {
    element.textContent = BRAND.productName;
  });

  const title = PAGE_TITLES[page];
  if (title) {
    document.title = title
      .replace('{name}', BRAND.name)
      .replace('{productName}', BRAND.productName);
  }

  const existingFavicon = document.head.querySelector('link[data-brand-favicon]');
  if (!BRAND.faviconUrl) {
    existingFavicon?.remove();
    return;
  }

  const favicon = existingFavicon || document.createElement('link');
  favicon.rel = 'icon';
  favicon.dataset.brandFavicon = '';
  favicon.href = BRAND.faviconUrl;
  if (!existingFavicon) {
    document.head.append(favicon);
  }
}
