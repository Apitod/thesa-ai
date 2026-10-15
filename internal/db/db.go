package db

import (
	_ "embed"
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"
)

//go:embed schema.sql
var embeddedSchemaSQL string

// DB is the global database connection pool.
var DB *sqlx.DB

// Init initialises the database connection with retry backoff and auto-migration.
func Init() error {
	dsn := getDSN()
	if dsn == "" {
		return fmt.Errorf("no database connection string provided (MYSQL_DSN or DATABASE_URL is empty)")
	}

	maxRetries := 5
	retryDelay := 2 * time.Second

	var err error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		log.Printf("[Thesa DB] Attempting database connection (%d/%d)...", attempt, maxRetries)
		DB, err = sqlx.Connect("mysql", dsn)
		if err == nil {
			if pingErr := DB.Ping(); pingErr == nil {
				log.Println("[Thesa DB] Database connection established successfully.")
				break
			} else {
				err = pingErr
			}
		}

		log.Printf("[Thesa DB] Connection attempt %d failed: %v", attempt, err)
		if attempt < maxRetries {
			time.Sleep(retryDelay)
			retryDelay *= 2 // Exponential backoff
		}
	}

	if err != nil {
		return fmt.Errorf("could not connect to database after %d attempts: %w", maxRetries, err)
	}

	// Configure connection pool for production high-concurrency
	DB.SetMaxOpenConns(25)
	DB.SetMaxIdleConns(10)
	DB.SetConnMaxLifetime(5 * time.Minute)
	DB.SetConnMaxIdleTime(2 * time.Minute)

	// Run auto-migration
	if err := AutoMigrate(); err != nil {
		log.Printf("[Thesa DB] Warning: Auto-migration encountered an error: %v", err)
	} else {
		log.Println("[Thesa DB] Auto-migration completed successfully.")
	}

	return nil
}

// AutoMigrate runs the embedded schema.sql against the database.
func AutoMigrate() error {
	if DB == nil {
		return fmt.Errorf("cannot migrate: database connection is nil")
	}

	// Split schema by statement delimiter (semicolon + newline)
	statements := strings.Split(embeddedSchemaSQL, ";\n")
	for _, rawStmt := range statements {
		stmt := strings.TrimSpace(rawStmt)
		if stmt == "" || strings.HasPrefix(stmt, "--") && !strings.Contains(stmt, "\n") {
			continue
		}

		if _, err := DB.Exec(stmt); err != nil {
			// Log error but continue for idempotent resilience
			log.Printf("[Thesa DB Migration] Error executing statement: %v | Stmt: %s", err, truncate(stmt, 80))
		}
	}
	// MySQL 8.0 does not support ADD COLUMN IF NOT EXISTS on all supported
	// versions. Check metadata first so existing installations upgrade safely.
	if err := ensureColumn("users", "silver_balance", "DECIMAL(12,2) NOT NULL DEFAULT 0.00"); err != nil {
		return fmt.Errorf("ensure users.silver_balance: %w", err)
	}

	return nil
}

func ensureColumn(table, column, definition string) error {
	var exists int
	err := DB.Get(&exists, `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, table, column)
	if err != nil {
		return err
	}
	if exists > 0 {
		return nil
	}
	_, err = DB.Exec("ALTER TABLE `" + table + "` ADD COLUMN `" + column + "` " + definition)
	return err
}

// getDSN resolves and formats MySQL DSN from various environment variables.
func getDSN() string {
	dsn := os.Getenv("MYSQL_DSN")
	if dsn != "" {
		return dsn
	}

	rawURL := os.Getenv("DATABASE_URL")
	if rawURL != "" {
		// Convert mysql://user:pass@host:port/dbname?params to MySQL driver format
		converted, err := convertDatabaseURL(rawURL)
		if err == nil {
			return converted
		}
		return rawURL
	}

	// Default fallback for container internal network or local
	dbHost := os.Getenv("DB_HOST")
	if dbHost == "" {
		dbHost = "127.0.0.1"
	}
	dbPort := os.Getenv("DB_PORT")
	if dbPort == "" {
		dbPort = "3306"
	}
	dbUser := os.Getenv("DB_USER")
	if dbUser == "" {
		dbUser = "root"
	}
	dbPass := os.Getenv("MYSQL_ROOT_PASSWORD")
	if dbPass == "" {
		dbPass = os.Getenv("DB_PASSWORD")
	}
	if dbPass == "" {
		dbPass = "thesapassword"
	}
	dbName := os.Getenv("DB_NAME")
	if dbName == "" {
		dbName = "risethub"
	}

	return fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&charset=utf8mb4&collation=utf8mb4_unicode_ci",
		dbUser, dbPass, dbHost, dbPort, dbName)
}

// convertDatabaseURL parses standard URI format into Go MySQL driver DSN format.
func convertDatabaseURL(raw string) (string, error) {
	if !strings.Contains(raw, "://") {
		return raw, nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return raw, err
	}

	user := u.User.Username()
	pass, _ := u.User.Password()
	host := u.Host
	db := strings.TrimPrefix(u.Path, "/")

	params := u.Query()
	if params.Get("parseTime") == "" {
		params.Set("parseTime", "true")
	}
	if params.Get("charset") == "" {
		params.Set("charset", "utf8mb4")
	}
	if params.Get("ssl") != "" || params.Get("sslaccept") != "" || strings.Contains(host, "tidbcloud.com") {
		if params.Get("tls") == "" {
			params.Set("tls", "true")
		}
		params.Del("ssl")
		params.Del("sslaccept")
	}

	return fmt.Sprintf("%s:%s@tcp(%s)/%s?%s", user, pass, host, db, params.Encode()), nil
}

// IsConnected returns whether the database connection is currently alive.
func IsConnected() bool {
	return DB != nil && DB.Ping() == nil
}

// Close closes the database connection pool.
func Close() error {
	if DB != nil {
		return DB.Close()
	}
	return nil
}

func truncate(s string, max int) string {
	clean := strings.ReplaceAll(s, "\n", " ")
	if len(clean) > max {
		return clean[:max] + "..."
	}
	return clean
}
