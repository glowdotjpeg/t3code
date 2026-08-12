import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const TABLE_NAME = "projection_threads";
const OLD_TABLE_NAME = "projection_threads_with_required_project";

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tableRows = yield* sql<{ readonly sql: string | null }>`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = ${TABLE_NAME}
  `;
  const createTableSql = tableRows[0]?.sql ?? null;
  if (createTableSql === null) {
    return yield* Effect.die(new Error(`Could not read ${TABLE_NAME} schema`));
  }

  const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
    PRAGMA table_info(${sql(TABLE_NAME)})
  `;
  if (columns.find((column) => column.name === "project_id")?.notnull === 0) {
    return;
  }

  const nullableCreateTableSql = createTableSql.replace(
    /(\bproject_id\b[^,\n]*?)\s+NOT\s+NULL\b/i,
    "$1",
  );
  if (nullableCreateTableSql === createTableSql) {
    return yield* Effect.die(new Error(`Could not make ${TABLE_NAME}.project_id nullable`));
  }

  const columnList = columns.map((column) => quoteIdentifier(column.name)).join(", ");
  const schemaObjects = yield* sql<{ readonly sql: string | null }>`
    SELECT sql
    FROM sqlite_master
    WHERE tbl_name = ${TABLE_NAME}
      AND type IN ('index', 'trigger')
      AND sql IS NOT NULL
    ORDER BY type, name
  `;

  yield* sql.unsafe(
    `ALTER TABLE ${quoteIdentifier(TABLE_NAME)} RENAME TO ${quoteIdentifier(OLD_TABLE_NAME)}`,
  );
  yield* sql.unsafe(nullableCreateTableSql);
  yield* sql.unsafe(
    `INSERT INTO ${quoteIdentifier(TABLE_NAME)} (${columnList}) SELECT ${columnList} FROM ${quoteIdentifier(OLD_TABLE_NAME)}`,
  );
  yield* sql.unsafe(`DROP TABLE ${quoteIdentifier(OLD_TABLE_NAME)}`);

  for (const schemaObject of schemaObjects) {
    if (schemaObject.sql !== null) {
      yield* sql.unsafe(schemaObject.sql);
    }
  }
});
