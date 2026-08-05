// Edge Function: recebe as notificações (webhooks) do Mercado Pago quando
// uma assinatura é autorizada, paga, pausada ou cancelada, e atualiza a
// tabela `subscriptions`. Valida a assinatura HMAC do Mercado Pago para
// garantir que a requisição realmente veio do MP (evita spoofing).
//
// Configure a URL desta função como webhook no painel do Mercado Pago,
// selecionando o tópico "assinaturas" (preapproval).
//
// Segredos necessários (defina com `supabase secrets set`):
//   MP_ACCESS_TOKEN         -> mesmo access token usado na outra função
//   MP_WEBHOOK_SECRET       -> "Chave secreta" mostrada no painel de webhooks do MP
//   SUPABASE_SERVICE_ROLE_KEY -> chave service_role do seu projeto (NUNCA exponha no frontend)
//   SUPABASE_URL é injetado automaticamente pelo Supabase.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STATUS_MAP: Record<string, string> = {
  authorized: "active",
  paused: "paused",
  cancelled: "cancelled",
  pending: "pending",
};

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");
    const type = url.searchParams.get("type") ?? url.searchParams.get("topic");

    const xSignature = req.headers.get("x-signature");
    const xRequestId = req.headers.get("x-request-id");
    const secret = Deno.env.get("MP_WEBHOOK_SECRET");

    if (!dataId || !xSignature || !xRequestId || !secret) {
      return new Response("bad request", { status: 400 });
    }

    // formato do header: "ts=1704908010,v1=<hash>"
    const parts = Object.fromEntries(
      xSignature.split(",").map((p) => {
        const [k, v] = p.split("=");
        return [k?.trim(), v?.trim()];
      }),
    );
    const ts = parts["ts"];
    const v1 = parts["v1"];
    if (!ts || !v1) {
      return new Response("bad signature format", { status: 400 });
    }

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
    const computed = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (computed !== v1) {
      return new Response("invalid signature", { status: 401 });
    }

    // só nos interessam eventos de assinatura (preapproval)
    if (type && type !== "preapproval" && type !== "subscription_preapproval") {
      return new Response("ignored", { status: 200 });
    }

    const mpToken = Deno.env.get("MP_ACCESS_TOKEN")!;
    const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${dataId}`, {
      headers: { Authorization: `Bearer ${mpToken}` },
    });
    if (!mpRes.ok) {
      return new Response("failed to fetch preapproval", { status: 502 });
    }
    const preapproval = await mpRes.json();

    const status = STATUS_MAP[preapproval.status] ?? "pending";
    const userId = preapproval.external_reference;
    const periodEnd = preapproval.next_payment_date ?? null;

    if (!userId) {
      return new Response("missing external_reference", { status: 200 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    await supabaseAdmin.from("subscriptions").upsert(
      {
        user_id: userId,
        mp_preapproval_id: dataId,
        status,
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "mp_preapproval_id" },
    );

    return new Response("ok", { status: 200 });
  } catch (_e) {
    return new Response("internal_error", { status: 500 });
  }
});
