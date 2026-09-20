export const BRAND = {
  key: 'sanchez',
  name: 'SANCHEZ',
  mark: 'S',
  productName: 'Live Q&A',
  csvPrefix: 'sanchez-qna'
};

const PAGE_TITLES = {
  admin: 'Админка — {name} · {productName}',
  moderator: 'Модератор — {name} · {productName}',
  guest: 'Задать вопрос — {name}',
  login: '{name} · {productName} — Вход'
};

export function applyBrandIdentity(page) {
  document.querySelectorAll('[data-brand-mark]').forEach((element) => {
    element.textContent = BRAND.mark;
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
}
