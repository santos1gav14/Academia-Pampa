// Função serverless (Vercel) que permite a um usuário redefinir a própria
// senha sozinho, sem precisar de um admin — confirmando SARAM + telefone
// cadastrado. Roda fora do navegador porque só quem tem a chave de conta de
// serviço do Firebase (guardada aqui como variável de ambiente, nunca no
// código) tem permissão pra mudar a senha de outra pessoa.
//
// Decisões de segurança, de propósito:
// - Contas de admin NUNCA passam por aqui (ver checagem abaixo) — pra essas,
//   o reset continua exigindo o script rodado por outro admin
//   (scripts/resetar-senha.js). Assim, mesmo que alguém descubra o telefone
//   de um colega, não consegue virar admin do sistema.
// - Limite de 5 tentativas por SARAM a cada 15 minutos, guardado no
//   Firestore, pra dificultar tentativa de adivinhar o telefone de outra
//   pessoa por força bruta.
// - O telefone armazenado nunca é devolvido pro cliente — só comparado
//   internamente.

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
const LIMITE_TENTATIVAS = 5;
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;

function apenasDigitos(s) {
  return String(s || "").replace(/\D/g, "");
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
    const { saram, telefone, novaSenha } = req.body || {};

    if (!saram || !telefone || !novaSenha) {
      res.status(400).json({ erro: "Preencha SARAM, telefone e a nova senha." });
      return;
    }
    if (String(novaSenha).length < 6) {
      res.status(400).json({ erro: "A nova senha precisa ter pelo menos 6 caracteres." });
      return;
    }

    const saramLimpo = String(saram).trim();
    const db = admin.firestore();

    // limite básico de tentativas por SARAM
    const tentativasRef = db.collection("reset_tentativas").doc(saramLimpo);
    const agora = Date.now();
    const tentativasSnap = await tentativasRef.get();
    const tentativasAnteriores = tentativasSnap.exists ? (tentativasSnap.data().tentativas || []) : [];
    const recentes = tentativasAnteriores.filter((ts) => agora - ts < JANELA_TENTATIVAS_MS);
    if (recentes.length >= LIMITE_TENTATIVAS) {
      res.status(429).json({ erro: "Muitas tentativas. Aguarde alguns minutos e tente de novo, ou peça a um admin." });
      return;
    }
    await tentativasRef.set({ tentativas: [...recentes, agora] });

    const usuarioRef = db.collection("usuarios").doc(saramLimpo);
    const usuarioSnap = await usuarioRef.get();
    if (!usuarioSnap.exists) {
      res.status(404).json({ erro: "SARAM não encontrado." });
      return;
    }
    const usuario = usuarioSnap.data();

    if (usuario.isAdmin) {
      res.status(403).json({ erro: "Contas de administrador não podem ser redefinidas por aqui. Peça a outro admin para usar o script de reset." });
      return;
    }

    if (apenasDigitos(usuario.telefone) !== apenasDigitos(telefone)) {
      res.status(401).json({ erro: "Telefone não confere com o cadastro." });
      return;
    }

    const email = saramLimpo.toLowerCase().replace(/\s+/g, "") + EMAIL_DOMAIN;
    const authUser = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(authUser.uid, { password: String(novaSenha) });

    await tentativasRef.delete().catch(() => {});

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro interno. Tente novamente em instantes." });
  }
};
