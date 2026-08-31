# api-reset-senha

Serverzinho gratuito (Vercel) que troca a senha de um usuário quando um
**admin** decide isso pela aba **Admin > Senha** do app. Existe porque o
Firestore (onde ficam os dados do app) não tem nenhuma autoridade pra mudar
senha do Firebase Authentication — só uma chave privilegiada consegue, e
essa chave não pode ficar exposta no navegador. Aqui ela fica guardada em
segredo, do lado do servidor.

## Como funciona o fluxo completo

1. Usuário esquece a senha → clica em "Esqueci minha senha" na tela de
   login → informa o SARAM → isso cria um pedido pendente (guardado direto
   no Firestore, sem precisar desta função).
2. Um admin abre **Admin > Senha** no app, vê a lista de pedidos, confere
   (por fora do app, se achar necessário) que quem pediu é mesmo essa
   pessoa, e decide se reseta.
3. Ao clicar em "Resetar senha", o app chama esta função, mandando o
   próprio login do admin (idToken) + o SARAM da pessoa + uma senha
   temporária. A função confirma que quem está pedindo é mesmo um admin
   logado, e só então troca a senha.
4. O admin repassa a senha temporária pra pessoa por fora do app. Ela entra
   e troca pela definitiva em **🔑 Trocar senha**.

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

Depois disso, o botão "Resetar senha" na aba Admin > Senha passa a
funcionar de verdade.

## Segurança — o que essa função garante

- **Só admin consegue chamar esta função.** Ela verifica o idToken do
  Firebase Auth de quem está chamando (não dá pra forjar) e confere no
  Firestore se essa conta tem `isAdmin: true` antes de fazer qualquer
  coisa.
- **Quem confere se a pessoa é realmente quem diz ser é o admin humano** —
  a função não faz nenhuma checagem de identidade sozinha, é uma decisão
  consciente de quem está resetando.
- Pedidos de reset ficam em `solicitacoes_senha` no Firestore, visível só
  para admins.
