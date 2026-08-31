// Ferramenta de admin: define uma senha temporária pra alguém que esqueceu a
// própria senha e não consegue mais entrar no app.
//
// Por que existe: o login usa SARAM, e por baixo dos panos isso vira um
// e-mail fictício (algo@academiapampa.local) — não existe de verdade, então
// o "esqueci minha senha" padrão do Firebase (que manda e-mail) não funciona
// aqui, e nem o Console do Firebase deixa definir uma senha nova direto (só
// manda aquele e-mail que nunca chega). Este script usa o SDK de admin do
// Firebase, que tem permissão pra definir a senha de qualquer usuário sem
// precisar do e-mail funcionar.
//
// Depois de rodar, avise a pessoa a senha temporária. Assim que ela entrar,
// oriente a trocar por uma senha só dela em "🔑 Trocar senha" no topo do app.
//
// COMO RODAR
// 1. Se ainda não tiver, gere uma chave em: Console do Firebase > ⚙️
//    Configurações do projeto > Contas de serviço > "Gerar nova chave
//    privada". Salve o arquivo JSON baixado como service-account.json
//    NESTA MESMA PASTA (scripts/) — já está no .gitignore, não vai pro
//    GitHub. Se você já tem esse arquivo de uma migração anterior, pode
//    copiar ele pra cá também.
// 2. Nesta pasta: npm init -y && npm install firebase-admin
// 3. node resetar-senha.js <SARAM> <senha-temporaria>
//    Exemplo: node resetar-senha.js 1234567 Trocar@123
//
// A senha temporária precisa ter pelo menos 6 caracteres (regra do Firebase).

const admin = require("firebase-admin");
const serviceAccount = require("./service-account.json");

const EMAIL_DOMAIN = "@academiapampa.local";

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

async function resetarSenha() {
  const [saram, novaSenha] = process.argv.slice(2);

  if (!saram || !novaSenha) {
    console.error("Uso: node resetar-senha.js <SARAM> <senha-temporaria>");
    process.exit(1);
  }
  if (novaSenha.length < 6) {
    console.error("A senha temporária precisa ter pelo menos 6 caracteres.");
    process.exit(1);
  }

  const email = String(saram).trim().toLowerCase().replace(/\s+/g, "") + EMAIL_DOMAIN;

  try {
    const usuario = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(usuario.uid, { password: novaSenha });
    console.log(`Senha redefinida para o SARAM ${saram}.`);
    console.log(`Passe essa senha temporária pra pessoa: ${novaSenha}`);
    console.log(`Assim que ela entrar, oriente a trocar pela dela em "🔑 Trocar senha".`);
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      console.error(`Não achei nenhum cadastro com o SARAM ${saram}.`);
    } else {
      console.error("Erro ao redefinir a senha:", e.message);
    }
    process.exit(1);
  }
}

resetarSenha().then(() => process.exit(0));
