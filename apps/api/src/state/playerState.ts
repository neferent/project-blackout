import { and, desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  interpolateAlongLine,
  tripProgress,
  type Action,
  type LatLng,
  type PlayerState,
  type TravelActionData,
} from "@blackout/shared";
import { db } from "../db/client.js";
import { actions, players } from "../db/schema.js";
import { cellForPosition } from "../lib/h3.js";
import { computePersonalClock } from "../actions/personalClock.js";

/**
 * Resolves a player's current, read-time state: position (interpolated along
 * an in-progress trip, or their last resting point), H3 cell, personal clock,
 * and the active action if any. Also lazily finalizes a trip that has ended
 * since the last read (moves the resting position to the destination).
 */
export async function resolvePlayerState(anonKey: string): Promise<PlayerState | null> {
  const [player] = await db.select().from(players).where(eq(players.anonKey, anonKey)).limit(1);
  if (!player) return null;

  const now = new Date();
  const playerActions = await db
    .select()
    .from(actions)
    .where(eq(actions.playerId, player.id))
    .orderBy(actions.startsAt);

  const latest = playerActions.at(-1);

  let position: LatLng;
  let activeAction: Action | null = null;

  if (latest && latest.kind === "travel") {
    const data = latest.data as TravelActionData;
    const fraction = tripProgress(latest.startsAt, latest.endsAt, now);
    if (fraction < 1) {
      position = interpolateAlongLine(data.route.coordinates, fraction);
      activeAction = latest as unknown as Action;
    } else {
      position = data.destination;
      await finalizeRestingPosition(player.id, position);
    }
  } else {
    const [row] = await db.execute<{ lng: number; lat: number }>(sql`
      select ST_X(${players.position}) as lng, ST_Y(${players.position}) as lat
      from ${players} where ${players.id} = ${player.id}
    `);
    position = { lat: Number(row.lat), lng: Number(row.lng) };
  }

  const h3Cell = cellForPosition(position);

  const personalClock = computePersonalClock(
    player.createdAt,
    playerActions.map((a) => ({ kind: a.kind as Action["kind"], data: a.data, startsAt: a.startsAt, endsAt: a.endsAt })),
    now,
  );

  return {
    player: { id: player.id, anonKey: player.anonKey, createdAt: player.createdAt },
    basePosition: { lat: player.baseLat, lng: player.baseLng },
    position,
    h3Cell,
    personalClock,
    activeAction,
  };
}

async function finalizeRestingPosition(playerId: string, position: LatLng): Promise<void> {
  const cell = cellForPosition(position);
  await db.execute(sql`
    update ${players}
    set position = ST_SetSRID(ST_MakePoint(${position.lng}, ${position.lat}), 4326),
        current_h3_cell = ${cell}
    where id = ${playerId}
  `);
}

export async function hasActiveTrip(playerId: string): Promise<boolean> {
  const [latest] = await db
    .select()
    .from(actions)
    .where(and(eq(actions.playerId, playerId), eq(actions.kind, "travel")))
    .orderBy(desc(actions.startsAt))
    .limit(1);

  if (!latest) return false;
  return tripProgress(latest.startsAt, latest.endsAt, new Date()) < 1;
}
