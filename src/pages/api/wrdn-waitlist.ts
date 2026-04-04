import type { APIRoute } from "astro";

import { getSupabaseAdminClient } from "../../lib/supabase/admin";

export const prerender = false;

function redirectWithMessage(requestUrl: URL, params: Record<string, string>) {
  const redirectUrl = new URL("/wrdn", requestUrl);

  Object.entries(params).forEach(([key, value]) => {
    redirectUrl.searchParams.set(key, value);
  });

  return Response.redirect(redirectUrl, 303);
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    return redirectWithMessage(new URL(request.url), {
      error: "Email is required."
    });
  }

  if (!isValidEmail(email)) {
    return redirectWithMessage(new URL(request.url), {
      error: "Enter a valid email."
    });
  }

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("wrdn_waitlist").insert({
    email,
    source: "wrdn-page",
    ip_address: clientAddress ?? null,
    user_agent: request.headers.get("user-agent")
  });

  if (error) {
    if (error.code === "23505") {
      return redirectWithMessage(new URL(request.url), {
        message: "You're already on the list."
      });
    }

    return redirectWithMessage(new URL(request.url), {
      error: "Could not save your email."
    });
  }

  return redirectWithMessage(new URL(request.url), {
    message: "You're on the list."
  });
};
