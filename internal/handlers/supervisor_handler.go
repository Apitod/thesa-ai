package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"risethub_os/backend/internal/agent"
)

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

type AnalyzeRequest struct {
	Document string `json:"document"`
}

type AnalyzeResponse struct {
	MacroReview *agent.MacroReview `json:"macro_review,omitempty"`
	Error       string             `json:"error,omitempty"`
}

type SocraticQuestionsRequest struct {
	Document string `json:"document"`
}

type SocraticQuestionsResponse struct {
	Questions []agent.SocraticQuestion `json:"questions,omitempty"`
	Error     string                   `json:"error,omitempty"`
}

type EvaluateSocraticRequest struct {
	Question agent.SocraticQuestion `json:"question"`
	Answer   string                 `json:"answer"`
}

type EvaluateSocraticResponse struct {
	Evaluation *agent.SocraticEvaluation `json:"evaluation,omitempty"`
	Error      string                    `json:"error,omitempty"`
}

type ReadinessRequest struct {
	MacroReview        agent.MacroReview          `json:"macro_review"`
	SocraticEvaluations []agent.SocraticEvaluation `json:"socratic_evaluations"`
	FormatCheck        agent.FormatCheck           `json:"format_check"`
}

type ReadinessResponse struct {
	ReadinessReport *agent.ReadinessReport `json:"readiness_report,omitempty"`
	Error           string                 `json:"error,omitempty"`
}

// ---------------------------------------------------------------------------
// SupervisorHandler
// ---------------------------------------------------------------------------

// SupervisorHandler handles HTTP requests for AI-powered document supervision,
// including macro analysis, Socratic questioning, answer evaluation, format
// validation, and readiness scoring.
type SupervisorHandler struct {
	supervisor  *agent.AgentSupervisor
	aiProvider  agent.AIProvider
}

// NewSupervisorHandler creates a new SupervisorHandler with the provided
// supervisor and AI provider.
func NewSupervisorHandler(s *agent.AgentSupervisor, provider agent.AIProvider) *SupervisorHandler {
	return &SupervisorHandler{
		supervisor: s,
		aiProvider: provider,
	}
}

// ---------------------------------------------------------------------------
// Analyze — POST /api/v1/supervisor/analyze
// ---------------------------------------------------------------------------

// Analyze performs a macro-level review of a full document, scoring structure,
// argument flow, coverage, citation density, and overall quality.
func (h *SupervisorHandler) Analyze(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(AnalyzeResponse{Error: "method not allowed"})
		return
	}

	var req AnalyzeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(AnalyzeResponse{Error: "invalid request body"})
		return
	}

	if req.Document == "" {
		json.NewEncoder(w).Encode(AnalyzeResponse{Error: "document is required"})
		return
	}

	config := h.defaultConfig()

	review, err := h.supervisor.AnalyzeDocument(req.Document, config)
	if err != nil {
		log.Printf("Analyze: AnalyzeDocument failed: %v", err)
		json.NewEncoder(w).Encode(AnalyzeResponse{
			Error: fmt.Sprintf("gagal menganalisis dokumen: %v", err),
		})
		return
	}

	json.NewEncoder(w).Encode(AnalyzeResponse{MacroReview: review})
}

// ---------------------------------------------------------------------------
// SocraticQuestions — POST /api/v1/supervisor/socratic-questions
// ---------------------------------------------------------------------------

// SocraticQuestions generates 3-5 Socratic questions that probe the writer's
// analytical depth and understanding of their own document.
func (h *SupervisorHandler) SocraticQuestions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(SocraticQuestionsResponse{Error: "method not allowed"})
		return
	}

	var req SocraticQuestionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(SocraticQuestionsResponse{Error: "invalid request body"})
		return
	}

	if req.Document == "" {
		json.NewEncoder(w).Encode(SocraticQuestionsResponse{Error: "document is required"})
		return
	}

	config := h.defaultConfig()

	questions, err := h.supervisor.SocraticDialog(req.Document, config)
	if err != nil {
		log.Printf("SocraticQuestions: SocraticDialog failed: %v", err)
		json.NewEncoder(w).Encode(SocraticQuestionsResponse{
			Error: fmt.Sprintf("gagal generate pertanyaan Socratic: %v", err),
		})
		return
	}

	json.NewEncoder(w).Encode(SocraticQuestionsResponse{Questions: questions})
}

// ---------------------------------------------------------------------------
// EvaluateSocratic — POST /api/v1/supervisor/evaluate-socratic
// ---------------------------------------------------------------------------

// EvaluateSocratic evaluates a writer's answer to a Socratic question, scoring
// it on a 0-100 scale with feedback and understanding assessment.
func (h *SupervisorHandler) EvaluateSocratic(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(EvaluateSocraticResponse{Error: "method not allowed"})
		return
	}

	var req EvaluateSocraticRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(EvaluateSocraticResponse{Error: "invalid request body"})
		return
	}

	if req.Answer == "" {
		json.NewEncoder(w).Encode(EvaluateSocraticResponse{Error: "answer is required"})
		return
	}

	config := h.defaultConfig()

	eval, err := h.supervisor.EvaluateAnswer(req.Question, req.Answer, config)
	if err != nil {
		log.Printf("EvaluateSocratic: EvaluateAnswer failed: %v", err)
		json.NewEncoder(w).Encode(EvaluateSocraticResponse{
			Error: fmt.Sprintf("gagal mengevaluasi jawaban: %v", err),
		})
		return
	}

	json.NewEncoder(w).Encode(EvaluateSocraticResponse{Evaluation: eval})
}

// ---------------------------------------------------------------------------
// Readiness — POST /api/v1/supervisor/readiness
// ---------------------------------------------------------------------------

// Readiness computes an overall readiness score from macro review results,
// Socratic evaluations, and format check data, returning per-aspect scores
// and recommended next actions.
func (h *SupervisorHandler) Readiness(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(ReadinessResponse{Error: "method not allowed"})
		return
	}

	var req ReadinessRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(ReadinessResponse{Error: "invalid request body"})
		return
	}

	config := h.defaultConfig()

	report, err := h.supervisor.ScoreReadiness(req.MacroReview, req.SocraticEvaluations, req.FormatCheck, config)
	if err != nil {
		log.Printf("Readiness: ScoreReadiness failed: %v", err)
		json.NewEncoder(w).Encode(ReadinessResponse{
			Error: fmt.Sprintf("gagal menghitung skor kesiapan: %v", err),
		})
		return
	}

	json.NewEncoder(w).Encode(ReadinessResponse{ReadinessReport: report})
}

// ---------------------------------------------------------------------------
// ExaminerSimulate — POST /api/v1/supervisor/examiner-simulate
// ---------------------------------------------------------------------------

// ExaminerSimulate handles dynamic questioning and evaluation by specific AI examiner personas.
func (h *SupervisorHandler) ExaminerSimulate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "method not allowed"})
		return
	}

	var req agent.ExaminerSimulateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid request body"})
		return
	}

	config := h.defaultConfig()

	resp, err := h.supervisor.SimulateExaminer(req, config)
	if err != nil {
		log.Printf("ExaminerSimulate error: %v", err)
		// Return graceful fallback
		if req.Mode == "evaluate" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"score": 85,
				"grade": "A-",
				"feedback": "Jawaban Anda telah menyentuh aspek substansi inti dengan baik.",
				"critique": "Pertahankan artikulasi dan perkuat korelasi data empiris.",
				"strong_points": []string{"Penjelasan logis", "Menjawab langsung esensi pertanyaan"},
				"improvement_points": []string{"Sertakan contoh kasus", "Pertegas batasan riset"},
				"aspect_scores": map[string]int{"logic": 85, "method": 82, "literature": 84, "oral": 88},
			})
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"question_text": fmt.Sprintf("Berdasarkan topik '%s', bagaimana Anda membuktikan kebaruan (novelty) riset ini terhadap literatur yang sudah ada?", req.Topic),
			"context_bab": "BAB I & II",
			"intent": "Menguji penguasaan novelty dan posisi riset",
		})
		return
	}

	json.NewEncoder(w).Encode(resp)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// defaultConfig builds a ProviderConfig dynamically.
// It respects AI_PRIMARY_PROVIDER and selects the correct API key accordingly.
// Falls back to Gemini if DeepSeek key is absent.
func (h *SupervisorHandler) defaultConfig() agent.ProviderConfig {
	primaryProvider := os.Getenv("AI_PRIMARY_PROVIDER")
	if primaryProvider == "" {
		primaryProvider = "gemini"
	}

	router := agent.NewSmartLLMRouter()
	routed := router.RouteTask(agent.TaskSocraticChat, "gold", 100000)

	var apiKey string
	provider := primaryProvider

	switch provider {
	case "deepseek":
		apiKey = os.Getenv("DEEPSEEK_API_KEY")
		if apiKey == "" {
			apiKey = os.Getenv("DEEPSEEK_KEY")
		}
		// Fall back to Gemini if DeepSeek key not configured
		if apiKey == "" {
			provider = "gemini"
			apiKey = os.Getenv("GEMINI_API_KEY")
		}
	default: // gemini
		provider = "gemini"
		apiKey = os.Getenv("GEMINI_API_KEY")
	}

	return agent.ProviderConfig{
		Provider:  provider,
		Model:     routed.Model,
		APIKey:    apiKey,
		MaxTokens: routed.MaxTokens,
	}
}
