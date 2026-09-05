/**
 * Vertrag fuer den generierten Prisma-Client.
 *
 * Warum handgeschrieben?
 *  - `@prisma/client` existiert erst nach `npm run db:generate`. Ein
 *    strukturell deklarierter Vertrag haelt Typpruefung, Tests und Build
 *    unabhaengig von der Codegenerierung (und CI ohne Datenbank lauffaehig).
 *  - Der Rest der Anwendung sieht ausschliesslich Domaenen-Entitaeten; nur
 *    dieser Adapter kennt Zeilenformate.
 *
 * Die Feldnamen entsprechen exakt `prisma/schema.prisma`.
 */
export type Row = Record<string, unknown>;

export interface FindManyArgs {
  where?: Row;
  orderBy?: Row | Row[];
  take?: number;
  skip?: number;
  include?: Row;
  select?: Row;
  distinct?: string | string[];
}

export interface ModelDelegate<T> {
  findUnique(args: { where: Row; include?: Row }): Promise<T | null>;
  findFirst(args?: FindManyArgs): Promise<T | null>;
  findMany(args?: FindManyArgs): Promise<T[]>;
  create(args: { data: Row; include?: Row }): Promise<T>;
  createMany(args: { data: Row[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
  update(args: { where: Row; data: Row; include?: Row }): Promise<T>;
  updateMany(args: { where?: Row; data: Row }): Promise<{ count: number }>;
  upsert(args: { where: Row; create: Row; update: Row }): Promise<T>;
  delete(args: { where: Row }): Promise<T>;
  deleteMany(args?: { where?: Row }): Promise<{ count: number }>;
  count(args?: { where?: Row }): Promise<number>;
  aggregate(args: Row): Promise<Row>;
  groupBy(args: Row): Promise<Row[]>;
}

/** Fehlerform von Prisma bei Constraint-Verletzungen. */
export interface PrismaKnownError extends Error {
  code?: string;
  meta?: { target?: string[] };
}

export interface PrismaLike {
  user: ModelDelegate<Row>;
  guild: ModelDelegate<Row>;
  guildConfig: ModelDelegate<Row>;
  guildMember: ModelDelegate<Row>;
  permissionGrant: ModelDelegate<Row>;
  moderationCase: ModelDelegate<Row>;
  warning: ModelDelegate<Row>;
  securityIncident: ModelDelegate<Row>;
  auditLog: ModelDelegate<Row>;
  backup: ModelDelegate<Row>;
  ticketPanel: ModelDelegate<Row>;
  ticket: ModelDelegate<Row>;
  ticketMessage: ModelDelegate<Row>;
  reactionRole: ModelDelegate<Row>;
  suggestion: ModelDelegate<Row>;
  starboardEntry: ModelDelegate<Row>;
  xPProfile: ModelDelegate<Row>;
  levelReward: ModelDelegate<Row>;
  economyProfile: ModelDelegate<Row>;
  transaction: ModelDelegate<Row>;
  item: ModelDelegate<Row>;
  inventoryItem: ModelDelegate<Row>;
  giveaway: ModelDelegate<Row>;
  robloxAccount: ModelDelegate<Row>;
  verification: ModelDelegate<Row>;
  robloxGame: ModelDelegate<Row>;
  robloxServer: ModelDelegate<Row>;
  robloxSession: ModelDelegate<Row>;
  robloxEvent: ModelDelegate<Row>;
  robloxEventRoute: ModelDelegate<Row>;
  robloxCommand: ModelDelegate<Row>;
  robloxGroup: ModelDelegate<Row>;
  robloxGroupMembership: ModelDelegate<Row>;
  achievement: ModelDelegate<Row>;
  userAchievement: ModelDelegate<Row>;
  rewardGrant: ModelDelegate<Row>;
  promoCode: ModelDelegate<Row>;
  promoRedemption: ModelDelegate<Row>;
  automation: ModelDelegate<Row>;
  automationRun: ModelDelegate<Row>;
  analyticsSnapshot: ModelDelegate<Row>;
  apiKey: ModelDelegate<Row>;
  apiRequestLog: ModelDelegate<Row>;
  webhook: ModelDelegate<Row>;
  notification: ModelDelegate<Row>;
  dashboardSession: ModelDelegate<Row>;

  $transaction<T>(
    fn: (tx: PrismaLike) => Promise<T>,
    options?: { timeout?: number; isolationLevel?: string },
  ): Promise<T>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
}

/** Unique-Constraint verletzt (z. B. paralleler Insert mit gleicher Sequenz). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as PrismaKnownError).code === 'P2002';
}

export function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as PrismaKnownError).code === 'P2025';
}

/**
 * Laedt den generierten Prisma-Client zur Laufzeit.
 * Ein aussagekraeftiger Fehler weist auf den fehlenden Generate-Schritt hin.
 */
export async function loadPrismaClient(): Promise<PrismaLike> {
  let module: { PrismaClient: new (options?: Row) => PrismaLike };
  try {
    module = (await import('@prisma/client')) as unknown as {
      PrismaClient: new (options?: Row) => PrismaLike;
    };
  } catch (error) {
    throw new Error(
      'Prisma-Client nicht gefunden. Bitte `npm run db:generate` ausfuehren ' +
        '(oder DEV_MODE=true fuer den In-Memory-Modus setzen).',
      { cause: error },
    );
  }
  return new module.PrismaClient({
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });
}
