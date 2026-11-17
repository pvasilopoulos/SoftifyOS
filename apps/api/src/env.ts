function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing env var ${name}`);
  return v;
}
const isProd = process.env.NODE_ENV === 'production';

export const env = {
  isProd,
  port: Number(process.env.API_PORT ?? 4000),
  host: process.env.API_HOST ?? '127.0.0.1',
  databaseUrl: req('DATABASE_URL'),
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 20),
  // Set to false when going through PgBouncer in transaction mode
  dbPrepare: process.env.DB_PREPARE !== 'false',
  jwtSecret: req('JWT_SECRET', isProd ? undefined : 'dev-only-insecure-secret-change-me-please'),
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  vapidPublic: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivate: process.env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
  // Public base URL of the app (used in emails and customer links)
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  // Uploaded documents (outside the web root; back it up with the database)
  uploadDir: process.env.UPLOAD_DIR ?? 'storage',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'SoftifyOS <no-reply@localhost>',
  },
  get smtpConfigured() { return Boolean(this.smtp.host); },
  // Calendar sync (OAuth apps registered by the installation's administrator; redirect = APP_URL/api/calendar/oauth/<provider>/callback)
  google: { clientId: process.env.GOOGLE_CLIENT_ID ?? '', clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '' },
  microsoft: { clientId: process.env.MS_CLIENT_ID ?? '', clientSecret: process.env.MS_CLIENT_SECRET ?? '', tenant: process.env.MS_TENANT ?? 'common' },
  // Monitoring: new errors are sent once to these (both optional); BACKUP_DIR lets /api/health report the last backup
  alert: { email: process.env.ALERT_EMAIL ?? '', webhook: process.env.ALERT_WEBHOOK_URL ?? '' },
  backupDir: process.env.BACKUP_DIR ?? '',
  // SaaS billing (Stripe). Without STRIPE_SECRET_KEY there are no plans/limits (single-company installation).
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    enforce: process.env.BILLING_ENFORCE === 'true',      // apply plan limits even without Stripe (testing)
    prices: Object.fromEntries((['starter', 'business', 'enterprise'] as const).flatMap((p) => (['month', 'year'] as const)
      .map((i) => [`${p}_${i}`, process.env[`STRIPE_PRICE_${p.toUpperCase()}_${i.toUpperCase()}`] ?? '']))) as Record<string, string>,
  },
};
