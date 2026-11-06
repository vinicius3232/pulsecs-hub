/**
 * PulseCS — Script de Migração do LocalStorage para Supabase
 * Converte o dump JSON do PulseCS diretamente em queries SQL para o PostgreSQL / Supabase
 * 
 * Uso:
 * node supabase/migrate-localstorage.js [caminho_do_backup.json]
 */

const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2] || path.resolve(__dirname, '../backup_sample.json');

function generateSqlFromBackup(jsonData) {
  const clients = jsonData.clients || [];
  const team = jsonData.team || [];
  const calendar = jsonData.calendar || [];

  console.log(`-- =================================================`);
  console.log(`-- PULSECS MIGRATION SCRIPT: ${clients.length} Clientes`);
  console.log(`-- Gerado em: ${new Date().toISOString()}`);
  console.log(`-- =================================================\n`);

  console.log(`-- 1. Inserir ou Atualizar Empresas`);
  clients.forEach(c => {
    const escapedName = c.name.replace(/'/g, "''");
    const escapedRisk = (c.riskReason || '').replace(/'/g, "''");
    const eligibleLives = c.tier === 'Enterprise' ? 1000 : (c.tier === 'Mid-Market' ? 500 : 200);
    const activeLives = Math.round(eligibleLives * (c.hs / 100));
    const mauLives = Math.round(activeLives * 0.85);
    const savings = c.mrr * 3.8;

    console.log(`
INSERT INTO public.companies (
  name, tier, mrr, pepm, eligible_lives, active_lives, mau_lives, total_savings,
  phase, health_score, health_status, risk_reason
) VALUES (
  '${escapedName}', '${c.tier}', ${c.mrr}, 18.00, ${eligibleLives}, ${activeLives}, ${mauLives}, ${savings},
  '${c.phase}', ${c.hs}, '${c.status}', '${escapedRisk}'
) ON CONFLICT (name) DO UPDATE SET
  health_score = EXCLUDED.health_score,
  phase = EXCLUDED.phase,
  mrr = EXCLUDED.mrr;
    `.trim());
  });

  console.log(`\n-- Migração concluída com sucesso!`);
}

if (fs.existsSync(inputFile)) {
  const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  generateSqlFromBackup(data);
} else {
  console.log(`Arquivo ${inputFile} não encontrado. Usando clientes em memória.`);
  // Exemplo de saída
  generateSqlFromBackup({
    clients: [
      { id: 1, name: 'Rede Mais Fidelidade', tier: 'Enterprise', mrr: 14500, hs: 82, status: 'green', phase: 'Treinamento', riskReason: 'Nenhum' },
      { id: 2, name: 'Clube Prime Associados', tier: 'Mid-Market', mrr: 8900, hs: 38, status: 'red', phase: 'Config & Carga', riskReason: 'Sem login há 12 dias.' }
    ]
  });
}
