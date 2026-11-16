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
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'SoftifyOS <no-reply@localhost>',
  },
  get smtpConfigured() { return Boolean(this.smtp.host); },
};
