package handlers

import (
	"encoding/json"
	"net/http"
	"os"

	"risethub_os/backend/internal/agent"
)

// ConversationHandler provides HTTP endpoints for real-time deliberative co-authoring
type ConversationHandler struct {
	supervisor    *agent.AgentSupervisor
	cascadeEngine *agent.CascadeEngine
}

// NewConversationHandler creates a new ConversationHandler
func NewConversationHandler(supervisor *agent.AgentSupervisor, cascadeEngine *agent.CascadeEngine) *ConversationHandler {
	return &ConversationHandler{
		supervisor:    supervisor,
		cascadeEngine: cascadeEngine,
	}
}

// Turn handles POST /api/v1/conversation/turn
func (h *ConversationHandler) Turn(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req agent.ConversationTurnRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	cfg := agent.ProviderConfig{
		APIKey:    os.Getenv("GEMINI_API_KEY"),
		Model:     os.Getenv("GEMINI_MODEL"),
		MaxTokens: 2000,
		Extra:     map[string]string{"temperature": "0.5"},
	}

	resp, err := h.supervisor.ExecuteConversationTurn(req, cfg)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "gemini_unavailable", "message": "Gemini belum dapat memproses revisi. Silakan coba lagi."})
		return
	}

	// Calculate cascade warnings if edit delta exists
	if req.EditDelta != nil && h.cascadeEngine != nil {
		stage := mapSectionToStage(req.EditDelta.Section)
		if stage != "" {
			impacts := h.cascadeEngine.CalculateCascade(req.ProjectID, stage)
			resp.CascadeWarnings = impacts
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// Recommend handles POST /api/v1/conversation/recommend
func (h *ConversationHandler) Recommend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req agent.ConversationTurnRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	recs := []agent.Recommendation{
		{
			ID:          "rec-empiris",
			Title:       "Validasi Data Empiris Lokal",
			Description: "Kaitkan masalah dengan data atau statistik primer terkini.",
			Rationale:   "Penguji skripsi sangat menyukai latar belakang yang bersumber dari data riil, bukan asumsi.",
			Icon:        "query_stats",
			Relevance:   "high",
			ActionType:  "inject_stats",
		},
		{
			ID:          "rec-gap",
			Title:       "Perjelas State-of-the-Art & Research Gap",
			Description: "Bandingkan pendekatan yang diusulkan dengan studi 3 tahun terakhir.",
			Rationale:   "Menjamin novelty dan orisinalitas naskah agar terhindar dari tudingan plagiarisme ide.",
			Icon:        "compare_arrows",
			Relevance:   "high",
			ActionType:  "highlight_gap",
		},
		{
			ID:          "rec-flow",
			Title:       "Penyelarasan Kohesi Paragraf",
			Description: "Gunakan kata transisi akademis antar-kalimat untuk aliran logika yang mulus.",
			Rationale:   "Meningkatkan skor keterbacaan (readability) dan profesionalitas naskah.",
			Icon:        "sync_alt",
			Relevance:   "medium",
			ActionType:  "improve_cohesion",
		},
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"recommendations": recs,
	})
}

func mapSectionToStage(section string) string {
	switch section {
	case "1.1", "1.2", "1.3", "section11", "section12", "section13":
		return "topic"
	case "section2", "bab2":
		return "literature"
	case "section3", "bab3":
		return "outline"
	default:
		return "writing"
	}
}
