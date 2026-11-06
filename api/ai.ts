import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Configuração de CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { prompt, provider = 'groq', model } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // 1. Identificar chaves seguras de ambiente
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    let targetEndpoint = 'https://api.groq.com/openai/v1';
    let targetKey = groqKey;
    let targetModel = model || 'llama-3.3-70b-versatile';

    if (provider === 'gemini' && geminiKey) {
      targetEndpoint = 'https://generativelanguage.googleapis.com/v1beta/openai';
      targetKey = geminiKey;
      targetModel = model || 'gemini-2.5-flash';
    } else if (provider === 'openai' && openaiKey) {
      targetEndpoint = 'https://api.openai.com/v1';
      targetKey = openaiKey;
      targetModel = model || 'gpt-4o-mini';
    } else if (provider === 'groq' && groqKey) {
      targetEndpoint = 'https://api.groq.com/openai/v1';
      targetKey = groqKey;
      targetModel = model || 'llama-3.3-70b-versatile';
    }

    // Se houver chave no servidor Vercel, faz a chamada real
    if (targetKey) {
      const response = await fetch(`${targetEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${targetKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            {
              role: 'system',
              content:
                'Você é o Pulse Copilot, assistente inteligente de Customer Success especializado em Benefícios Corporativos e retenção de contas B2B. Forneça respostas práticas, executivas e orientadas a dados de adesão e ROI.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: 'Upstream AI Provider Error', details: errText });
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || 'Sem resposta gerada pelo modelo.';
      return res.status(200).json({
        content,
        provider,
        model: targetModel,
        cached: false
      });
    }

    // Fallback Simulado Pro caso não haja chave cadastrada nas Env Vars da Vercel
    return res.status(200).json({
      content: `[Pulse Copilot Serverless Engine]\nDiagnóstico executivo: O cliente requer alinhamento prioritário com o RH para destravar o cadastro de novos colaboradores e elevar o engajamento com os benefícios de maior margem. Proposta de ação rápida aprovada para envio.`,
      provider: 'simulated-serverless',
      model: 'pulsecs-lpu-fallback',
      note: 'Para usar inferência real de alta velocidade, cadastre GROQ_API_KEY no painel da Vercel (Settings > Environment Variables).'
    });
  } catch (error: any) {
    console.error('AI Serverless Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
