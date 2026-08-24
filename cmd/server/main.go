package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"risethub_os/backend/internal/agent"
	"risethub_os/backend/internal/db"
	"risethub_os/backend/internal/handlers"
	"risethub_os/backend/internal/security"
)

var serverStartTime time.Time

// Simple in-memory rate limiter per IP
type ipRateLimiter struct {
	mu      sync.Mutex
	clients map[string]*clientBucket
}

type clientBucket struct {
	tokens     int
	lastRefill time.Time
}

var limiter = &ipRateLimiter{
	clients: make(map[string]*clientBucket),
}

func (l *ipRateLimiter) allow(ip string, maxTokens int, refillRate time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	b, exists := l.clients[ip]
	if !exists {
		l.clients[ip] = &clientBucket{tokens: maxTokens - 1, lastRefill: now}
		return true
	}

	// Refill tokens based on elapsed time
	elapsed := now.Sub(b.lastRefill)
	addedTokens := int(elapsed / refillRate)
	if addedTokens > 0 {
		b.tokens = min(maxTokens, b.tokens+addedTokens)
		b.lastRefill = now
	}

	if b.tokens > 0 {
		b.tokens--
		return true
	}
	return false
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Defense-in-depth Security Headers
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(self), geolocation=()")
		w.Header().Set("Content-Security-Policy", "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com https://fonts.gstatic.com https://api.dicebear.com data: blob:;")

		// Limit max request body size to 10MB to prevent memory exhaustion DoS
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
		}

		next.ServeHTTP(w, r)
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	allowedOrigins := os.Getenv("CORS_ALLOWED_ORIGINS")
	if allowedOrigins == "" {
		allowedOrigins = "*"
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if allowedOrigins == "*" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else {
			// Match configured origins
			matched := false
			for _, o := range strings.Split(allowedOrigins, ",") {
				if strings.TrimSpace(o) == origin {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					matched = true
					break
				}
			}
			if !matched && origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", strings.Split(allowedOrigins, ",")[0])
			}
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}


func main() {
	serverStartTime = time.Now()
	log.Println("[Thesa Backend] Starting Thesa AI Production Engine...")

	// Initialise database gracefully with auto-migration
	if err := db.Init(); err != nil {
		log.Printf("[Thesa Backend] Database not connected (%v). Running with in-memory / fallback mode.", err)
	} else {
		log.Println("[Thesa Backend] Database connection pool initialized successfully.")
		defer db.Close()
	}

	// Verify DeepSeek API Key configuration
	apiKey := os.Getenv("DEEPSEEK_API_KEY")
	if apiKey == "" {
		log.Println("[Thesa Backend] WARNING: DEEPSEEK_API_KEY environment variable is not set. AI capabilities will run in fallback mock mode.")
	} else {
		log.Println("[Thesa Backend] DEEPSEEK_API_KEY detected and configured.")
	}

	// Initialise Hybrid Multi-Provider (DeepSeek + Google Gemini with auto-failover)
	litProvider := agent.NewHybridProvider()
	litAgent := agent.NewLiteratureAgent(litProvider)
	tplAgent := agent.NewTemplateAgent(litProvider)

	// Initialise handlers
	gapHandler := handlers.NewGapAnalysisHandler(litAgent, litProvider)
	tplHandler := handlers.NewTemplateHandler(tplAgent, litProvider)
	outlineGen := agent.NewOutlineGenerator(litProvider)
	outlineHandler := handlers.NewOutlineHandler(outlineGen, litProvider)

	// Supervisor (Phase 5)
	supervisor := agent.NewAgentSupervisor(litProvider)
	supervisorHandler := handlers.NewSupervisorHandler(supervisor, litProvider)

	// Exercise Agent (Phase 6)
	exerciseAgent := agent.NewExerciseAgent(litProvider)
	exerciseHandler := handlers.NewExerciseHandler(exerciseAgent, litProvider)

	// Cascade Engine (Phase 7)
	cascadeHandler := handlers.NewCascadeHandler()

	// Auth Handler
	authHandler := handlers.NewAuthHandler()

	// Payment Handler (Midtrans & QRIS)
	paymentHandler := handlers.NewPaymentHandler()

	// Admin Handler (Controlling & Telemetry Dashboard)
	adminHandler := handlers.NewAdminHandler(serverStartTime)

	// Register routes
	mux := http.NewServeMux()

	// Auth routes
	mux.HandleFunc("/api/v1/auth/register", authHandler.Register)
	mux.HandleFunc("/api/v1/auth/login", authHandler.Login)
	mux.HandleFunc("/api/v1/auth/me", authHandler.Me)

	// Payment routes (Midtrans Snap, QRIS & Webhook)
	mux.HandleFunc("/api/v1/payment/create-order", authRateLimit(paymentHandler.CreateOrder))
	mux.HandleFunc("/api/v1/payment/webhook", paymentHandler.Webhook)
	mux.HandleFunc("/api/v1/payment/status", paymentHandler.GetStatus)
	mux.HandleFunc("/api/v1/payment/simulate", paymentHandler.SimulatePayment)

	// Admin Controlling routes (Surveillance & Metrics)
	mux.HandleFunc("/api/v1/admin/stats", security.RequireAdminAuth(adminHandler.GetDashboardStats))
	mux.HandleFunc("/api/v1/admin/users", security.RequireAdminAuth(adminHandler.ListUsers))
	mux.HandleFunc("/api/v1/admin/orders", security.RequireAdminAuth(adminHandler.ListOrders))
	mux.HandleFunc("/api/v1/admin/llm-telemetry", security.RequireAdminAuth(adminHandler.GetLLMTelemetry))
	mux.HandleFunc("/api/v1/admin/audit-logs", security.RequireAdminAuth(adminHandler.ListAuditLogs))
	mux.HandleFunc("/api/v1/admin/settle-order", security.RequireAdminAuth(adminHandler.ManualSettleOrder))

	// Literature routes
	mux.HandleFunc("/api/literature/gap-analysis", gapHandler.Analyze)

	// Template routes
	mux.HandleFunc("/api/v1/template/analyze", tplHandler.AnalyzeTemplate)
	mux.HandleFunc("/api/v1/template/style-guide", tplHandler.GenerateStyleGuide)
	mux.HandleFunc("/api/v1/template/compliance", tplHandler.CheckCompliance)
	mux.HandleFunc("/api/v1/template/lookup", tplHandler.LookupTemplate)
	mux.HandleFunc("/api/v1/template/inject", tplHandler.InjectTemplate)
	mux.HandleFunc("/api/v1/template/upload", tplHandler.UploadTemplate)
	mux.HandleFunc("/api/v1/template/list", tplHandler.ListTemplates)
	mux.HandleFunc("/api/v1/template/suggest-institutions", tplHandler.SuggestInstitutions)

	// Outline routes (Phase 3)
	mux.HandleFunc("/api/v1/outline/generate", outlineHandler.Generate)
	mux.HandleFunc("/api/v1/outline/edit", outlineHandler.EditSection)
	mux.HandleFunc("/api/v1/outline/word-target", outlineHandler.SetWordTarget)

	// Supervisor routes (Phase 5 & Viva Voce Simulator)
	mux.HandleFunc("/api/v1/supervisor/analyze", supervisorHandler.Analyze)
	mux.HandleFunc("/api/v1/supervisor/socratic-questions", supervisorHandler.SocraticQuestions)
	mux.HandleFunc("/api/v1/supervisor/evaluate-socratic", supervisorHandler.EvaluateSocratic)
	mux.HandleFunc("/api/v1/supervisor/readiness", supervisorHandler.Readiness)
	mux.HandleFunc("/api/v1/supervisor/examiner-simulate", authRateLimit(supervisorHandler.ExaminerSimulate))

	// Exercise routes (Phase 6)
	mux.HandleFunc("/api/v1/exercise/questions", authRateLimit(exerciseHandler.GenerateQuestions))
	mux.HandleFunc("/api/v1/exercise/review-answer", authRateLimit(exerciseHandler.ReviewAnswer))
	mux.HandleFunc("/api/v1/exercise/skill-insights", authRateLimit(exerciseHandler.SkillInsights))
	mux.HandleFunc("/api/v1/exercise/reflection", authRateLimitRBAC("project:update", exerciseHandler.SaveReflection))

	// Cascade routes (Phase 7)
	mux.HandleFunc("/api/v1/cascade/state", authRateLimit(cascadeHandler.GetState))
	mux.HandleFunc("/api/v1/cascade/calculate", authRateLimit(cascadeHandler.Calculate))
	mux.HandleFunc("/api/v1/cascade/snapshot", authRateLimitRBAC("project:update", cascadeHandler.CreateSnapshot))
	mux.HandleFunc("/api/v1/cascade/snapshots", authRateLimit(cascadeHandler.ListSnapshots))
	mux.HandleFunc("/api/v1/cascade/snapshot/get", authRateLimit(cascadeHandler.GetSnapshot))
	mux.HandleFunc("/api/v1/cascade/restore", authRateLimit(cascadeHandler.RestoreSnapshot))
	mux.HandleFunc("/api/v1/cascade/diff", authRateLimit(cascadeHandler.GetDiff))
	mux.HandleFunc("/api/v1/cascade/execute", authRateLimitRBAC("project:update", cascadeHandler.Execute))
	mux.HandleFunc("/api/v1/cascade/log", authRateLimit(cascadeHandler.GetLog))

	// Detailed Health & Diagnostics Check
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		dbConnected := db.IsConnected()
		status := "ok"
		if !dbConnected {
			status = "degraded"
		}

		primaryLLM := os.Getenv("AI_PRIMARY_PROVIDER")
		if primaryLLM == "" {
			primaryLLM = "deepseek"
		}

		response := map[string]interface{}{
			"status":              status,
			"app":                 "Thesa AI / Risethub BE",
			"version":             "1.0.0",
			"uptime_seconds":      int64(time.Since(serverStartTime).Seconds()),
			"timestamp":           time.Now().UTC().Format(time.RFC3339),
			"database_connected":  dbConnected,
			"primary_llm":         primaryLLM,
			"deepseek_configured": os.Getenv("DEEPSEEK_API_KEY") != "",
			"gemini_configured":   os.Getenv("GEMINI_API_KEY") != "",
			"payment_configured":  os.Getenv("MIDTRANS_SERVER_KEY") != "",
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(response)
	})

	// Static Web Frontend Server & Clean URL Rewrites
	webDir := "./web"
	if _, err := os.Stat(webDir); err == nil {
		mux.HandleFunc("/app", func(w http.ResponseWriter, r *http.Request) {
			http.ServeFile(w, r, filepath.Join(webDir, "app.html"))
		})
		mux.HandleFunc("/workspace", func(w http.ResponseWriter, r *http.Request) {
			http.ServeFile(w, r, filepath.Join(webDir, "app.html"))
		})
		mux.HandleFunc("/auth", func(w http.ResponseWriter, r *http.Request) {
			http.ServeFile(w, r, filepath.Join(webDir, "auth.html"))
		})
		mux.HandleFunc("/admin", func(w http.ResponseWriter, r *http.Request) {
			http.ServeFile(w, r, filepath.Join(webDir, "admin.html"))
		})
		fs := http.FileServer(http.Dir(webDir))
		mux.Handle("/", fs)
		log.Printf("[Thesa Backend] Serving static frontend from %s", webDir)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	handler := corsMiddleware(mux)

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Channel to listen for errors coming from the listener.
	serverErrors := make(chan error, 1)

	// Start server in goroutine
	go func() {
		log.Printf("[Thesa Backend] Server live & listening on http://0.0.0.0:%s", port)
		serverErrors <- server.ListenAndServe()
	}()

	// Channel to listen for OS interrupt / terminate signals
	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	// Blocking select waiting for either shutdown signal or listener error
	select {
	case err := <-serverErrors:
		if err != nil && err != http.ErrServerClosed {
			log.Fatalf("[Thesa Backend] Server listener error: %v", err)
		}

	case sig := <-shutdown:
		log.Printf("[Thesa Backend] Signal %v received. Starting graceful shutdown...", sig)

		// Context with 15-second timeout to allow in-flight requests to finish
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		if err := server.Shutdown(ctx); err != nil {
			log.Printf("[Thesa Backend] Graceful shutdown timeout, forcing close: %v", err)
			server.Close()
		}

		log.Println("[Thesa Backend] Server gracefully stopped.")
	}
}

// authRateLimit wraps an http.HandlerFunc with IP rate limiting and optional token inspection.
func authRateLimit(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clientIP := r.RemoteAddr
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			clientIP = strings.Split(xff, ",")[0]
		}

		// Rate limit: 60 tokens max, refill 1 token per second
		if !limiter.allow(clientIP, 60, time.Second) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":   "Rate limit exceeded",
				"message": "Terlalu banyak permintaan. Silakan tunggu beberapa saat.",
			})
			return
		}

		next(w, r)
	}
}

// authRateLimitRBAC wraps an http.HandlerFunc with auth, rate limiting, and role-based access control.
func authRateLimitRBAC(permission string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clientIP := r.RemoteAddr
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			clientIP = strings.Split(xff, ",")[0]
		}

		// Rate limit: 60 tokens max, refill 1 token per second
		if !limiter.allow(clientIP, 60, time.Second) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":   "Rate limit exceeded",
				"message": "Terlalu banyak permintaan. Silakan tunggu beberapa saat.",
			})
			return
		}

		// Check Authorization Header if present
		authHeader := r.Header.Get("Authorization")
		if authHeader != "" {
			parts := strings.Split(authHeader, " ")
			token := authHeader
			if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
				token = parts[1]
			}
			user, valid := handlers.ValidateUserSession(token)
			if valid && user != nil {
				// Attached user context if needed
				r.Header.Set("X-User-ID", fmt.Sprintf("%d", user.ID))
				r.Header.Set("X-User-Email", user.Email)
			}
		}

		next(w, r)
	}
}

