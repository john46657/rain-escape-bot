/**
 * Deterministische Demo-Daten fuer den DEV_MODE.
 *
 * Zweck: Dashboard und API lassen sich ohne PostgreSQL, Redis und ohne
 * echten Discord-Bot vollstaendig ausprobieren. Die Daten sind bewusst
 * erfunden und als solche erkennbar (Namen mit "Demo").
 */
import { DAY, HOUR, MINUTE } from '@nexus/shared';
import type { MemoryDataStore } from './store.js';

export const DEMO_GUILD_ID = '100000000000000001';
export const DEMO_OWNER_ID = '200000000000000001';

const USERS = [
  { id: '200000000000000001', name: 'demo_owner', global: 'Owner Demo' },
  { id: '200000000000000002', name: 'demo_mod', global: 'Mod Demo' },
  { id: '200000000000000003', name: 'demo_player', global: 'Player Demo' },
  { id: '200000000000000004', name: 'demo_builder', global: 'Builder Demo' },
  { id: '200000000000000005', name: 'demo_troll', global: 'Troll Demo' },
];

export async function seedDemoData(store: MemoryDataStore): Promise<void> {
  const now = Date.now();

  for (const user of USERS) {
    await store.users.upsertFromDiscord({
      discordId: user.id, username: user.name, globalName: user.global, avatar: null,
    });
  }

  await store.guilds.upsert({
    discordId: DEMO_GUILD_ID,
    name: 'NEXUS Demo-Server',
    icon: null,
    ownerId: DEMO_OWNER_ID,
    memberCount: 1_284,
  });
  await store.guilds.setPremium(DEMO_GUILD_ID, 'PREMIUM', new Date(now + 30 * DAY));
  await store.guilds.updateConfig(DEMO_GUILD_ID, {
    modLogChannelId: '300000000000000001',
    securityChannelId: '300000000000000002',
    robloxEnabled: true,
    verifiedRoleId: '400000000000000001',
  });

  // ---- Moderation ----
  const cases = [
    { action: 'WARN' as const, target: '200000000000000005', reason: 'Spam im Chat', ago: 2 * HOUR },
    { action: 'TIMEOUT' as const, target: '200000000000000005', reason: 'Wiederholter Spam', ago: 90 * MINUTE, duration: 3_600_000 },
    { action: 'KICK' as const, target: '200000000000000004', reason: 'Werbung fuer fremden Server', ago: 20 * HOUR },
    { action: 'BAN' as const, target: '200000000000000005', reason: 'Scam-Link verbreitet', ago: 30 * MINUTE },
  ];
  for (const entry of cases) {
    const created = await store.moderation.createCase({
      guildId: DEMO_GUILD_ID,
      action: entry.action,
      targetId: entry.target,
      targetTag: USERS.find((user) => user.id === entry.target)?.name ?? 'unbekannt',
      moderatorId: '200000000000000002',
      moderatorTag: 'demo_mod',
      reason: entry.reason,
      source: 'COMMAND',
      durationMs: entry.duration ?? null,
      expiresAt: entry.duration ? new Date(now + entry.duration) : null,
    });
    // Zeitstempel realistisch verteilen.
    const stored = store.data.cases.find((item) => item.id === created.id);
    if (stored) stored.createdAt = new Date(now - entry.ago);
  }
  await store.moderation.addWarning({
    guildId: DEMO_GUILD_ID,
    targetId: '200000000000000005',
    moderatorId: '200000000000000002',
    reason: 'Spam im Chat',
    points: 1,
  });

  // ---- Sicherheit ----
  await store.security.createIncident({
    guildId: DEMO_GUILD_ID,
    kind: 'ANTINUKE',
    severity: 'CRITICAL',
    status: 'OPEN',
    title: 'Anti-Nuke: CHANNEL_DELETE',
    description: '<@200000000000000004> hat 6 Kanaele in 60 Sekunden geloescht (Grenzwert: 3).',
    actorId: '200000000000000004',
    actorType: 'discord',
    robloxGameId: null,
    evidence: { action: 'CHANNEL_DELETE', count: 6, limit: 3 },
    actionsTaken: ['Rollen entzogen (4)'],
  });
  await store.security.createIncident({
    guildId: DEMO_GUILD_ID,
    kind: 'AUTOMOD',
    severity: 'MEDIUM',
    status: 'RESOLVED',
    title: 'Phishing-Domain blockiert',
    description: 'Nachricht mit bekannter Phishing-Domain wurde geloescht.',
    actorId: '200000000000000005',
    actorType: 'discord',
    robloxGameId: null,
    evidence: { rule: 'ANTI_PHISHING', host: 'discord-nitro.example' },
    actionsTaken: ['Nachricht geloescht', 'Timeout 10 Minuten'],
  });

  // ---- Tickets ----
  const ticket = await store.tickets.create({
    guildId: DEMO_GUILD_ID,
    channelId: '300000000000000010',
    openerId: '200000000000000003',
    category: 'SUPPORT',
    subject: 'Meine Roblox-Verknuepfung funktioniert nicht',
  });
  await store.tickets.addMessage({
    ticketId: ticket.id,
    messageId: '500000000000000001',
    authorId: '200000000000000003',
    authorTag: 'demo_player',
    content: 'Hallo, ich habe den Code eingegeben, aber nichts passiert.',
    attachments: [],
    isStaff: false,
  });
  await store.tickets.create({
    guildId: DEMO_GUILD_ID,
    channelId: '300000000000000011',
    openerId: '200000000000000004',
    category: 'UNBAN',
    subject: 'Entbannungsantrag',
  });

  // ---- Level & Wirtschaft ----
  const xpValues = [42_000, 28_500, 15_200, 9_800, 3_400];
  for (const [index, user] of USERS.entries()) {
    await store.levels.addXp(DEMO_GUILD_ID, user.id, xpValues[index] ?? 1_000);
    await store.economy.mutate({
      guildId: DEMO_GUILD_ID,
      userId: user.id,
      target: 'wallet',
      amount: 5_000 - index * 700,
      type: 'ADMIN_ADJUST',
      reason: 'Demo-Startguthaben',
      idempotencyKey: `seed:wallet:${user.id}`,
    });
  }
  await store.economy.upsertItem({
    guildId: DEMO_GUILD_ID,
    key: 'vip',
    name: 'VIP-Rolle',
    description: 'Farbige Rolle und Zugang zum VIP-Kanal',
    emoji: '👑',
    price: 10_000,
    sellPrice: 0,
    kind: 'role',
    roleId: '400000000000000002',
    payload: {},
    stock: -1,
    maxPerUser: 1,
    tradable: false,
    enabled: true,
  });

  // ---- Roblox ----
  const game = await store.roblox.upsertGame({
    guildId: DEMO_GUILD_ID,
    universeId: '7654321',
    placeId: '1234567',
    name: 'Demo Tycoon',
    iconUrl: null,
    signingSecretHash: 'demo-hash-nicht-verwendbar',
    secretHint: 'nxs_demo',
    active: true,
    settings: {},
  });
  for (const [index, jobId] of ['job-alpha-0001', 'job-beta-0002', 'job-gamma-0003'].entries()) {
    await store.roblox.recordHeartbeat({
      gameId: game.id,
      jobId,
      placeId: '1234567',
      region: ['eu-central', 'us-east', 'ap-south'][index] ?? 'eu-central',
      playerCount: [24, 17, 8][index] ?? 5,
      maxPlayers: 30,
      version: '1.4.2',
      fps: [59.4, 58.1, 60][index] ?? 60,
      memoryMb: 512 + index * 40,
      lastHeartbeatAt: new Date(now - index * 15_000),
      players: [],
    });
  }
  await store.roblox.linkAccount({
    userId: '200000000000000003',
    discordId: '200000000000000003',
    robloxUserId: '99887766',
    username: 'DemoPlayerRBLX',
    displayName: 'Demo Player',
    avatarUrl: null,
    method: 'game',
  });
  await store.roblox.recordEvent({
    gameId: game.id,
    eventId: 'demo-event-0001',
    type: 'PLAYER_JOIN',
    jobId: 'job-alpha-0001',
    robloxUserId: '99887766',
    payload: { placeVersion: '1.4.2' },
    occurredAt: new Date(now - 5 * MINUTE),
  });
  await store.roblox.recordEvent({
    gameId: game.id,
    eventId: 'demo-event-0002',
    type: 'PURCHASE',
    jobId: 'job-alpha-0001',
    robloxUserId: '99887766',
    payload: { productId: 'starter-pack', robux: 99 },
    occurredAt: new Date(now - 3 * MINUTE),
  });

  // ---- Audit & Benachrichtigungen ----
  await store.audit.log({
    guildId: DEMO_GUILD_ID,
    actorId: '200000000000000002',
    actorType: 'discord',
    action: 'moderation.ban',
    targetId: '200000000000000005',
    targetType: 'user',
    result: 'SUCCESS',
    reason: 'Scam-Link verbreitet',
    metadata: { caseId: 'NX-0001-000004' },
  });
  await store.audit.log({
    guildId: DEMO_GUILD_ID,
    actorId: '200000000000000001',
    actorType: 'dashboard',
    action: 'config.update',
    targetId: DEMO_GUILD_ID,
    targetType: 'guild',
    result: 'SUCCESS',
    reason: null,
    metadata: { fields: ['automodEnabled'] },
  });
  await store.notifications.create({
    guildId: DEMO_GUILD_ID,
    userId: null,
    category: 'security',
    severity: 'CRITICAL',
    title: 'Unbearbeiteter Vorfall: Anti-Nuke',
    body: 'Ein kritischer Vorfall wartet seit ueber einer Stunde auf Bearbeitung.',
    link: `/dashboard/${DEMO_GUILD_ID}/security`,
  });

  // ---- Analytik (30 Tage) ----
  for (let day = 29; day >= 0; day--) {
    const bucket = new Date(now - day * DAY);
    bucket.setUTCHours(0, 0, 0, 0);
    await store.analytics.record({
      guildId: DEMO_GUILD_ID,
      granularity: 'day',
      bucket,
      scope: 'discord',
      metrics: {
        members: 1_200 + (29 - day) * 3 + (day % 5),
        messages: 800 + ((day * 37) % 400),
        cases: (day % 4) + 1,
        openTickets: (day % 3) + 1,
        verified: 300 + (29 - day) * 2,
        robloxPlayers: 40 + ((day * 13) % 30),
      },
    });
  }
}
