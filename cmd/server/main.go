package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"risethub_os/backend/internal/app"
	"risethub_os/backend/internal/db"
)

func main() {
	log.Println("[Thesa Backend] Starting Thesa AI Production Engine...")

	// Initialise database gracefully with auto-migration
	app.EnsureDB()
	defer db.Close()

	// Initialise all handlers, routes and static assets
	handler := app.NewHandler(true)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	serverErrors := make(chan error, 1)

	go func() {
		log.Printf("[Thesa Backend] Server live & listening on http://0.0.0.0:%s", port)
		serverErrors <- server.ListenAndServe()
	}()

	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-serverErrors:
		if err != nil && err != http.ErrServerClosed {
			log.Fatalf("[Thesa Backend] Server listener error: %v", err)
		}

	case sig := <-shutdown:
		log.Printf("[Thesa Backend] Signal %v received. Starting graceful shutdown...", sig)

		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		if err := server.Shutdown(ctx); err != nil {
			log.Printf("[Thesa Backend] Graceful shutdown timeout, forcing close: %v", err)
			server.Close()
		}

		log.Println("[Thesa Backend] Server gracefully stopped.")
	}
}
