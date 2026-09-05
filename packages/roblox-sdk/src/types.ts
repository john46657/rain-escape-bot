import { z } from 'zod';

export const robloxUserSchema = z.object({
  id: z.number(),
  name: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  created: z.string().optional(),
  isBanned: z.boolean().optional(),
  hasVerifiedBadge: z.boolean().optional(),
});
export type RobloxUser = z.infer<typeof robloxUserSchema>;

export const robloxGroupRoleSchema = z.object({
  group: z.object({
    id: z.number(),
    name: z.string(),
    memberCount: z.number().optional(),
  }),
  role: z.object({
    id: z.number(),
    name: z.string(),
    rank: z.number(),
  }),
});
export type RobloxGroupRole = z.infer<typeof robloxGroupRoleSchema>;

export const robloxUniverseSchema = z.object({
  id: z.number(),
  rootPlaceId: z.number().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  playing: z.number().optional(),
  visits: z.number().optional(),
  maxPlayers: z.number().optional(),
  favoritedCount: z.number().optional(),
});
export type RobloxUniverse = z.infer<typeof robloxUniverseSchema>;
