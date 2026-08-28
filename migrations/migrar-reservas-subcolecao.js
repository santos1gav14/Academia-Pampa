// Migração única: converte reservas_academia/{turnoId}.lista (array) para a
// subcoleção reservas_academia/{turnoId}/reservas/{saram} (um documento por
// reserva, um por pessoa).
//
// Por quê: as novas firestore.rules só conseguem impedir que alguém edite a
// reserva de outra pessoa se cada reserva for o SEU PRÓPRIO documento (dono
// = quem tem aquele SARAM no ID). Com tudo dentro de um array só, o
// Firestore não tem como validar "essa edição mexeu só na sua entrada".
//
// Rode isto ANTES de publicar as novas firestore.rules e o novo index.html
// — depois da atualização, o app não lê mais o campo "lista".
//
// COMO RODAR
// 1. No Console do Firebase: Configurações do projeto (ícone de engrenagem)
//    > Contas de serviço > "Gerar nova chave privada". Salve o arquivo
//    JSON baixado como service-account.json NESTA MESMA PASTA
//    (migrations/). NÃO comite esse arquivo — ele dá acesso total ao seu
//    banco (por isso já está no .gitignore do projeto).
// 2. Nesta pasta: npm init -y && npm install firebase-admin
// 3. node migrar-reservas-subcolecao.js
//
// O script é seguro para rodar mais de uma vez: qualquer documento que já
// não tenha mais o campo "lista" é considerado já migrado e é pulado.

const admin = require("firebase-admin");
const serviceAccount = require("./service-account.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function migrar() {
  const snap = await db.collection("reservas_academia").get();
  console.log(`Encontrados ${snap.size} documento(s) de turno.`);

  let migrados = 0, pulados = 0, semSaram = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();

    if (!Array.isArray(data.lista)) {
      pulados++;
      continue;
    }

    const batch = db.batch();
    const subcolecao = docSnap.ref.collection("reservas");
    let validas = 0;

    for (const item of data.lista) {
      if (!item || !item.saram) { semSaram++; continue; }
      batch.set(subcolecao.doc(String(item.saram)), {
        saram: String(item.saram),
        posto: item.posto || "",
        nome: item.nome || "",
        isPiloto: !!item.isPiloto,
        date: data.date || null,
        turno: data.turno || null,
        ts: item.ts || Date.now(),
      });
      validas++;
    }

    batch.update(docSnap.ref, {
      count: validas,
      lista: admin.firestore.FieldValue.delete(),
    });

    await batch.commit();
    migrados++;
    console.log(`  migrado: ${docSnap.id} (${validas} reserva(s))`);
  }

  console.log("");
  console.log(`Concluído: ${migrados} turno(s) migrado(s), ${pulados} já estavam ok` +
    (semSaram ? `, ${semSaram} entrada(s) ignorada(s) por não ter SARAM` : "") + ".");
}

migrar()
  .then(() => process.exit(0))
  .catch((e) => { console.error("Erro na migração:", e); process.exit(1); });
