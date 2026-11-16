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
};
