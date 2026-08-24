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

type GenerateQuestionsRequest struct {
	Document string `json:"document"`
}

type GenerateQuestionsResponse struct {
	Questions []agent.ExerciseQuestion `json:"questions,omitempty"`
	Error     string                   `json:"error,omitempty"`
}

type ReviewAnswerRequest struct {
	Question agent.ExerciseQuestion `json:"question"`
	Answer   string                 `json:"answer"`
}

type ReviewAnswerResponse struct {
	Feedback *agent.AnswerFeedback `json:"feedback,omitempty"`
	Error    string                `json:"error,omitempty"`
}

type SkillInsightsRequest struct {
	Answers []agent.AnswerFeedback `json:"answers"`
}

type SkillInsightsResponse struct {
	Insights *agent.SkillInsight `json:"insights,omitempty"`
	Error    string              `json:"error,omitempty"`
}

type SaveReflectionRequest struct {
	ProjectID  int    `json:"project_id"`
	Reflection string `json:"reflection"`
}

type SaveReflectionResponse struct {
	Status string `json:"status,omitempty"`
	Error  string `json:"error,omitempty"`
}

// ---------------------------------------------------------------------------
// ExerciseHandler
// ---------------------------------------------------------------------------

// ExerciseHandler handles HTTP requests for AI-powered academic exercises,
// including question generation, answer review, skill insights, and
// reflection persistence.
type ExerciseHandler struct {
	exercise   *agent.ExerciseAgent
	aiProvider agent.AIProvider
}

// NewExerciseHandler creates a new ExerciseHandler with the provided
// exercise agent and AI provider.
func NewExerciseHandler(e *agent.ExerciseAgent, provider agent.AIProvider) *ExerciseHandler {
	return &ExerciseHandler{
		exercise:   e,
		aiProvider: provider,
	}
}

// ---------------------------------------------------------------------------
// GenerateQuestions — POST /api/v1/exercise/questions
// ---------------------------------------------------------------------------

// GenerateQuestions generates 3-5 analytical/comparative/critical questions
// from an academic document to test understanding.
func (h *ExerciseHandler) GenerateQuestions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(GenerateQuestionsResponse{Error: "method not allowed"})
		return
	}

	var req GenerateQuestionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(GenerateQuestionsResponse{Error: "invalid request body"})
		return
	}

	if req.Document == "" {
		json.NewEncoder(w).Encode(GenerateQuestionsResponse{Error: "document is required"})
		return
	}

	config := h.defaultConfig()

	questions, err := h.exercise.GenerateQuestions(req.Document, config)
	if err != nil {
		log.Printf("GenerateQuestions: failed: %v", err)
		json.NewEncoder(w).Encode(GenerateQuestionsResponse{
			Error: fmt.Sprintf("gagal generate pertanyaan: %v", err),
		})
		return
	}

	json.NewEncoder(w).Encode(GenerateQuestionsResponse{Questions: questions})
}

// ---------------------------------------------------------------------------
// ReviewAnswer — POST /api/v1/exercise/review-answer
// ---------------------------------------------------------------------------

// ReviewAnswer evaluates a user's answer to an exercise question, returning
// a score, feedback, and understanding assessment.
func (h *ExerciseHandler) ReviewAnswer(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(ReviewAnswerResponse{Error: "method not allowed"})
		return
	}

	var req ReviewAnswerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(ReviewAnswerResponse{Error: "invalid request body"})
		return
	}

	if req.Answer == "" {
		json.NewEncoder(w).Encode(ReviewAnswerResponse{Error: "answer is required"})
		return
	}

	config := h.defaultConfig()

	feedback, err := h.exercise.ReviewAnswer(req.Question, req.Answer, config)
	if err != nil {
		log.Printf("ReviewAnswer: failed: %v", err)
		json.NewEncoder(w).Encode(ReviewAnswerResponse{
			Error: fmt.Sprintf("gagal mengevaluasi jawaban: %v", err),
		})
		return
	}

	json.NewEncoder(w).Encode(ReviewAnswerResponse{Feedback: feedback})
}

// ---------------------------------------------------------------------------
// SkillInsights — POST /api/v1/exercise/skill-insights
// ---------------------------------------------------------------------------

// SkillInsights analyzes a collection of answer feedbacks and returns
// identified strengths, areas for improvement, overall progress, and
// recommended focus.
func (h *ExerciseHandler) SkillInsights(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(SkillInsightsResponse{Error: "method not allowed"})
		return
	}

	var req SkillInsightsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(SkillInsightsResponse{Error: "invalid request body"})
		return
	}

	config := h.defaultConfig()

	insights, err := h.exercise.GenerateSkillInsights(req.Answers, config)
	if err != nil {
		log.Printf("SkillInsights: failed: %v", err)
		json.NewEncoder(w).Encode(SkillInsightsResponse{
			Error: fmt.Sprintf("gagal menganalisis skill: %v", err),
		})
		return
	}

	json.NewEncoder(w).Encode(SkillInsightsResponse{Insights: insights})
}

// ---------------------------------------------------------------------------
// SaveReflection — POST /api/v1/exercise/reflection
// ---------------------------------------------------------------------------

// SaveReflection persists a learner reflection entry to the database for
// the specified project.
func (h *ExerciseHandler) SaveReflection(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(SaveReflectionResponse{Error: "method not allowed"})
		return
	}

	var req SaveReflectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(SaveReflectionResponse{Error: "invalid request body"})
		return
	}

	if req.ProjectID <= 0 {
		json.NewEncoder(w).Encode(SaveReflectionResponse{Error: "project_id is required"})
		return
	}
	if req.Reflection == "" {
		json.NewEncoder(w).Encode(SaveReflectionResponse{Error: "reflection is required"})
		return
	}

	if err := h.exercise.SaveReflection(req.ProjectID, req.Reflection); err != nil {
		log.Printf("SaveReflection: failed: %v", err)
		json.NewEncoder(w).Encode(SaveReflectionResponse{
			Error: fmt.Sprintf("gagal menyimpan refleksi: %v", err),
		})
		return
	}

	json.NewEncoder(w).Encode(SaveReflectionResponse{Status: "saved"})
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// defaultConfig builds a ProviderConfig from the DEEPSEEK_API_KEY / DEEPSEEK_KEY env variable
// with sensible defaults for exercise AI calls.
func (h *ExerciseHandler) defaultConfig() agent.ProviderConfig {
	apiKey := os.Getenv("DEEPSEEK_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("DEEPSEEK_KEY")
	}
	return agent.ProviderConfig{
		Provider:  "deepseek",
		Model:     "deepseek-chat",
		APIKey:    apiKey,
		MaxTokens: 4096,
	}
}
