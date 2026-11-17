// Email from the app: per-organisation sender settings and templates, the branded HTML wrapper,
// and the SMTP transport (organisation SMTP if set, else the server's SMTP_* settings, else log only).
import nodemailer, { type Transporter } from 'nodemailer';
import { z } from 'zod';
import { env } from './env.js';
import { sql } from './db.js';
import { decryptSecret } from './registries.js';

export const TEMPLATE_KEYS = ['offer_send', 'offer_reminder'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
type Tpl = { subject: string; body: string };

/** Placeholders: {customer} {number} {total} {valid_until} {link} {sender} {company} */
export const DEFAULT_TEMPLATES: Record<TemplateKey, Record<'el' | 'en', Tpl>> = {
  offer_send: {
    el: {
      subject: '{company}: Προσφορά {number}',
      body: 'Αγαπητέ/ή {customer},\n\nσας στέλνουμε την προσφορά {number} συνολικού ποσού {total}.\nΜπορείτε να τη δείτε, να την εκτυπώσετε και να την αποδεχτείτε ηλεκτρονικά από τον παρακάτω σύνδεσμο.\n\nΜε εκτίμηση,\n{sender}',
    },
    en: {
      subject: '{company}: Offer {number}',
      body: 'Dear {customer},\n\nplease find our offer {number} for a total of {total}.\nYou can view, print and accept it online using the link below.\n\nKind regards,\n{sender}',
    },
  },
  offer_reminder: {
    el: {
      subject: 'Υπενθύμιση: Προσφορά {number}',
      body: 'Αγαπητέ/ή {customer},\n\nσας υπενθυμίζουμε την προσφορά {number}, που ισχύει έως {valid_until}.\nΘα χαρούμε να απαντήσουμε σε κάθε ερώτηση.\n\nΜε εκτίμηση,\n{sender}',
    },
    en: {
      subject: 'Reminder: Offer {number}',
      body: 'Dear {customer},\n\na quick reminder about offer {number}, valid until {valid_until}.\nWe are happy to answer any question.\n\nKind regards,\n{sender}',
    },
  },
};

const tplSchema = z.object({ subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(5000) });
export const emailSettingsSchema = z.object({
  from_name: z.string().trim().max(100).nullish(),
  reply_to_owner: z.boolean().default(true),         // replies go to the offer's owner
  reply_to: z.string().email().max(320).nullish(),   // otherwise to this address
  bcc_sender: z.boolean().default(false),            // a copy to the person who sends
  signature: z.string().max(2000).nullish(),
  track_opens: z.boolean().default(true),
  notify_view: z.boolean().default(true),            // push to the owner when the customer opens the offer
  templates: z.partialRecord(z.enum(TEMPLATE_KEYS), z.object({ el: tplSchema.optional(), en: tplSchema.optional() })).default({}),
});
export type EmailSettings = z.infer<typeof emailSettingsSchema>;

export function readSettings(raw: unknown): EmailSettings {
  const p = emailSettingsSchema.safeParse(raw ?? {});
  return p.success ? p.data : emailSettingsSchema.parse({});
}

export function template(s: EmailSettings, key: TemplateKey, locale: 'el' | 'en'): Tpl {
  return s.templates[key]?.[locale] ?? DEFAULT_TEMPLATES[key][locale];
}

export function fill(text: string, vars: Record<string, string>) {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Branded, email-client-safe HTML (tables, inline styles). Body is plain text written by the user. */
export function renderHtml(o: {
  brand: string; logoUrl?: string | null; color?: string | null; body: string; signature?: string | null;
  button?: { label: string; url: string } | null; footer?: string; pixelUrl?: string | null;
}) {
  const color = /^#[0-9a-f]{6}$/i.test(o.color ?? '') ? o.color! : '#5b3df5';
  const para = (t: string) => esc(t).replace(/\n/g, '<br>');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f5f4fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#17142b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="padding:20px 24px;border-bottom:1px solid #eeecf6">${o.logoUrl
    ? `<img src="${esc(o.logoUrl)}" alt="${esc(o.brand)}" height="36" style="height:36px;max-width:220px;display:block">`
    : `<span style="font-size:18px;font-weight:700;color:${color}">${esc(o.brand)}</span>`}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.6">${para(o.body)}
${o.button ? `<p style="margin:24px 0 8px"><a href="${esc(o.button.url)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:12px">${esc(o.button.label)}</a></p>
<p style="margin:0;font-size:12px;color:#6b6880;word-break:break-all">${esc(o.button.url)}</p>` : ''}
${o.signature ? `<p style="margin:24px 0 0;font-size:13px;color:#6b6880">${para(o.signature)}</p>` : ''}</td></tr>
${o.footer ? `<tr><td style="padding:14px 24px;background:#faf9fd;font-size:11px;color:#8a879c">${esc(o.footer)}</td></tr>` : ''}
</table></td></tr></table>${o.pixelUrl ? `<img src="${esc(o.pixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : ''}
</body></html>`;
}

// ------------------------------------------------------------------ SMTP
export const smtpSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  user: z.string().trim().max(255).nullish(),
  pass: z.string().max(500).nullish(),
  from: z.string().trim().min(3).max(320),        // "Name <addr@domain>" or addr@domain
});
export type Smtp = z.infer<typeof smtpSchema>;

export function makeTransport(s: Smtp): Transporter {
  return nodemailer.createTransport({
    host: s.host, port: s.port, secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.pass ?? '' } : undefined,
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 30000,
  });
}

const serverTransport = env.smtpConfigured
  ? makeTransport({ host: env.smtp.host, port: env.smtp.port, secure: env.smtp.secure, user: env.smtp.user, pass: env.smtp.pass, from: env.smtp.from })
  : null;

// Organisation transports are reused (pooled per tenant) and rebuilt when the settings change
const cache = new Map<string, { enc: string; t: Transporter; from: string }>();

/** Transport + default From for a tenant: its own SMTP, else the server's, else null (log only). */
export async function transportFor(tenantId: string | undefined) {
  if (tenantId) {
    const [r] = await sql<{ smtp_enc: string | null }[]>`SELECT smtp_enc FROM tenants WHERE id = ${tenantId}`;
    if (r?.smtp_enc) {
      const hit = cache.get(tenantId);
      if (hit && hit.enc === r.smtp_enc) return { transport: hit.t, from: hit.from, own: true };
      const plain = decryptSecret(r.smtp_enc);
      const parsed = plain ? smtpSchema.safeParse(JSON.parse(plain)) : null;
      if (parsed?.success) {
        hit?.t.close();
        const t = makeTransport(parsed.data);
        cache.set(tenantId, { enc: r.smtp_enc, t, from: parsed.data.from });
        return { transport: t, from: parsed.data.from, own: true };
      }
    }
  }
  return serverTransport ? { transport: serverTransport, from: env.smtp.from, own: false } : null;
}

/** "Display Name <addr>" with the organisation's sender name in front of the transport's address. */
export function withName(from: string, name?: string | null) {
  if (!name) return from;
  const addr = from.match(/<([^>]+)>/)?.[1] ?? from.trim();
  return `"${name.replace(/["\\\r\n]/g, '')}" <${addr}>`;
}
