# MedCards — Flashcards para Revalida & ENARE

MVP de um produto SaaS de flashcards médicos com repetição espaçada (algoritmo
estilo SM-2), autenticação, paywall de conteúdo premium e assinatura
recorrente via Mercado Pago (PIX/boleto/cartão).

Stack: HTML/CSS/JS puro no frontend (sem build step) + [Supabase](https://supabase.com)
(Postgres + Auth + Row Level Security + Edge Functions) no backend. Escolhida
de propósito: menos código próprio de autenticação/pagamento para manter,
que é onde a maioria dos bugs de segurança em produtos que cobram de
usuários acontece.

## 1. Criar o projeto Supabase

1. Crie uma conta em [supabase.com](https://supabase.com) e um novo projeto.
2. Em **SQL Editor**, cole e rode o conteúdo de `supabase/schema.sql` (cria
   tabelas, políticas de RLS e um baralho demo gratuito).
3. Em **Authentication > Providers**, confirme que "Email" está habilitado.
4. Em **Authentication > Settings**, habilite "Confirm email" antes de ir
   para produção (evita contas falsas/spam).
5. Em **Project Settings > API**, copie a **Project URL** e a **anon public
   key** para `config.js` (na raiz de `flashcards-medicos/`):

   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
     SUPABASE_ANON_KEY: "sua-anon-key",
     PRICE_LABEL: "R$ 49,90/mês",
   };
   ```

## 2. Configurar o Mercado Pago

1. Crie uma conta de vendedor em [mercadopago.com.br](https://www.mercadopago.com.br)
   e uma aplicação em [Suas integrações](https://www.mercadopago.com.br/developers/panel).
2. Copie o **Access Token de produção** (não o de teste, quando for cobrar de verdade).
3. Configure um **Webhook** apontando para a URL da função `mp-webhook`
   (você vai obter essa URL no passo 3), selecionando o tópico de
   **assinaturas (preapproval)**. O Mercado Pago vai gerar uma **chave
   secreta de assinatura de webhook** — guarde-a.

## 3. Deploy das Edge Functions

Instale a [Supabase CLI](https://supabase.com/docs/guides/cli) e, na pasta
`flashcards-medicos/`, rode:

```bash
supabase login
supabase link --project-ref SEU-PROJECT-REF

supabase secrets set \
  MP_ACCESS_TOKEN=seu-access-token-do-mercado-pago \
  MP_WEBHOOK_SECRET=sua-chave-secreta-do-webhook \
  MP_MONTHLY_PRICE=49.90 \
  APP_URL=https://seudominio.com

supabase functions deploy mp-create-preapproval
supabase functions deploy mp-webhook --no-verify-jwt
```

`--no-verify-jwt` é necessário no webhook porque quem chama é o Mercado
Pago, não um usuário logado — a segurança dessa função vem da validação
HMAC (`x-signature`) feita dentro do código, não de um JWT do Supabase.

Depois do deploy, pegue a URL pública da função `mp-webhook`
(algo como `https://SEU-PROJETO.functions.supabase.co/mp-webhook`) e
cole no painel de webhooks do Mercado Pago (passo 2).

`SUPABASE_SERVICE_ROLE_KEY` já é injetada automaticamente pelo Supabase nas
Edge Functions — não precisa configurá-la manualmente, mas nunca a copie
para o frontend.

## 4. Virar administrador (para cadastrar seus baralhos)

Depois de criar sua conta pelo próprio app, rode no SQL Editor do Supabase:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'seu-email@exemplo.com');
```

Com isso você ganha acesso à aba **Admin** no app para criar baralhos e
cadastrar os cartões (pergunta/resposta) — esse é o conteúdo que você está
vendendo, então escreva com cuidado e revise clinicamente antes de publicar.

## 5. Deploy do site

`flashcards-medicos/` é um site estático (`index.html` + `config.js`).
Pode publicar em qualquer host estático com HTTPS gratuito:

- **Vercel** ou **Netlify**: aponte para a pasta `flashcards-medicos/`, sem
  build command.
- **Cloudflare Pages**: mesma coisa.

Depois de publicar, atualize o secret `APP_URL` (passo 3) com o domínio
final e rode `supabase functions deploy mp-create-preapproval` de novo.

## Como funciona a assinatura

1. Usuário clica em "Assinar agora" → o frontend chama a Edge Function
   `mp-create-preapproval`, que cria uma assinatura recorrente no Mercado
   Pago em nome do usuário logado e devolve o link de checkout.
2. Usuário paga no Mercado Pago (PIX, boleto ou cartão) e é redirecionado
   de volta para o app.
3. O Mercado Pago notifica a Edge Function `mp-webhook` (com assinatura
   HMAC validada) quando o pagamento é autorizado, pausado ou cancelado —
   essa função atualiza a tabela `subscriptions`.
4. As políticas de RLS do Postgres liberam o conteúdo dos baralhos premium
   automaticamente para quem tem assinatura `active`. O catálogo (títulos e
   descrições) fica visível para todo mundo, para funcionar como vitrine.

## Checklist antes de vender de verdade

- [ ] Trocar o access token do Mercado Pago de teste para o de produção.
- [ ] Habilitar confirmação de e-mail no Supabase Auth.
- [ ] Escrever uma Política de Privacidade e Termos de Uso (a LGPD exige
      isso para qualquer produto brasileiro que colete e-mail/dados de
      pagamento) e linkar no rodapé da landing page.
- [ ] Revisar clinicamente todo o conteúdo dos flashcards antes de publicar
      — é material de estudo, precisão importa.
- [ ] Configurar um domínio próprio com HTTPS (Vercel/Netlify já fazem isso
      automaticamente).
- [ ] Testar o fluxo de assinatura de ponta a ponta com uma cobrança real
      pequena antes de divulgar.
- [ ] Configurar backups automáticos do banco (Supabase faz backup diário
      nos planos pagos — vale considerar antes de ter pagantes).

## Estrutura de arquivos

```
flashcards-medicos/
  index.html                          → app inteiro (landing, auth, estudo, admin)
  config.js                           → chaves públicas do Supabase (edite antes de publicar)
  supabase/
    schema.sql                        → tabelas + RLS + seed do baralho demo
    functions/
      mp-create-preapproval/index.ts  → cria assinatura no Mercado Pago
      mp-webhook/index.ts             → recebe confirmação de pagamento (com validação HMAC)
```

## Limitações conhecidas do MVP (próximos passos sugeridos)

- Não há fluxo de "esqueci minha senha" na UI (o Supabase Auth suporta,
  falta o formulário).
- Não há import em massa de flashcards (hoje é cartão por cartão no admin).
- Não há cancelamento de assinatura pelo app — o usuário cancela direto no
  Mercado Pago por enquanto; dá pra adicionar um botão que chama a API de
  cancelamento de preapproval depois.
- Preço fixo único; se quiser múltiplos planos, o schema de `subscriptions`
  já comporta, falta a lógica no frontend.
