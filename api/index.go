package handler

import (
	"net/http"
	"sync"

	"risethub_os/backend/internal/app"
)

var (
	apiHandler http.Handler
	initOnce   sync.Once
)

// Handler is the Vercel Serverless Function entrypoint.
func Handler(w http.ResponseWriter, r *http.Request) {
	initOnce.Do(func() {
		app.EnsureDB()
		apiHandler = app.NewHandler(false)
	})

	apiHandler.ServeHTTP(w, r)
}
