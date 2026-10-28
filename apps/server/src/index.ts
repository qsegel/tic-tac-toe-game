import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

const port = Number(process.env.PORT ?? 3000);
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
