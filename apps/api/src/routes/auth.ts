import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { signSession } from '@nexus/security';
import { DAY, UnauthorizedError, ValidationError, withTimeout } from '@nexus/shared';

/**
 * Discord-OAuth2 fuer das Dashboard (Regel 43).
 *
 * Ablauf (Authorization Code Grant):
 *   /auth/login    -> Weiterleitung zu Discord
 *   /auth/callback -> Code gegen Token tauschen, Profil laden, Session setzen
 *
 * Wichtig: das Discord-Access-Token verlaesst nie den Server. Im Browser
 * liegt ausschliesslich ein signiertes, httpOnly-Session-Cookie (Regel 54).
 */
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const { env, store, cache, log } = app.nexus;

  app.get('/auth/login', async (request, reply) => {
    if (!env.DISCORD_CLIENT_ID) throw new UnauthorizedError('OAuth ist nicht konfiguriert');

    const state = Buffer.from(
      JSON.stringify({ nonce: Math.random().toString(36).slice(2), at: Date.now() }),
    ).toString('base64url');
    await cache.setJson(`oauth:state:${state}`, { ip: request.ip }, 10 * 60_000);

    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
    url.searchParams.set('redirect_uri', env.OAUTH_REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify guilds');
    url.searchParams.set('state', state);
    return reply.redirect(url.toString());
  });

  app.get('/auth/callback', async (request, reply) => {
    const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).safeParse(request.query);
    if (!query.success) throw new ValidationError('code/state fehlen', query.error.flatten().fieldErrors);

    // CSRF-Schutz: der State muss von uns stammen und ist einmalig gueltig.
    const stored = await cache.getJson<{ ip: string }>(`oauth:state:${query.data.state}`);
    if (!stored) throw new UnauthorizedError('Ungueltiger oder abgelaufener OAuth-State');
    await cache.delete(`oauth:state:${query.data.state}`);

    const tokenResponse = await withTimeout(
      fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID ?? '',
          client_secret: env.DISCORD_CLIENT_SECRET ?? '',
          grant_type: 'authorization_code',
          code: query.data.code,
          redirect_uri: env.OAUTH_REDIRECT_URI,
        }),
      }),
      10_000,
      'discord token exchange',
    );
    if (!tokenResponse.ok) throw new UnauthorizedError('Token-Austausch mit Discord fehlgeschlagen');
    const tokens = (await tokenResponse.json()) as { access_token: string };

    const userResponse = await withTimeout(
      fetch('https://discord.com/api/v10/users/@me', {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      }),
      10_000,
      'discord user',
    );
    if (!userResponse.ok) throw new UnauthorizedError('Profilabruf fehlgeschlagen');
    const profile = (await userResponse.json()) as {
      id: string;
      username: string;
      global_name?: string;
      avatar?: string;
      locale?: string;
    };

    const user = await store.users.upsertFromDiscord({
      discordId: profile.id,
      username: profile.username,
      globalName: profile.global_name ?? null,
      avatar: profile.avatar ?? null,
    });
    if (user.blacklisted) throw new UnauthorizedError('Dieses Konto ist gesperrt');

    const token = signSession(env.SESSION_SECRET, {
      userId: user.id,
      discordId: user.discordId,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 7 * DAY,
    });

    log.info('Dashboard-Login', { userId: user.discordId });
    return reply
      .setCookie('nexus_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,
      })
      .redirect(env.DASHBOARD_URL);
  });

  app.post('/auth/logout', async (_request, reply) =>
    reply.clearCookie('nexus_session', { path: '/' }).send({ ok: true }),
  );

  app.get('/api/v1/me', async (request) => {
    if (!request.auth) return { authenticated: false };
    const user = await store.users.findByDiscordId(request.auth.userId);
    return {
      authenticated: true,
      user: user
        ? {
            id: user.discordId,
            username: user.username,
            globalName: user.globalName,
            avatar: user.avatar,
            locale: user.locale,
            isBotOwner: user.isBotOwner,
          }
        : null,
    };
  });
}
