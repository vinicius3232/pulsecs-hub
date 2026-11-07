import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('public/index.html', 'utf8');

test('A11Y-GUARD: todos os <select> devem ter aria-label ou aria-labelledby', () => {
  const selectMatches = [...html.matchAll(/<select\b([^>]*)>/g)];
  const unlabelled = selectMatches.filter(m => !m[1].includes('aria-label') && !m[1].includes('aria-labelledby'));
  assert.equal(unlabelled.length, 0, `Existem ${unlabelled.length} <select> sem aria-label/aria-labelledby`);
});

test('A11Y-GUARD: todos os <input> interativos devem ter rótulo acessível', () => {
  const inputMatches = [...html.matchAll(/<input\b([^>]*)>/g)];
  const interactive = inputMatches.filter(m => !m[1].includes('type="hidden"') && !m[1].includes("type='hidden'"));
  const unlabelled = interactive.filter(m => {
    const hasAria = m[1].includes('aria-label') || m[1].includes('aria-labelledby');
    const hasTitle = m[1].includes('title=');
    const hasId = m[1].match(/id=["']([^"']+)["']/);
    const hasForLabel = hasId && html.includes(`for="${hasId[1]}"`);
    return !hasAria && !hasTitle && !hasForLabel;
  });
  assert.equal(unlabelled.length, 0, `Existem ${unlabelled.length} <input> sem rótulo acessível`);
});

test('A11Y-GUARD: todas as <textarea> devem ter rótulo acessível', () => {
  const textareaMatches = [...html.matchAll(/<textarea\b([^>]*)>/g)];
  const unlabelled = textareaMatches.filter(m => !m[1].includes('aria-label') && !m[1].includes('aria-labelledby'));
  assert.equal(unlabelled.length, 0, `Existem ${unlabelled.length} <textarea> sem rótulo acessível`);
});

test('A11Y-GUARD: todos os modais reais devem ter role="dialog" e aria-modal="true"', () => {
  const modalIds = [
    'calendar-meeting-modal',
    'master-auth-modal',
    'master-config-modal',
    'client-form-modal',
    'client-modal',
    'notes-modal'
  ];

  modalIds.forEach(id => {
    const regex = new RegExp(`<div[^>]*id=["']${id}["'][^>]*>`, 'i');
    const match = html.match(regex);
    assert.ok(match, `Modal com id "${id}" deve existir no HTML`);
    const tag = match[0];
    assert.ok(tag.includes('role="dialog"'), `Modal "${id}" deve ter role="dialog"`);
    assert.ok(tag.includes('aria-modal="true"'), `Modal "${id}" deve ter aria-modal="true"`);
    assert.ok(tag.includes('aria-labelledby='), `Modal "${id}" deve ter aria-labelledby apontando para seu título`);
  });
});

test('A11Y-GUARD: foco visível (:focus-visible) com tom petróleo e alvos de toque configurados', () => {
  assert.ok(html.includes(':focus-visible'), 'CSS deve ter regra explícita de :focus-visible');
  assert.ok(html.includes('#0f6f70') || html.includes('var(--petrol)'), 'Anel de foco deve utilizar o verde-petróleo da marca');
  assert.ok(html.includes('min-height: 38px') || html.includes('min-height: 40px') || html.includes('min-height: 42px'), 'Alvos de toque devem ter piso acessível >= 36px');
});

test('A11Y-GUARD: ModalA11y com listeners de Escape e Focus Trap configurados', () => {
  assert.ok(html.includes('ModalA11y'), 'Deve existir o helper ModalA11y no script');
  assert.ok(html.includes('Escape'), 'Deve haver listener para tecla Escape para fechar modais');
  assert.ok(html.includes('shiftKey'), 'Deve haver lógica de Focus Trap cíclico com Tab e Shift+Tab');
});

test('A11Y-GUARD: badges numéricos de triagem e onboarding possuem aria-label descritivo', () => {
  assert.ok(html.includes('id="badge-churn-count" aria-label='), 'Badge de risco churn deve ter aria-label');
  assert.ok(html.includes('id="badge-onboarding-count" aria-label='), 'Badge de onboarding deve ter aria-label');
  assert.ok(html.includes('id="badge-sheet-pending" aria-label='), 'Badge de planilhas pendentes deve ter aria-label');
});
