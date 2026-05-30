import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const resumeUrl = new URL("/resume.pdf", url);
  const resumeResponse = await fetch(resumeUrl);

  if (!resumeResponse.ok || !resumeResponse.body) {
    return new Response("Resume PDF not found.", { status: 404 });
  }

  return new Response(resumeResponse.body, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Disposition": 'inline; filename="naman-chetwani-resume.pdf"',
      "Content-Type": "application/pdf"
    }
  });
};
