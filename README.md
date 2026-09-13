# Gerador Inteligente de Simulados ENEM

Aplicativo que gera questões inéditas no padrão ENEM (com gabarito, resolução comentada e
análise de cada alternativa), incluindo recursos visuais opcionais — imagem gerada por IA,
gráfico ou tabela — para professores montarem simulados personalizados por área, disciplina,
tema, dificuldade e competência/habilidade da Matriz de Referência oficial.

## Como usar

Basta abrir o arquivo **`index.html`** direto no navegador (localmente, ou publicado via
GitHub Pages/Netlify/qualquer hospedagem de arquivo estático). Não é preciso instalar nada
nem configurar chave de API no navegador — o app já vem pronto para uso.

## Arquitetura

O app é 100% estático no navegador (`index.html`, um único arquivo autocontido) e depende de
duas Supabase Edge Functions próprias para gerar conteúdo com segurança:

- **`generate-question`** — recebe os parâmetros da questão (área, disciplina, tema,
  dificuldade, recurso visual, competência/habilidade) e chama a API da Anthropic (Claude)
  para elaborar a questão completa, com revisão pedagógica automática opcional. Também
  atende o modo "refazer recurso visual", que gera só uma nova versão do gráfico/tabela/
  imagem de uma questão já pronta, mantendo o resto intacto.
- **`generate-image`** — recebe uma descrição e chama a API de imagens da OpenAI
  (`gpt-image-2` por padrão) para gerar a ilustração usada nas questões do tipo "imagem".
- **`whatsapp-webhook`** — recebe as mensagens do WhatsApp (Meta Cloud API) enviadas ao
  número oficial do Gerador ENEM. Nesta fase faz o **pareamento**: o professor clica em
  "Solicitar simulados pelo WhatsApp → Vincular meu WhatsApp" no app, recebe um código de
  6 dígitos e o envia pelo WhatsApp; o webhook confere a assinatura da Meta, valida o código
  e liga o telefone à conta. Pedir simulados pela conversa é a próxima fase.

As chaves de API (`ANTHROPIC_API_KEY` e `OPENAI_API_KEY`) e as credenciais do WhatsApp
(`WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_WABA_ID`) ficam guardadas só nos **secrets**
do projeto Supabase que hospeda essas funções — nunca aparecem no navegador, neste
repositório, ou em qualquer arquivo do projeto.

```
index.html                            → app final, pronto para uso (gerado por src/combine.py)
src/app_template.html                 → HTML/CSS base do app
src/app.js                            → lógica do app (client-side)
src/app_data.json                     → Matriz de Referência do ENEM + contexto pedagógico por área
src/combine.py                        → script que combina os três arquivos acima em index.html
supabase/functions/generate-question/ → Edge Function que gera as questões (Claude)
supabase/functions/generate-image/    → Edge Function que gera as imagens (GPT Image)
supabase/functions/whatsapp-webhook/  → Edge Function do WhatsApp (pareamento) + testes Deno
supabase/migrations/                  → migrações do banco (tabelas perfis e wa_*, RLS)
tests/                                → testes automatizados (Playwright) do app
```

## Caixa "Solicitar simulados pelo WhatsApp" (v15)

Logo abaixo do cabeçalho, para usuários logados. Gera um código de 6 dígitos (função
`wa_gerar_codigo` do banco, só para o usuário autenticado), abre o WhatsApp com a mensagem
"Vincular conta 123456" pronta (link `wa.me` para o número em `WHATSAPP_NUMERO_EMPRESA`, no
topo de `src/app.js`) e acompanha o pareamento consultando `wa_meu_status` a cada 4 s. Teste
sem rede: `node tests/verify_whatsapp_box.js` (o supabase-js é substituído por um stub).

## Reconstruindo o `index.html` após editar `src/`

```bash
cd src
python3 combine.py
```

## Publicando as Edge Functions em um novo projeto Supabase

1. Crie um projeto no [Supabase](https://supabase.com).
2. Publique as duas funções em `supabase/functions/` (via Supabase CLI ou dashboard).
3. Em **Project Settings → Edge Functions → Secrets**, adicione:
   - `ANTHROPIC_API_KEY` — sua chave da [Anthropic](https://platform.claude.com).
   - `OPENAI_API_KEY` — sua chave da [OpenAI](https://platform.openai.com).
   - (opcionais) `ANTHROPIC_MODEL`, `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY`,
     `MAX_DAILY_QUESTIONS`, `MAX_DAILY_IMAGES`.
4. Atualize as constantes `QUESTION_BACKEND_URL` e `IMAGE_BACKEND_URL` no topo de
   `src/app.js` com a URL do seu próprio projeto Supabase, e rode `combine.py` de novo.

## Segurança

Nenhuma chave de API, senha ou token está neste repositório. As funções de backend
(`supabase/functions/`) só funcionam com as chaves configuradas como *secrets* no projeto
Supabase de quem as publica — nunca commitadas em código.
