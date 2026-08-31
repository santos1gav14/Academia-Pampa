# api-reset-senha

Serverzinho gratuito (Vercel) que permite qualquer usuário (menos admins)
redefinir a própria senha sozinho, confirmando SARAM + telefone cadastrado.
Existe porque o Firestore (onde ficam os dados do app) não tem nenhuma
autoridade pra mudar senha do Firebase Authentication — só uma chave
privilegiada consegue, e essa chave não pode ficar exposta no navegador.
Aqui ela fica guardada em segredo, do lado do servidor.

## Deploy (uma vez só)

1. Crie uma conta grátis em [vercel.com](https://vercel.com) — pode entrar
   com sua conta do GitHub direto, não precisa de cartão de crédito.
2. No dashboard da Vercel: **Add New** → **Project**.
3. Importe o repositório `santos1gav14/Academia-Pampa` (autorize a Vercel a
   acessar seus repositórios do GitHub se ela pedir).
4. Antes de clicar em Deploy, configure:
   - **Root Directory**: clique em "Edit" e selecione a pasta
     `api-reset-senha` (importante — sem isso a Vercel não vai achar a
     função).
   - **Environment Variables**: adicione uma variável:
     - Nome: `FIREBASE_SERVICE_ACCOUNT`
     - Valor: cole todo o conteúdo do arquivo `service-account.json` (o
       mesmo usado nos scripts de `migrations/` e `scripts/` — se não tiver
       mais, gere um novo em Console do Firebase → ⚙️ Configurações do
       projeto → Contas de serviço → Gerar nova chave privada).
5. Clique em **Deploy** e espere terminar (leva menos de um minuto).
6. A Vercel mostra uma URL tipo `https://api-reset-senha-xxxx.vercel.app`.
   Copie essa URL.
7. No arquivo `index.html` (raiz do projeto), ache a linha:
   ```js
   const RESET_SENHA_API_URL = "COLE_AQUI_A_URL_DA_VERCEL/api/reset-password";
   ```
   e troque pela URL que a Vercel te deu, adicionando `/api/reset-password`
   no final. Exemplo:
   ```js
   const RESET_SENHA_API_URL = "https://api-reset-senha-xxxx.vercel.app/api/reset-password";
   ```
8. Salve, comite e publique o `index.html` (do jeito que você já faz hoje).

Depois disso, o link **"Esqueci minha senha"** na tela de login passa a
funcionar de verdade.

## Segurança — o que essa função garante

- **Contas de admin nunca podem ser redefinidas por aqui.** Se o SARAM
  informado pertence a um admin, a função recusa — o reset de admin
  continua exigindo o script `scripts/resetar-senha.js`, rodado por outro
  admin.
- **Limite de tentativas**: no máximo 5 tentativas por SARAM a cada 15
  minutos, guardado num documento em `reset_tentativas/{saram}` no
  Firestore — dificulta tentar adivinhar o telefone de outra pessoa.
- **O telefone cadastrado nunca é devolvido pro navegador** — a função só
  confirma internamente se bate ou não.
- Ainda assim, telefone não é uma senha secreta de verdade — colegas que já
  têm seu contato salvo tecnicamente poderiam tentar usar isso. Pra um app
  fechado de esquadrão o risco é aceitável, mas é bom que você e os demais
  admins saibam desse trade-off.
