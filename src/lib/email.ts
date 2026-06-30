// src/lib/email.ts
// Simple Resend email sender — add RESEND_API_KEY to .env.local and Vercel env vars.
export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set — email not sent');
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'AliBot Review <noreply@resend.dev>',
        to: [to],
        subject,
        html,
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `Resend error ${res.status}: ${body}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
