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
// Internal helpers
// ---------------------------------------------------------------------------

// defaultConfig builds a ProviderConfig from the DEEPSEEK_KEY env variable
// with sensible defaults for supervisor AI calls.
func (h *SupervisorHandler) defaultConfig() agent.ProviderConfig {
	apiKey := os.Getenv("DEEPSEEK_KEY")
	if apiKey == "" {
		apiKey = "sk-b8a1a9a1f42a4207a0e775d9dcc26b53"
	}
	return agent.ProviderConfig{
		Provider:  "deepseek",
		Model:     "deepseek-chat",
		APIKey:    apiKey,
		MaxTokens: 4096,
	}
}
