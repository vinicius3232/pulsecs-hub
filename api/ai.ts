import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, bearerToken, getSupabaseUserId, rateLimited } from './_lib/security.js';

const MAX_PROMPT_CHARS = 4000;

const PROVIDERS = {
  groq: {
    endpoint: 'https://api.groq.com/openai/v1',
    env: 'GROQ_API_KEY',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
  },
  gemini: {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    env: 'GEMINI_API_KEY',
    models: ['gemini-2.5-flash']
  },
  openai: {
    endpoint: 'https://api.openai.com/v1',
    env: 'OPENAI_API_KEY',
    models: ['gpt-4o-mini']
  }
} as const;

type ProviderName = keyof typeof PROVIDERS;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1. Autenticação: exige sessão válida do Supabase (falha fechada se não configurado)
  const userId = await getSupabaseUserId(bearerToken(req));
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 2. Limite de uso por usuário: 20 chamadas / minuto
  if (rateLimited(`ai:${userId}`, 20, 60_000)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too Many Requests' });
  }

  // 3. Validação de entrada
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
  if (prompt.length > MAX_PROMPT_CHARS) {
    return res.status(413).json({ error: `Prompt exceeds ${MAX_PROMPT_CHARS} characters` });
  }

  const provider: ProviderName = (body.provider in PROVIDERS ? body.provider : 'groq') as ProviderName;
  const cfg = PROVIDERS[provider];
  const models = cfg.models as readonly string[];
  const model = typeof body.model === 'string' && models.includes(body.model) ? body.model : models[0];

  const key = process.env[cfg.env];
  if (!key) {
    return res.status(503).json({ error: `Provider "${provider}" is not configured` });
  }

  try {
    const upstream = await fetch(`${cfg.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content:
              'Você é o Pulse Copilot, assistente de Customer Success especializado em Benefícios Corporativos e retenção de contas B2B. Forneça respostas práticas, executivas e orientadas a dados de adesão e ROI.'
          },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!upstream.ok) {
      // Não repassa o corpo do erro do provedor ao cliente; registra só o status.
      console.error('AI upstream error', provider, upstream.status);
      return res.status(502).json({ error: 'AI provider error' });
    }

    const data = await upstream.json();
    const content = data.choices?.[0]?.message?.content || 'Sem resposta gerada pelo modelo.';
    return res.status(200).json({ content, provider, model });
  } catch (err) {
    console.error('AI handler error', (err as Error)?.name);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
