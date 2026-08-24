package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"risethub_os/backend/internal/agent"
	"risethub_os/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

type GenerateOutlineRequest struct {
	ProjectID     int                  `json:"project_id"`
	TopicFocus    *agent.TopicFocus    `json:"topic_focus,omitempty"`
	GapSummary    string               `json:"gap_summary,omitempty"`
	JenisKTI      string               `json:"jenis_kti"`
	TemplateID    int                  `json:"template_id,omitempty"`
	TotalWords    int                  `json:"total_words,omitempty"`
}

type GenerateOutlineResponse struct {
	Outline      *agent.MappedOutline `json:"outline,omitempty"`
	SectionsCount int                 `json:"sections_count"`
	Error        string               `json:"error,omitempty"`
}

type EditSectionRequest struct {
	Outline     *agent.MappedOutline `json:"outline"`
	SectionID   int                  `json:"section_id"`
	Instruction string               `json:"instruction"`
}

type EditSectionResponse struct {
	Outline *agent.MappedOutline `json:"outline,omitempty"`
	Error   string               `json:"error,omitempty"`
}

type SetWordTargetRequest struct {
	Outline    *agent.MappedOutline `json:"outline"`
	TotalWords int                  `json:"total_words"`
}

type SetWordTargetResponse struct {
	Outline *agent.MappedOutline `json:"outline,omitempty"`
	Error   string               `json:"error,omitempty"`
}

// ---------------------------------------------------------------------------
// OutlineHandler
// ---------------------------------------------------------------------------

// OutlineHandler handles HTTP requests for AI-powered outline generation,
// editing, word targeting, and persistence.
type OutlineHandler struct {
	generator  *agent.OutlineGenerator
	aiProvider agent.AIProvider
}

// NewOutlineHandler creates a new OutlineHandler with the provided generator and provider.
func NewOutlineHandler(g *agent.OutlineGenerator, provider agent.AIProvider) *OutlineHandler {
	return &OutlineHandler{
		generator:  g,
		aiProvider: provider,
	}
}

// ---------------------------------------------------------------------------
// Generate — POST /api/v1/outline/generate
// ---------------------------------------------------------------------------

// Generate creates a new academic outline from topic context and gap analysis.
func (h *OutlineHandler) Generate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(GenerateOutlineResponse{Error: "method not allowed"})
		return
	}

	var req GenerateOutlineRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(GenerateOutlineResponse{Error: "invalid request body"})
		return
	}

	if req.JenisKTI == "" {
		json.NewEncoder(w).Encode(GenerateOutlineResponse{Error: "jenis_kti is required"})
		return
	}

	// Build topic focus — load from DB if project_id is given and topic_focus is empty
	topicFocus := req.TopicFocus
	gapSummary := req.GapSummary
	if topicFocus == nil || topicFocus.Topic == "" {
		if req.ProjectID > 0 {
			tf, gs := h.loadTopicAndGap(req.ProjectID)
			if tf != nil {
				topicFocus = tf
			}
			if gs != "" && gapSummary == "" {
				gapSummary = gs
			}
		}
	}

	if topicFocus == nil || topicFocus.Topic == "" {
		json.NewEncoder(w).Encode(GenerateOutlineResponse{Error: "topic_focus.topic is required (or provide project_id to load from DB)"})
		return
	}

	// Load template structure if template_id is provided
	var templateStructure *agent.TemplateStructure
	if req.TemplateID > 0 {
		ts, err := h.loadTemplateStructure(req.TemplateID)
		if err != nil {
			log.Printf("Generate: load template structure failed: %v", err)
			// Non-fatal: proceed without template
		} else {
			templateStructure = ts
		}
	}

	config := h.defaultConfig()

	outline, err := h.generator.GenerateOutline(*topicFocus, gapSummary, req.JenisKTI, templateStructure, config)
	if err != nil {
		log.Printf("Generate: GenerateOutline failed: %v", err)
		json.NewEncoder(w).Encode(GenerateOutlineResponse{Error: fmt.Sprintf("gagal generate outline: %v", err)})
		return
	}

	// Optionally set word targets
	if req.TotalWords > 0 {
		outline, err = h.generator.SetTargetWords(outline, req.TotalWords, config)
		if err != nil {
			log.Printf("Generate: SetTargetWords failed: %v", err)
			// Non-fatal: return outline without word targets
		}
	}

	// Optionally save to DB
	if req.ProjectID > 0 {
		err = h.generator.SaveOutline(req.ProjectID, outline)
		if err != nil {
			log.Printf("Generate: SaveOutline failed: %v", err)
			// Non-fatal: still return the outline
		}
	}

	sectionsCount := countMappedSections(outline.Sections)

	json.NewEncoder(w).Encode(GenerateOutlineResponse{
		Outline:       outline,
		SectionsCount: sectionsCount,
	})
}

// ---------------------------------------------------------------------------
// EditSection — POST /api/v1/outline/edit
// ---------------------------------------------------------------------------

// EditSection modifies a specific section in an existing outline based on a
// natural language instruction.
func (h *OutlineHandler) EditSection(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(EditSectionResponse{Error: "method not allowed"})
		return
	}

	var req EditSectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(EditSectionResponse{Error: "invalid request body"})
		return
	}

	if req.Outline == nil {
		json.NewEncoder(w).Encode(EditSectionResponse{Error: "outline is required"})
		return
	}
	if req.SectionID <= 0 {
		json.NewEncoder(w).Encode(EditSectionResponse{Error: "section_id is required"})
		return
	}
	if req.Instruction == "" {
		json.NewEncoder(w).Encode(EditSectionResponse{Error: "instruction is required"})
		return
	}

	config := h.defaultConfig()

	updated, err := h.generator.EditSection(req.Outline, req.SectionID, req.Instruction, config)
	if err != nil {
		log.Printf("EditSection: EditSection failed: %v", err)
		json.NewEncoder(w).Encode(EditSectionResponse{Error: fmt.Sprintf("gagal mengedit section: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(EditSectionResponse{Outline: updated})
}

// ---------------------------------------------------------------------------
// SetWordTarget — POST /api/v1/outline/word-target
// ---------------------------------------------------------------------------

// SetWordTarget distributes a total word count proportionally across all
// outline sections.
func (h *OutlineHandler) SetWordTarget(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(SetWordTargetResponse{Error: "method not allowed"})
		return
	}

	var req SetWordTargetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(SetWordTargetResponse{Error: "invalid request body"})
		return
	}

	if req.Outline == nil {
		json.NewEncoder(w).Encode(SetWordTargetResponse{Error: "outline is required"})
		return
	}
	if req.TotalWords <= 0 {
		json.NewEncoder(w).Encode(SetWordTargetResponse{Error: "total_words must be greater than 0"})
		return
	}

	config := h.defaultConfig()

	updated, err := h.generator.SetTargetWords(req.Outline, req.TotalWords, config)
	if err != nil {
		log.Printf("SetWordTarget: SetTargetWords failed: %v", err)
		json.NewEncoder(w).Encode(SetWordTargetResponse{Error: fmt.Sprintf("gagal mengatur target kata: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(SetWordTargetResponse{Outline: updated})
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// defaultConfig builds a ProviderConfig from environment variables with sensible defaults.
func (h *OutlineHandler) defaultConfig() agent.ProviderConfig {
	apiKey := os.Getenv("DEEPSEEK_API_KEY")
	return agent.ProviderConfig{
		Provider:  "deepseek",
		Model:     "deepseek-chat",
		APIKey:    apiKey,
		MaxTokens: 4096,
	}
}

// loadTopicAndGap retrieves topic and gap summary from the database for a project.
func (h *OutlineHandler) loadTopicAndGap(projectID int) (*agent.TopicFocus, string) {
	if db.DB == nil || !db.IsConnected() {
		return nil, ""
	}

	var topic string
	err := db.DB.Get(&topic, "SELECT topic FROM research_topics WHERE project_id = ? LIMIT 1", projectID)
	if err != nil {
		log.Printf("loadTopicAndGap: failed to load topic for project %d: %v", projectID, err)
		// Try an alternative: check thesa_projects table
		var projTopic string
		err2 := db.DB.Get(&projTopic, "SELECT topic FROM thesa_projects WHERE id = ?", projectID)
		if err2 != nil {
			return nil, ""
		}
		topic = projTopic
	}

	if topic == "" {
		return nil, ""
	}

	// Try to load gap summary
	var gapSummary string
	err = db.DB.Get(&gapSummary, "SELECT gap_summary FROM thesa_gaps WHERE project_id = ? LIMIT 1", projectID)
	if err != nil {
		// Gap not found, that's okay
		gapSummary = ""
	}

	return &agent.TopicFocus{
		Topic: topic,
		Angle: topic, // Default angle is the topic itself
	}, gapSummary
}

// loadTemplateStructure loads a template structure from the database by ID.
func (h *OutlineHandler) loadTemplateStructure(templateID int) (*agent.TemplateStructure, error) {
	if db.DB == nil || !db.IsConnected() {
		// Return standard default template structure if database is offline
		return &agent.TemplateStructure{
			Source: "default",
			Sections: []agent.TemplateSection{
				{Label: "Bab 1", Title: "PENDAHULUAN", Description: "Latar Belakang, Rumusan Masalah, Tujuan", Required: true},
				{Label: "Bab 2", Title: "TINJAUAN PUSTAKA", Description: "Landasan Teori & Penelitian Terdahulu", Required: true},
				{Label: "Bab 3", Title: "METODOLOGI PENELITIAN", Description: "Desain, Sumber Data & Analisis", Required: true},
				{Label: "Bab 4", Title: "HASIL DAN PEMBAHASAN", Description: "Hasil Analisis & Diskusi Akademik", Required: true},
				{Label: "Bab 5", Title: "KESIMPULAN DAN SARAN", Description: "Kesimpulan & Rekomendasi", Required: true},
			},
		}, nil
	}

	// First try to get from thesa_templates
	var templateData string
	err := db.DB.Get(&templateData, "SELECT structure_data FROM thesa_templates WHERE id = ?", templateID)
	if err != nil {
		// Fallback: try thesis_templates table
		err = db.DB.Get(&templateData, "SELECT structure_data FROM thesis_templates WHERE id = ?", templateID)
		if err != nil {
			return nil, fmt.Errorf("template not found: %w", err)
		}
	}

	if templateData == "" {
		return nil, fmt.Errorf("template data is empty")
	}

	var ts agent.TemplateStructure
	if err := json.Unmarshal([]byte(templateData), &ts); err != nil {
		return nil, fmt.Errorf("failed to parse template structure: %w", err)
	}

	return &ts, nil
}

// countMappedSections recursively counts all sections in a MappedOutline.
func countMappedSections(sections []agent.OutlineSection) int {
	count := 0
	for _, s := range sections {
		count++
		if len(s.Subsections) > 0 {
			count += countMappedSections(s.Subsections)
		}
	}
	return count
}
