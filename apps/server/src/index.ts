import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

const isProduction = process.env.NODE_ENV === 'production';
const port = readPort(process.env.PORT);
const host = process.env.HOST ?? '0.0.0.0';
const clientOrigins = (process.env.CLIENT_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const trustProxy = ['1', 'true', 'yes'].includes((process.env.TRUST_PROXY ?? '').toLowerCase());
const maxRooms = positiveInt(process.env.MAX_ROOMS);
const maxSocketsPerIp = positiveInt(process.env.MAX_SOCKETS_PER_IP);
const ttlMs = positiveInt(process.env.ROOM_TTL_MS);
const botDelayMs = positiveInt(process.env.BOT_DELAY_MS);
const jwtSecret = process.env.JWT_SECRET?.trim();
const cookieSecure = ['1', 'true', 'yes'].includes((process.env.COOKIE_SECURE ?? '').toLowerCase());
const databasePath =
  process.env.DATABASE_PATH?.trim() || fileURLToPath(new URL('../data/ttt.db', import.meta.url));

if (isProduction) {
  requireProductionSecret(jwtSecret);
}

const app = await buildApp({
  clientOrigins,
  trustProxy,
  databasePath,
  cookieSecure,
  ...(maxRooms === undefined ? {} : { maxRooms }),
  ...(maxSocketsPerIp === undefined ? {} : { maxSocketsPerIp }),
  ...(ttlMs === undefined ? {} : { ttlMs }),
  ...(botDelayMs === undefined ? {} : { botDelayMs }),
  ...(jwtSecret ? { jwtSecret } : {}),
  ...(process.env.STATIC_DIR ? { staticDir: process.env.STATIC_DIR } : {}),
});

if (process.env.NODE_ENV === 'production' && clientOrigins.length === 0) {
  app.log.warn(
    'CLIENT_ORIGIN не задан: CORS выключен, Origin у WebSocket не проверяется. Для продакшена укажите домены явно.',
  );
}

if (isProduction && !trustProxy) {
  app.log.warn(
    'TRUST_PROXY=false: за reverse-proxy все клиенты будут выглядеть одним IP. ' +
      'Rate limit и MAX_SOCKETS_PER_IP станут общими на весь сайт.',
  );
}

if (!jwtSecret) {
  app.log.warn(
    'JWT_SECRET не задан: используется случайный секрет. После рестарта все сессии станут недействительны.',
  );
}

if (process.env.NODE_ENV === 'production' && !cookieSecure) {
  app.log.warn(
    'COOKIE_SECURE=false: cookie сессии будет передаваться без флага Secure. Включите за HTTPS reverse-proxy.',
  );
}

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}

function positiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 3000;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    console.error(`PORT должен быть целым числом от 1 до 65535, получено: ${raw}`);
    process.exit(1);
  }
  return value;
}

const INSECURE_SECRET = /change[-_ ]?me|^secret$|^password$/i;

/** В production секрет обязателен, длинный и не должен быть примером из docs. */
function requireProductionSecret(secret: string | undefined): void {
  if (!secret) {
    console.error('JWT_SECRET обязателен в production. Сгенерируйте: openssl rand -hex 32');
    process.exit(1);
  }
  if (secret.length < 32) {
    console.error('JWT_SECRET должен быть не короче 32 символов. Сгенерируйте: openssl rand -hex 32');
    process.exit(1);
  }
  if (INSECURE_SECRET.test(secret)) {
    console.error('JWT_SECRET похож на пример/placeholder. Сгенерируйте свой: openssl rand -hex 32');
    process.exit(1);
  }
}
