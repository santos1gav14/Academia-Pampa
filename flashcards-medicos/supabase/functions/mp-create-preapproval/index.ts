// Edge Function: cria uma assinatura recorrente (preapproval) no Mercado Pago
// para o usuário autenticado e retorna a URL de checkout (init_point).
//
// Segredos necessários (defina com `supabase secrets set`):
//   MP_ACCESS_TOKEN   -> access token de produção da sua aplicação Mercado Pago
//   MP_MONTHLY_PRICE  -> preço mensal em BRL, ex: "49.90"
//   APP_URL           -> URL pública do seu app, ex: "https://seudominio.com"
//   SUPABASE_URL / SUPABASE_ANON_KEY são injetados automaticamente pelo Supabase.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "missing_authorization" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user || !user.email) {
      return json({ error: "unauthorized" }, 401);
    }

    const mpToken = Deno.env.get("MP_ACCESS_TOKEN");
    const appUrl = Deno.env.get("APP_URL");
    const price = Number(Deno.env.get("MP_MONTHLY_PRICE") ?? "49.90");
    if (!mpToken || !appUrl) {
      return json({ error: "server_misconfigured" }, 500);
    }

    const mpRes = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reason: "Assinatura Mensal - Flashcards Médicos",
        external_reference: user.id,
        payer_email: user.email,
        back_url: `${appUrl}/index.html?sub=success`,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: price,
          currency_id: "BRL",
        },
        status: "pending",
      }),
    });

    const mpData = await mpRes.json();
    if (!mpRes.ok) {
      return json({ error: "mp_error", details: mpData }, 502);
    }

    // registra a assinatura como "pending" desde já; o webhook confirma quando o MP autorizar
    await supabase.from("subscriptions").upsert(
      {
        user_id: user.id,
        mp_preapproval_id: mpData.id,
        status: "pending",
      },
      { onConflict: "mp_preapproval_id" },
    );

    return json({ init_point: mpData.init_point }, 200);
  } catch (_e) {
    return json({ error: "internal_error" }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
