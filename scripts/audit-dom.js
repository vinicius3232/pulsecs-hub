import fs from 'fs';

const html = fs.readFileSync('public/index.html', 'utf8');

console.log('=== AUDITORIA ESTÁTICA DO DOM (INDEX.HTML) ===');

// 1. SELECTS
const selectMatches = [...html.matchAll(/<select\b([^>]*)>/g)];
const unlabelledSelects = selectMatches.filter(m => !m[1].includes('aria-label') && !m[1].includes('aria-labelledby'));
console.log(`\n1. SELECTS: Total = ${selectMatches.length} | Sem aria-label/labelledby = ${unlabelledSelects.length}`);
unlabelledSelects.forEach((m, idx) => {
  console.log(`   [${idx + 1}] ${m[0].substring(0, 90)}...`);
});

// 2. INPUTS (text, search, url, etc. excluindo hidden/checkbox/submit)
const inputMatches = [...html.matchAll(/<input\b([^>]*)>/g)];
const interactiveInputs = inputMatches.filter(m => !m[1].includes('type="hidden"') && !m[1].includes("type='hidden'"));
const unlabelledInputs = interactiveInputs.filter(m => !m[1].includes('aria-label') && !m[1].includes('aria-labelledby') && !m[1].includes('title='));
console.log(`\n2. INPUTS INTERATIVOS: Total = ${interactiveInputs.length} | Sem aria-label/title = ${unlabelledInputs.length}`);
unlabelledInputs.forEach((m, idx) => {
  console.log(`   [${idx + 1}] ${m[0].substring(0, 90)}...`);
});

// 3. TEXTAREAS
const textareaMatches = [...html.matchAll(/<textarea\b([^>]*)>/g)];
const unlabelledTextareas = textareaMatches.filter(m => !m[1].includes('aria-label') && !m[1].includes('aria-labelledby'));
console.log(`\n3. TEXTAREAS: Total = ${textareaMatches.length} | Sem aria-label = ${unlabelledTextareas.length}`);
unlabelledTextareas.forEach((m, idx) => {
  console.log(`   [${idx + 1}] ${m[0].substring(0, 90)}...`);
});

// 4. MODAIS
const modalDivs = [...html.matchAll(/<div[^>]*\bid=["']([^"']*(?:modal|dialog)[^"']*)["'][^>]*>/gi)];
const uniqueModals = [];
const seenIds = new Set();
for (const m of modalDivs) {
  const id = m[1];
  // filtrar apenas os containers principais de modais
  if (!id.includes('avatar') && !id.includes('name') && !id.includes('meta') && !id.includes('grid') && !id.includes('factors') && !id.includes('timeline') && !id.includes('header') && !id.includes('body') && !id.includes('content') && !seenIds.has(id)) {
    seenIds.add(id);
    uniqueModals.push({ id, tag: m[0], hasRole: m[0].includes('role="dialog"'), hasModal: m[0].includes('aria-modal') });
  }
}
console.log(`\n4. CONTAINERS DE MODAIS: Encontrados = ${uniqueModals.length}`);
uniqueModals.forEach(m => {
  console.log(`   - ID: ${m.id.padEnd(28)} | role="dialog": ${m.hasRole} | aria-modal: ${m.hasModal}`);
});

// 5. BADGES DO MENU
const badgeMatches = [...html.matchAll(/id=["'](badge-[^"']+)["'][^>]*>/g)];
console.log(`\n5. BADGES NUMÉRICOS: Total = ${badgeMatches.length}`);
badgeMatches.forEach(b => {
  const hasAria = b[0].includes('aria-label');
  console.log(`   - ID: ${b[1]} | aria-label: ${hasAria}`);
});
