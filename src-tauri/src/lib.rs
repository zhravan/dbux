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
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{
    postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgRow, PgSslMode},
    Column, Row, TypeInfo,
};
use tauri::State;
use uuid::Uuid;

static NEXT_CONNECTION_ID: AtomicU64 = AtomicU64::new(1);

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

    let id = format!(
        "pg-{}",
        NEXT_CONNECTION_ID.fetch_add(1, Ordering::Relaxed)
    );
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
        let fetched = sqlx::query(statement)
            .fetch_all(&pool)
            .await
            .map_err(|error| format_database_error(&error.to_string()))?;

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
                    .map(|(index, column)| decode_cell(row, index, column.type_info().name()))
                    .collect()
            })
            .collect::<Vec<Vec<Value>>>();

        let row_count = rows.len() as u64;
        Ok(QueryExecutionResult {
            columns,
            rows,
            rows_affected: row_count,
            duration_ms: started.elapsed().as_millis(),
            message: format!("Query completed · {row_count} row(s) returned"),
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
            message: format!("Statement completed · {rows_affected} row(s) affected"),
        })
    }
}

fn returns_rows(sql: &str) -> bool {
    let upper = sql.trim_start().to_ascii_uppercase();
    let first = upper.split_whitespace().next().unwrap_or_default();
    matches!(first, "SELECT" | "WITH" | "SHOW" | "VALUES" | "EXPLAIN" | "TABLE")
        || upper.contains("RETURNING")
}

fn decode_cell(row: &PgRow, index: usize, type_name: &str) -> Value {
    macro_rules! decode {
        ($ty:ty) => {
            row.try_get::<Option<$ty>, _>(index)
                .ok()
                .flatten()
                .map(|value| json!(value))
                .unwrap_or(Value::Null)
        };
    }

    match type_name {
        "BOOL" => decode!(bool),
        "INT2" => decode!(i16),
        "INT4" => decode!(i32),
        "INT8" => decode!(i64),
        "FLOAT4" => decode!(f32),
        "FLOAT8" => decode!(f64),
        "NUMERIC" => row
            .try_get::<Option<BigDecimal>, _>(index)
            .ok()
            .flatten()
            .map(|value| Value::String(value.to_string()))
            .unwrap_or(Value::Null),
        "UUID" => row
            .try_get::<Option<Uuid>, _>(index)
            .ok()
            .flatten()
            .map(|value| Value::String(value.to_string()))
            .unwrap_or(Value::Null),
        "JSON" | "JSONB" => row
            .try_get::<Option<Value>, _>(index)
            .ok()
            .flatten()
            .unwrap_or(Value::Null),
        "DATE" => row
            .try_get::<Option<NaiveDate>, _>(index)
            .ok()
            .flatten()
            .map(|value| Value::String(value.to_string()))
            .unwrap_or(Value::Null),
        "TIME" => row
            .try_get::<Option<NaiveTime>, _>(index)
            .ok()
            .flatten()
            .map(|value| Value::String(value.to_string()))
            .unwrap_or(Value::Null),
        "TIMESTAMP" => row
            .try_get::<Option<NaiveDateTime>, _>(index)
            .ok()
            .flatten()
            .map(|value| Value::String(value.to_string()))
            .unwrap_or(Value::Null),
        "TIMESTAMPTZ" => row
            .try_get::<Option<DateTime<Utc>>, _>(index)
            .ok()
            .flatten()
            .map(|value| Value::String(value.to_rfc3339()))
            .unwrap_or(Value::Null),
        "BYTEA" => row
            .try_get::<Option<Vec<u8>>, _>(index)
            .ok()
            .flatten()
            .map(|bytes| Value::String(encode_hex(&bytes)))
            .unwrap_or(Value::Null),
        "TEXT" | "VARCHAR" | "BPCHAR" | "NAME" | "CHAR" => row
            .try_get::<Option<String>, _>(index)
            .ok()
            .flatten()
            .map(Value::String)
            .unwrap_or(Value::Null),
        _ => row
            .try_get::<Option<String>, _>(index)
            .ok()
            .flatten()
            .map(Value::String)
            .unwrap_or_else(|| json!(format!("<unsupported: {type_name}>"))),
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
    use super::returns_rows;

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