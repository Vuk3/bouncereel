import type { Config } from '../config.ts';
import { DuelWorld } from './duel.ts';
import { STEP } from './types.ts';

export type World = DuelWorld;

/**
 * A race as it plays: once a team wins, every ball stops where it is. `runOn` keeps the other
 * team going to the line instead, which only measuring finish times needs (finishTimes).
 */
export function createWorld(cfg: Config, runOn = false): World {
  return new DuelWorld(cfg, runOn);
}

/** How a seed plays out, known before anything is drawn. */
export interface Outcome {
  seed: string;
  winner: number | null;
  winnerName: string;
  /** Seconds of simulation until the win. */
  time: number;
  timedOut: boolean;
  /** The loser's progress when the winner finished, 0..1: 0.9 and up is a photo finish. */
  runnerUp: number;
  /** Times the lead changed hands. Each is a moment the viewer's pick flips. */
  leadChanges: number;
  /**
   * The changes the video marks with LEAD CHANGE (src/render), at the race time each was seen,
   * with the team that took the lead: those it kept for LEAD_HOLD or more, and the last one if
   * it kept it to the end; and of those, only one that hands the lead to the other team than
   * the last marked (or the first leader). A close race swaps the lead back and forth (the classic
   * three times in 1.5 s), and a flash for each would be noise; a lead that flipped and came
   * back within a second never changed for the viewer.
   */
  leads: { at: number; team: number }[];
}

/** Race seconds a new leader must keep the lead for its change to be marked (Outcome.leads). */
const LEAD_HOLD = 1;

/**
 * Runs a config to the end without drawing. A minute of race takes a few
 * milliseconds, so this runs after every panel change and across hundreds
 * of seeds in the seed search.
 */
export function predict(cfg: Config): Outcome {
  const world = createWorld(cfg);
  let leader = -1;
  let first = -1;
  let leadChanges = 0;
  const changes: Outcome['leads'] = [];
  let nextSample = 0;
  const limit = cfg.timing.maxSeconds + 1;

  while (world.winner === null && world.time < limit) {
    world.step(STEP);
    world.drain();
    // Sampled four times a second: a lead that flips back within 250 ms was never visible.
    if (world.time >= nextSample) {
      nextSample += 0.25;
      const [a, b] = world.teams.map((t) => world.progress(t));
      const ahead = a > b ? 0 : b > a ? 1 : leader;
      if (ahead !== leader) {
        if (leader >= 0) {
          leadChanges++;
          changes.push({ at: world.time, team: ahead });
        } else first = ahead;
        leader = ahead;
      }
    }
  }

  // The step that ends the race is never a sample, and on it the winner can go ahead: two balls
  // through their layers tie at 0.95, the lead staying with the first one through, and the
  // winner passes at the line (1). That change counts, and ends the hold of the one before it,
  // but is not marked itself: the finish says it.
  const atLine = world.winner !== null && leader >= 0 && world.winner !== leader ? world.time : null;
  if (atLine !== null) leadChanges++;
  const leads: Outcome['leads'] = [];
  let marked = first;
  for (const [i, c] of changes.entries()) {
    const next = changes[i + 1]?.at ?? atLine;
    if ((next === null || next - c.at >= LEAD_HOLD) && c.team !== marked) {
      leads.push(c);
      marked = c.team;
    }
  }

  const winner = world.winner;
  const loser = world.teams.find((t) => t.id !== winner);
  return {
    seed: cfg.seed,
    winner,
    winnerName: world.teams.find((t) => t.id === winner)?.name ?? '',
    time: world.winTime,
    timedOut: winner === null || world.timedOut,
    runnerUp: loser ? world.progress(loser) : 0,
    leadChanges,
    leads,
  };
}

/**
 * When each team touches the finish line, running on past the winner; Infinity
 * for a team that has not by `limit` seconds. Teams never interact, so this is
 * what balancing measures.
 */
export function finishTimes(cfg: Config, limit: number): [number, number] {
  const world = createWorld({ ...cfg, timing: { ...cfg.timing, maxSeconds: limit + 1 } }, true);
  const times: [number, number] = [Infinity, Infinity];
  while ((times[0] === Infinity || times[1] === Infinity) && world.time < limit) {
    world.step(STEP);
    for (const e of world.drain()) if (e.type === 'finish') times[e.team] = world.time;
  }
  return times;
}
