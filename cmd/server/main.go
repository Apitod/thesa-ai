package main

import (
	"log"
	"net/http"

	"risethub_os/backend/internal/agent"
	"risethub_os/backend/internal/db"
	"risethub_os/backend/internal/handlers"
)

func main() {
	// Initialise database
	if err := db.Init(); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Initialise AI provider and agents
	litProvider := agent.NewDeepSeekProvider()
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

	// Register routes
	mux := http.NewServeMux()

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

	// Supervisor routes (Phase 5)
	mux.HandleFunc("/api/v1/supervisor/analyze", supervisorHandler.Analyze)
	mux.HandleFunc("/api/v1/supervisor/socratic-questions", supervisorHandler.SocraticQuestions)
	mux.HandleFunc("/api/v1/supervisor/evaluate-socratic", supervisorHandler.EvaluateSocratic)
	mux.HandleFunc("/api/v1/supervisor/readiness", supervisorHandler.Readiness)

	// Exercise Agent (Phase 6)
	exerciseAgent := agent.NewExerciseAgent(litProvider)
	exerciseHandler := handlers.NewExerciseHandler(exerciseAgent, litProvider)
	mux.HandleFunc("/api/v1/exercise/questions", authRateLimit(exerciseHandler.GenerateQuestions))
	mux.HandleFunc("/api/v1/exercise/review-answer", authRateLimit(exerciseHandler.ReviewAnswer))
	mux.HandleFunc("/api/v1/exercise/skill-insights", authRateLimit(exerciseHandler.SkillInsights))
	mux.HandleFunc("/api/v1/exercise/reflection", authRateLimitRBAC("project:update", exerciseHandler.SaveReflection))

	// Cascade Engine (Phase 7)
	cascadeHandler := handlers.NewCascadeHandler()
	mux.HandleFunc("/api/v1/cascade/state", authRateLimit(cascadeHandler.GetState))
	mux.HandleFunc("/api/v1/cascade/calculate", authRateLimit(cascadeHandler.Calculate))
	mux.HandleFunc("/api/v1/cascade/snapshot", authRateLimitRBAC("project:update", cascadeHandler.CreateSnapshot))
	mux.HandleFunc("/api/v1/cascade/snapshots", authRateLimit(cascadeHandler.ListSnapshots))
	mux.HandleFunc("/api/v1/cascade/snapshot/get", authRateLimit(cascadeHandler.GetSnapshot))
	mux.HandleFunc("/api/v1/cascade/restore", authRateLimit(cascadeHandler.RestoreSnapshot))
	mux.HandleFunc("/api/v1/cascade/diff", authRateLimit(cascadeHandler.GetDiff))
	mux.HandleFunc("/api/v1/cascade/execute", authRateLimitRBAC("project:update", cascadeHandler.Execute))
	mux.HandleFunc("/api/v1/cascade/log", authRateLimit(cascadeHandler.GetLog))

	// Health check
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	log.Println("Server starting on :8080")
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

// authRateLimit wraps an http.HandlerFunc with basic auth and rate limiting.
// Placeholder — replace with real middleware.
func authRateLimit(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		next(w, r)
	}
}

// authRateLimitRBAC wraps an http.HandlerFunc with auth, rate limiting, and
// role-based access control for the given permission.
// Placeholder — replace with real middleware.
func authRateLimitRBAC(permission string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		next(w, r)
	}
}
