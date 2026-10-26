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
