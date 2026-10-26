use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Instant,
};

use bigdecimal::BigDecimal;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{
    postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgRow, PgSslMode},
    Column, Row, TypeInfo,
};
use tauri::State;
use uuid::Uuid;

static NEXT_CONNECTION_ID: AtomicU64 = AtomicU64::new(1);
const DEFAULT_QUERY_ROW_LIMIT: usize = 1_000;

#[derive(Default)]
struct DbState {
    pools: Mutex<HashMap<String, PgPool>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PostgresConnectionConfig {
    name: String,
    host: String,
    port: u16,
    database: String,
    username: String,
    password: String,
    ssl_mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionSummary {
    id: String,
    name: String,
    host: String,
    database: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ColumnInfo {
    name: String,
    data_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SchemaColumnInfo {
    name: String,
    data_type: String,
    nullable: bool,
    default_value: Option<String>,
    primary_key: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SchemaIndexInfo {
    name: String,
    definition: String,
    unique: bool,
    primary: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SchemaConstraintInfo {
    name: String,
    constraint_type: String,
    definition: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SchemaObjectInfo {
    schema_name: String,
    object_name: String,
    object_type: String,
    columns: Vec<SchemaColumnInfo>,
    indexes: Vec<SchemaIndexInfo>,
    constraints: Vec<SchemaConstraintInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryExecutionResult {
    columns: Vec<ColumnInfo>,
    rows: Vec<Vec<Value>>,
    rows_affected: u64,
    duration_ms: u128,
    truncated: bool,
    row_limit: usize,
    message: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DbState::default())
        .invoke_handler(tauri::generate_handler![
            connect_postgres,
            disconnect_database,
            list_schema_objects,
            execute_query
        ])
        .run(tauri::generate_context!())
        .expect("error while running DBUX");
}

#[tauri::command]
async fn connect_postgres(
    config: PostgresConnectionConfig,
    state: State<'_, DbState>,
) -> Result<ConnectionSummary, String> {
    if config.host.trim().is_empty()
        || config.database.trim().is_empty()
        || config.username.trim().is_empty()
    {
        return Err("Host, database, and username are required.".to_string());
    }

    let ssl_mode = match config.ssl_mode.as_str() {
        "disable" => PgSslMode::Disable,
        "require" => PgSslMode::Require,
        "verify-ca" => PgSslMode::VerifyCa,
        "verify-full" => PgSslMode::VerifyFull,
        _ => PgSslMode::Prefer,
    };

    let options = PgConnectOptions::new()
        .host(&config.host)
        .port(config.port)
        .database(&config.database)
        .username(&config.username)
        .password(&config.password)
        .ssl_mode(ssl_mode);

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(8))
        .connect_with(options)
        .await
        .map_err(|error| format_database_error(&error.to_string()))?;

    sqlx::query("SELECT 1")
        .execute(&pool)
        .await
        .map_err(|error| format_database_error(&error.to_string()))?;

    let id = format!("pg-{}", NEXT_CONNECTION_ID.fetch_add(1, Ordering::Relaxed));
    state
        .pools
        .lock()
        .map_err(|_| "Connection manager is unavailable.".to_string())?
        .insert(id.clone(), pool);

    Ok(ConnectionSummary {
        id,
        name: config.name,
        host: config.host,
        database: config.database,
    })
}

#[tauri::command]
async fn disconnect_database(
    connection_id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let pool = state
        .pools
        .lock()
        .map_err(|_| "Connection manager is unavailable.".to_string())?
        .remove(&connection_id);

    if let Some(pool) = pool {
        pool.close().await;
    }

    Ok(())
}

#[tauri::command]
async fn list_schema_objects(
    connection_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<SchemaObjectInfo>, String> {
    let pool = state
        .pools
        .lock()
        .map_err(|_| "Connection manager is unavailable.".to_string())?
        .get(&connection_id)
        .cloned()
        .ok_or_else(|| "Database connection is no longer active.".to_string())?;

    let rows = sqlx::query(
        r#"
        SELECT
            c.table_schema,
            c.table_name,
            CASE t.table_type
                WHEN 'BASE TABLE' THEN 'Table'
                WHEN 'VIEW' THEN 'View'
                ELSE 'Foreign table'
            END AS object_type,
            c.column_name,
            c.data_type,
            (c.is_nullable = 'YES') AS nullable,
            c.column_default AS default_value,
            EXISTS (
                SELECT 1
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON kcu.constraint_catalog = tc.constraint_catalog
                 AND kcu.constraint_schema = tc.constraint_schema
                 AND kcu.constraint_name = tc.constraint_name
                 AND kcu.table_schema = tc.table_schema
                 AND kcu.table_name = tc.table_name
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND kcu.table_schema = c.table_schema
                  AND kcu.table_name = c.table_name
                  AND kcu.column_name = c.column_name
            ) AS primary_key
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema
         AND t.table_name = c.table_name
        WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
          AND t.table_type IN ('BASE TABLE', 'VIEW', 'FOREIGN')
        ORDER BY c.table_schema, c.table_name, c.ordinal_position
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| format_database_error(&error.to_string()))?;

    let mut objects: Vec<SchemaObjectInfo> = Vec::new();
    for row in rows {
        let schema_name: String = row
            .try_get("table_schema")
            .map_err(|error| format_database_error(&error.to_string()))?;
        let object_name: String = row
            .try_get("table_name")
            .map_err(|error| format_database_error(&error.to_string()))?;
        let object_type: String = row
            .try_get("object_type")
            .map_err(|error| format_database_error(&error.to_string()))?;
        let column = SchemaColumnInfo {
            name: row
                .try_get("column_name")
                .map_err(|error| format_database_error(&error.to_string()))?,
            data_type: row
                .try_get("data_type")
                .map_err(|error| format_database_error(&error.to_string()))?,
            nullable: row
                .try_get("nullable")
                .map_err(|error| format_database_error(&error.to_string()))?,
            default_value: row
                .try_get("default_value")
                .map_err(|error| format_database_error(&error.to_string()))?,
            primary_key: row
                .try_get("primary_key")
                .map_err(|error| format_database_error(&error.to_string()))?,
        };

        let object_is_current = objects.last().is_some_and(|object| {
            object.schema_name == schema_name && object.object_name == object_name
        });
        if !object_is_current {
            objects.push(SchemaObjectInfo {
                schema_name,
                object_name,
                object_type,
                columns: Vec::new(),
                indexes: Vec::new(),
                constraints: Vec::new(),
            });
        }
        if let Some(object) = objects.last_mut() {
            object.columns.push(column);
        }
    }

    let index_rows = sqlx::query(
        r#"
        SELECT
            ns.nspname AS schema_name,
            tbl.relname AS object_name,
            idx.relname AS index_name,
            ix.indisunique AS is_unique,
            ix.indisprimary AS is_primary,
            pg_get_indexdef(ix.indexrelid) AS definition
        FROM pg_index ix
        JOIN pg_class tbl ON tbl.oid = ix.indrelid
        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
        JOIN pg_class idx ON idx.oid = ix.indexrelid
        WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
          AND tbl.relkind IN ('r', 'p', 'f')
        ORDER BY ns.nspname, tbl.relname, idx.relname
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| format_database_error(&error.to_string()))?;

    for row in index_rows {
        let schema_name: String = row
            .try_get("schema_name")
            .map_err(|error| format_database_error(&error.to_string()))?;
        let object_name: String = row
            .try_get("object_name")
            .map_err(|error| format_database_error(&error.to_string()))?;
        let index = SchemaIndexInfo {
            name: row
                .try_get("index_name")
                .map_err(|error| format_database_error(&error.to_string()))?,
            definition: row
                .try_get("definition")
                .map_err(|error| format_database_error(&error.to_string()))?,
            unique: row
                .try_get("is_unique")
                .map_err(|error| format_database_error(&error.to_string()))?,
            primary: row
                .try_get("is_primary")
                .map_err(|error| format_database_error(&error.to_string()))?,
        };
        if let Some(object) = objects.iter_mut().find(|object| {
            object.schema_name == schema_name && object.object_name == object_name
        }) {
            object.indexes.push(index);
        }
    }

    let constraint_rows = sqlx::query(
        r#"
        SELECT
            ns.nspname AS schema_name,
            tbl.relname AS object_name,
            con.conname AS constraint_name,
            CASE con.contype
                WHEN 'p' THEN 'Primary key'
                WHEN 'f' THEN 'Foreign key'
                WHEN 'u' THEN 'Unique'
                WHEN 'c' THEN 'Check'
                WHEN 'x' THEN 'Exclusion'
                ELSE 'Other'
            END AS constraint_type,
            pg_get_constraintdef(con.oid, true) AS definition
        FROM pg_constraint con
        JOIN pg_class tbl ON tbl.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
        WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
          AND con.contype IN ('p', 'f', 'u', 'c', 'x')
          AND tbl.relkind IN ('r', 'p', 'f', 'm')
        ORDER BY ns.nspname, tbl.relname, con.conname
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| format_database_error(&error.to_string()))?;

    for row in constraint_rows {
        let schema_name: String = row
            .try_get("schema_name")
            .map_err(|error| format_database_error(&error.to_string()))?;
        let object_name: String = row
            .try_get("object_name")
            .map_err(|error| format_database_error(&error.to_string()))?;
        let constraint = SchemaConstraintInfo {
            name: row
                .try_get("constraint_name")
                .map_err(|error| format_database_error(&error.to_string()))?,
            constraint_type: row
                .try_get("constraint_type")
                .map_err(|error| format_database_error(&error.to_string()))?,
            definition: row
                .try_get("definition")
                .map_err(|error| format_database_error(&error.to_string()))?,
        };
        if let Some(object) = objects.iter_mut().find(|object| {
            object.schema_name == schema_name && object.object_name == object_name
        }) {
            object.constraints.push(constraint);
        }
    }

    Ok(objects)
}

#[tauri::command]
async fn execute_query(
    connection_id: String,
    sql: String,
    state: State<'_, DbState>,
) -> Result<QueryExecutionResult, String> {
    let pool = state
        .pools
        .lock()
        .map_err(|_| "Connection manager is unavailable.".to_string())?
        .get(&connection_id)
        .cloned()
        .ok_or_else(|| "Database connection is no longer active.".to_string())?;

    let statement = sql.trim();
    if statement.is_empty() {
        return Err("Enter a SQL statement to execute.".to_string());
    }

    let started = Instant::now();
    if returns_rows(statement) {
        // Stream rows instead of loading the full result into memory. Read one extra
        // row to distinguish a complete result from one truncated at the UI limit.
        let mut stream = sqlx::query(statement).fetch(&pool);
        let mut fetched = Vec::with_capacity(DEFAULT_QUERY_ROW_LIMIT.min(256));
        let mut truncated = false;
        while let Some(row) = stream.next().await {
            let row = row.map_err(|error| format_database_error(&error.to_string()))?;
            if fetched.len() == DEFAULT_QUERY_ROW_LIMIT {
                truncated = true;
                break;
            }
            fetched.push(row);
        }
        drop(stream);

        let columns = fetched
            .first()
            .map(|row| {
                row.columns()
                    .iter()
                    .map(|column| ColumnInfo {
                        name: column.name().to_string(),
                        data_type: column.type_info().name().to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        let rows = fetched
            .iter()
            .map(|row| {
                row.columns()
                    .iter()
                    .enumerate()
                    .map(|(index, column)| {
                        decode_cell(row, index, column.type_info().name()).map_err(|error| {
                            format!(
                                "Could not decode column '{}' ({}): {}",
                                column.name(),
                                column.type_info().name(),
                                format_database_error(&error),
                            )
                        })
                    })
                    .collect::<Result<Vec<Value>, String>>()
            })
            .collect::<Result<Vec<Vec<Value>>, String>>()?;

        let row_count = rows.len() as u64;
        let message = if truncated {
            format!(
                "Query completed · showing first {row_count} row(s); result truncated at {DEFAULT_QUERY_ROW_LIMIT}"
            )
        } else {
            format!("Query completed · {row_count} row(s) returned")
        };
        Ok(QueryExecutionResult {
            columns,
            rows,
            rows_affected: row_count,
            duration_ms: started.elapsed().as_millis(),
            truncated,
            row_limit: DEFAULT_QUERY_ROW_LIMIT,
            message,
        })
    } else {
        let result = sqlx::query(statement)
            .execute(&pool)
            .await
            .map_err(|error| format_database_error(&error.to_string()))?;
        let rows_affected = result.rows_affected();

        Ok(QueryExecutionResult {
            columns: Vec::new(),
            rows: Vec::new(),
            rows_affected,
            duration_ms: started.elapsed().as_millis(),
            truncated: false,
            row_limit: DEFAULT_QUERY_ROW_LIMIT,
            message: format!("Statement completed · {rows_affected} row(s) affected"),
        })
    }
}

fn returns_rows(sql: &str) -> bool {
    let upper = sql.trim_start().to_ascii_uppercase();
    let first = upper.split_whitespace().next().unwrap_or_default();
    matches!(
        first,
        "SELECT" | "WITH" | "SHOW" | "VALUES" | "EXPLAIN" | "TABLE"
    ) || upper.contains("RETURNING")
}

fn decode_optional<T>(
    value: Result<Option<T>, String>,
    map: impl FnOnce(T) -> Value,
) -> Result<Value, String> {
    match value {
        Ok(Some(value)) => Ok(map(value)),
        Ok(None) => Ok(Value::Null),
        Err(error) => Err(error),
    }
}

fn decode_cell(row: &PgRow, index: usize, type_name: &str) -> Result<Value, String> {
    macro_rules! decode {
        ($ty:ty) => {
            decode_optional(
                row.try_get::<Option<$ty>, _>(index)
                    .map_err(|error| error.to_string()),
                |value| json!(value),
            )
        };
    }

    match type_name {
        "BOOL" => decode!(bool),
        "INT2" => decode!(i16),
        "INT4" => decode!(i32),
        // JavaScript numbers cannot exactly represent all i64 values. Keep BIGINT
        // values as decimal strings so the UI never silently rounds them.
        "INT8" => decode_optional(
            row.try_get::<Option<i64>, _>(index)
                .map_err(|error| error.to_string()),
            |value| Value::String(value.to_string()),
        ),
        "FLOAT4" => decode!(f32),
        "FLOAT8" => decode!(f64),
        "NUMERIC" => decode_optional(
            row.try_get::<Option<BigDecimal>, _>(index)
                .map_err(|error| error.to_string()),
            |value| Value::String(value.to_string()),
        ),
        "UUID" => decode_optional(
            row.try_get::<Option<Uuid>, _>(index)
                .map_err(|error| error.to_string()),
            |value| Value::String(value.to_string()),
        ),
        "JSON" | "JSONB" => decode_optional(
            row.try_get::<Option<Value>, _>(index)
                .map_err(|error| error.to_string()),
            |value| value,
        ),
        "DATE" => decode_optional(
            row.try_get::<Option<NaiveDate>, _>(index)
                .map_err(|error| error.to_string()),
            |value| Value::String(value.to_string()),
        ),
        "TIME" => decode_optional(
            row.try_get::<Option<NaiveTime>, _>(index)
                .map_err(|error| error.to_string()),
            |value| Value::String(value.to_string()),
        ),
        "TIMESTAMP" => decode_optional(
            row.try_get::<Option<NaiveDateTime>, _>(index)
                .map_err(|error| error.to_string()),
            |value| Value::String(value.to_string()),
        ),
        "TIMESTAMPTZ" => decode_optional(
            row.try_get::<Option<DateTime<Utc>>, _>(index)
                .map_err(|error| error.to_string()),
            |value| Value::String(value.to_rfc3339()),
        ),
        "BYTEA" => decode_optional(
            row.try_get::<Option<Vec<u8>>, _>(index)
                .map_err(|error| error.to_string()),
            |bytes| Value::String(encode_hex(&bytes)),
        ),
        "TEXT" | "VARCHAR" | "BPCHAR" | "NAME" | "CHAR" => decode_optional(
            row.try_get::<Option<String>, _>(index)
                .map_err(|error| error.to_string()),
            Value::String,
        ),
        _ => match row.try_get::<Option<String>, _>(index) {
            Ok(Some(value)) => Ok(Value::String(value)),
            Ok(None) => Ok(Value::Null),
            // This is deliberately visible instead of being confused with SQL NULL.
            Err(_) => Ok(json!(format!("<unsupported: {type_name}>"))),
        },
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn format_database_error(error: &str) -> String {
    // Never include connection configuration or credentials in an error message.
    error
        .replace('\n', " ")
        .chars()
        .take(600)
        .collect::<String>()
}

#[cfg(test)]
mod tests {
    use super::{decode_optional, returns_rows};
    use serde_json::{json, Value};

    #[test]
    fn preserves_null_without_converting_decode_errors_to_null() {
        let null_value = decode_optional::<String>(Ok(None), Value::String);
        assert_eq!(null_value.unwrap(), Value::Null);

        let decode_error =
            decode_optional::<String>(Err("intentional decode failure".to_string()), Value::String);
        assert_eq!(
            decode_error.unwrap_err(),
            "intentional decode failure",
            "a decoder failure must remain an error, not become SQL NULL",
        );
    }

    #[test]
    fn decoder_can_preserve_exact_integer_text() {
        let integer = decode_optional(Ok(Some(9_223_372_036_854_775_807_i64)), |value| {
            Value::String(value.to_string())
        });
        assert_eq!(integer.unwrap(), json!("9223372036854775807"));
    }

    #[test]
    fn recognizes_queries_that_return_rows() {
        for sql in [
            "SELECT 1",
            "select * from items",
            "WITH items AS (SELECT 1) SELECT * FROM items",
            "SHOW search_path",
            "INSERT INTO items(name) VALUES ('x') RETURNING id",
        ] {
            assert!(returns_rows(sql), "expected row-returning: {sql}");
        }
    }

    #[test]
    fn recognizes_statements_without_returning_rows() {
        for sql in [
            "CREATE TABLE items (id integer)",
            "INSERT INTO items(name) VALUES ('x')",
            "UPDATE items SET name = 'y'",
            "DELETE FROM items",
        ] {
            assert!(!returns_rows(sql), "expected command: {sql}");
        }
    }
}
