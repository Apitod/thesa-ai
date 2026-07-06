package db

import (
	"log"
	"os"

	"github.com/jmoiron/sqlx"
	_ "github.com/go-sql-driver/mysql"
)

// DB is the global database connection pool.
var DB *sqlx.DB

// Init initialises the database connection from environment variables.
func Init() error {
	dsn := os.Getenv("MYSQL_DSN")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		// Default DSN for local development
		dsn = "root:password@tcp(localhost:3306)/risethub?parseTime=true"
	}

	var err error
	DB, err = sqlx.Connect("mysql", dsn)
	if err != nil {
		return err
	}

	DB.SetMaxOpenConns(25)
	DB.SetMaxIdleConns(5)

	log.Println("Database connected")
	return nil
}

// Close closes the database connection pool.
func Close() error {
	if DB != nil {
		return DB.Close()
	}
	return nil
}
