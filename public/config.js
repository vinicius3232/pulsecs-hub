// Configuração PÚBLICA do front (nada secreto aqui).
// A chave "anon" do Supabase é pública por desenho: quem protege os dados é a RLS (migration 0004).
// NUNCA coloque aqui a service role key nem chaves de IA.
//
// Vazio = modo demonstração (sem login, dados locais). Preenchido = login obrigatório.
window.PULSECS_CONFIG = {
  supabaseUrl: '',      // ex.: 'https://xxxxxxxx.supabase.co'
  supabaseAnonKey: ''   // ex.: 'eyJhbGciOi...' (a chave "anon public")
};
