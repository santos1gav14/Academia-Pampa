// Função serverless (Vercel) chamada pela aba "Admin > Senha" do app quando
// um admin decide resetar a senha de alguém que pediu ("esqueci minha
// senha"). Roda fora do navegador porque só quem tem a chave de conta de
// serviço do Firebase (guardada aqui como variável de ambiente, nunca no
// código) tem permissão pra mudar a senha de outra pessoa — o Firestore
// (onde fica o pedido) não tem essa autoridade.
//
// Segurança: quem chama essa função precisa mandar o próprio idToken do
// Firebase Auth (obtido no navegador com auth.currentUser.getIdToken()).
// A função verifica esse token com o Admin SDK — não dá pra forjar — e só
// segue adiante se a conta correspondente estiver marcada como isAdmin no
// Firestore. Ou seja: só um admin de verdade, já logado no app, consegue
// resetar a senha de alguém por aqui.

const admin = require("firebase-admin");

let app;
function getApp() {
  if (!app) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return app;
}

const EMAIL_DOMAIN = "@academiapampa.local";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

function saramParaEmail(saram) {
  return String(saram).trim().toLowerCase().replace(/\s+/g, "") + EMAIL_DOMAIN;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ erro: "Método não permitido." });
    return;
  }

  try {
    getApp();
    const { saram, novaSenha, idToken } = req.body || {};

    if (!saram || !novaSenha || !idToken) {
      res.status(400).json({ erro: "Faltam dados na requisição." });
      return;
    }
    if (String(novaSenha).length < 6) {
      res.status(400).json({ erro: "A senha temporária precisa ter pelo menos 6 caracteres." });
      return;
    }

    // 1. Confirma que quem está chamando é um usuário autenticado de verdade
    let tokenDecodificado;
    try {
      tokenDecodificado = await admin.auth().verifyIdToken(idToken);
    } catch (e) {
      res.status(401).json({ erro: "Sessão inválida. Faça login de novo e tente outra vez." });
      return;
    }

    // 2. Confirma que essa pessoa é admin (checando o próprio cadastro dela no Firestore)
    const solicitanteSaram = tokenDecodificado.email.replace(EMAIL_DOMAIN, "");
    const db = admin.firestore();
    const solicitanteSnap = await db.collection("usuarios").doc(solicitanteSaram).get();
    if (!solicitanteSnap.exists || solicitanteSnap.data().isAdmin !== true) {
      res.status(403).json({ erro: "Só administradores podem resetar senha de outra pessoa." });
      return;
    }

    // 3. Confirma que o SARAM alvo existe e troca a senha
    const saramLimpo = String(saram).trim();
    const alvoSnap = await db.collection("usuarios").doc(saramLimpo).get();
    if (!alvoSnap.exists) {
      res.status(404).json({ erro: "SARAM não encontrado." });
      return;
    }

    const authUser = await admin.auth().getUserByEmail(saramParaEmail(saramLimpo));
    await admin.auth().updateUser(authUser.uid, { password: String(novaSenha) });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro interno. Tente novamente em instantes." });
  }
};
