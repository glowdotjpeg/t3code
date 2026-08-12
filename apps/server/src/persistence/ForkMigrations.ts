/**
 * Fork-owned migrations use a separate tracking table so upstream can keep
 * allocating sequential migration ids without colliding with this fork.
 */
import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";

import Migration0001 from "./ForkMigrations/001_ProjectlessThreads.ts";

const makeForkMigrationLoader = () =>
  Migrator.fromRecord({
    "1_ProjectlessThreads": Migration0001,
  });

const run = Migrator.make({});

export const runForkMigrations = Effect.fn("runForkMigrations")(function* () {
  const executedMigrations = yield* run({
    loader: makeForkMigrationLoader(),
    table: "t3code_fork_migrations",
  });
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0
    ? Effect.logDebug("Fork database schema is current")
    : Effect.log("Fork migrations ran successfully").pipe(Effect.annotateLogs({ migrations }));
  return executedMigrations;
});
