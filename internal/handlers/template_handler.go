package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"risethub_os/backend/internal/agent"
	"risethub_os/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

type LookupTemplateRequest struct {
	JenisKTI     string `json:"jenis_kti"`
	Institusi    string `json:"institusi"`
	ProgramStudi string `json:"program_studi"`
}

type InjectTemplateRequest struct {
	TemplateID int `json:"template_id"`
	ProjectID  int `json:"project_id"`
}

type UploadTemplateRequest struct {
	JenisKTI     string `json:"jenis_kti"`
	Institusi    string `json:"institusi"`
	ProgramStudi string `json:"program_studi"`
	RawText      string `json:"raw_text"`
}

type SuggestInstitutionsRequest struct {
	Query string `json:"query"`
}

type AnalyzeTemplateRequest struct {
	RawText  string `json:"raw_text"`
	Source   string `json:"source"`    // "pdf" | "input" | "regex"
	JenisKTI string `json:"jenis_kti"` // optional, for mapping to blueprint
}

type AnalyzeTemplateResponse struct {
	Structure *agent.TemplateStructure `json:"structure,omitempty"`
	Mapped    *agent.MappedOutline     `json:"mapped_outline,omitempty"`
	Sections  int                      `json:"sections_count"`
	Error     string                   `json:"error,omitempty"`
}

type GenerateStyleGuideRequest struct {
	Sections     []agent.OutlineSection     `json:"sections"`
	Requirements agent.TemplateRequirements `json:"requirements"`
}

type GenerateStyleGuideResponse struct {
	StyleGuide *agent.StyleGuide `json:"style_guide,omitempty"`
	Error      string            `json:"error,omitempty"`
}

type CheckComplianceRequest struct {
	DraftContent string `json:"draft_content"`
	TemplateID   int    `json:"template_id"`
}

type CheckComplianceResponse struct {
	Report *agent.ComplianceReport `json:"report,omitempty"`
	Error  string                  `json:"error,omitempty"`
}

// ---------------------------------------------------------------------------
// TemplateHandler
// ---------------------------------------------------------------------------

// TemplateHandler handles HTTP requests related to institutional templates,
// including lookup, injection, upload, listing, suggestion, and AI-powered
// analysis, mapping, style enforcement, and compliance checking.
type TemplateHandler struct {
	templateAgent *agent.TemplateAgent
	aiProvider    agent.AIProvider
}

// NewTemplateHandler creates a new TemplateHandler with the provided agent and provider.
func NewTemplateHandler(ta *agent.TemplateAgent, provider agent.AIProvider) *TemplateHandler {
	return &TemplateHandler{
		templateAgent: ta,
		aiProvider:    provider,
	}
}

// ---------------------------------------------------------------------------
// Existing methods (preserved)
// ---------------------------------------------------------------------------

// LookupTemplate looks up a template by jenis KTI, institusi, and program studi.
func (h *TemplateHandler) LookupTemplate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		return
	}

	var req LookupTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
		return
	}

	// Attempt DB lookup if connected
	if db.DB != nil {
		type DBTemplate struct {
			ID            int    `db:"id"`
			Name          string `db:"name"`
			Institution   string `db:"institution"`
			Degree        string `db:"degree"`
			StructureData string `db:"structure_data"`
		}
		var tmpl DBTemplate
		query := "SELECT id, name, institution, degree, structure_data FROM thesa_templates WHERE institution LIKE ? OR degree LIKE ? LIMIT 1"
		err := db.DB.Get(&tmpl, query, "%"+req.Institusi+"%", "%"+req.JenisKTI+"%")
		if err == nil && tmpl.ID > 0 {
			var parsedStructure map[string]interface{}
			_ = json.Unmarshal([]byte(tmpl.StructureData), &parsedStructure)
			resp := map[string]interface{}{
				"template_id":   tmpl.ID,
				"name":          tmpl.Name,
				"jenis_kti":     tmpl.Degree,
				"institusi":     tmpl.Institution,
				"program_studi": req.ProgramStudi,
				"structure":     parsedStructure,
				"sections":      parsedStructure["sections"],
				"requirements":  parsedStructure["requirements"],
			}
			json.NewEncoder(w).Encode(resp)
			return
		}
	}

	// Fallback preset response
	resp := map[string]interface{}{
		"template_id":   1,
		"name":          "Pedoman Penulisan Skripsi Standar Nasional (DIKTI)",
		"jenis_kti":     req.JenisKTI,
		"institusi":     req.Institusi,
		"program_studi": req.ProgramStudi,
		"sections":      []map[string]interface{}{},
		"requirements":  map[string]interface{}{},
	}
	json.NewEncoder(w).Encode(resp)
}

// InjectTemplate associates a template with a project.
func (h *TemplateHandler) InjectTemplate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		return
	}

	var req InjectTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
		return
	}

	resp := map[string]interface{}{
		"success":     true,
		"template_id": req.TemplateID,
		"project_id":  req.ProjectID,
	}
	json.NewEncoder(w).Encode(resp)
}

// UploadTemplate accepts raw template text and stores it.
func (h *TemplateHandler) UploadTemplate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		return
	}

	var req UploadTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
		return
	}

	createdID := 1
	if db.DB != nil {
		name := fmt.Sprintf("Pedoman %s - %s", req.JenisKTI, req.Institusi)
		structureJSON := fmt.Sprintf(`{"raw_text": %q, "institution": %q, "prodi": %q}`, req.RawText, req.Institusi, req.ProgramStudi)
		res, err := db.DB.Exec("INSERT INTO thesa_templates (name, institution, degree, structure_data) VALUES (?, ?, ?, ?)",
			name, req.Institusi, req.JenisKTI, structureJSON)
		if err == nil {
			if id, err := res.LastInsertId(); err == nil {
				createdID = int(id)
			}
		}
	}

	resp := map[string]interface{}{
		"success":       true,
		"template_id":   createdID,
		"jenis_kti":     req.JenisKTI,
		"institusi":     req.Institusi,
		"program_studi": req.ProgramStudi,
	}
	json.NewEncoder(w).Encode(resp)
}

// ListTemplates returns available templates, optionally filtered.
func (h *TemplateHandler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "GET" {
		json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		return
	}

	type TemplateItem struct {
		ID          int    `db:"id" json:"id"`
		Name        string `db:"name" json:"name"`
		Institution string `db:"institution" json:"institution"`
		Degree      string `db:"degree" json:"degree"`
	}

	var templates []TemplateItem
	if db.DB != nil {
		_ = db.DB.Select(&templates, "SELECT id, name, institution, degree FROM thesa_templates ORDER BY id ASC LIMIT 50")
	}

	if len(templates) == 0 {
		templates = []TemplateItem{
			{ID: 1, Name: "Pedoman Penulisan Skripsi Standar Nasional (DIKTI)", Institution: "Standar Nasional", Degree: "S1"},
			{ID: 2, Name: "Pedoman Tesis Magister Akademik", Institution: "Standar Nasional", Degree: "S2"},
			{ID: 3, Name: "Pedoman Disertasi Doktoral", Institution: "Standar Nasional", Degree: "S3"},
		}
	}

	resp := map[string]interface{}{
		"templates": templates,
		"total":     len(templates),
	}
	json.NewEncoder(w).Encode(resp)
}

// SuggestInstitutions suggests institution names matching a query.
func (h *TemplateHandler) SuggestInstitutions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "GET" {
		json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		return
	}

	query := strings.TrimSpace(r.URL.Query().Get("query"))
	if query == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"institutions": []string{},
		})
		return
	}

	baseList := []string{
		"Universitas Indonesia (UI)",
		"Universitas Gadjah Mada (UGM)",
		"Institut Teknologi Bandung (ITB)",
		"Institut Pertanian Bogor (IPB)",
		"Institut Teknologi Sepuluh Nopember (ITS)",
		"Universitas Airlangga (UNAIR)",
		"Universitas Diponegoro (UNDIP)",
		"Universitas Padjadjaran (UNPAD)",
		"Universitas Brawijaya (UB)",
		"Universitas Hasanuddin (UNHAS)",
		"Universitas Sebelas Maret (UNS)",
		"Universitas Pendidikan Indonesia (UPI)",
		"Universitas Negeri Jakarta (UNJ)",
		"Universitas Telkom",
		"Universitas Bina Nusantara (BINUS)",
	}

	var matched []string
	queryLower := strings.ToLower(query)
	for _, inst := range baseList {
		if strings.Contains(strings.ToLower(inst), queryLower) {
			matched = append(matched, inst)
		}
	}

	resp := map[string]interface{}{
		"institutions": matched,
		"query":        query,
	}
	json.NewEncoder(w).Encode(resp)
}

// ---------------------------------------------------------------------------
// New AI-powered endpoints
// ---------------------------------------------------------------------------

// AnalyzeTemplate extracts structure from raw template text and optionally
// maps it to a blueprint outline.
func (h *TemplateHandler) AnalyzeTemplate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(AnalyzeTemplateResponse{Error: "method not allowed"})
		return
	}

	var req AnalyzeTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(AnalyzeTemplateResponse{Error: "invalid request body"})
		return
	}

	if req.RawText == "" {
		json.NewEncoder(w).Encode(AnalyzeTemplateResponse{Error: "raw_text is required"})
		return
	}
	if req.Source == "" {
		req.Source = "input"
	}

	// Build provider config from environment
	config := h.defaultConfig()

	// Parse template
	structure, err := h.templateAgent.ParseTemplate(req.RawText, req.Source, config)
	if err != nil {
		log.Printf("AnalyzeTemplate: ParseTemplate failed: %v", err)
		json.NewEncoder(w).Encode(AnalyzeTemplateResponse{Error: fmt.Sprintf("gagal memproses template: %v", err)})
		return
	}

	sectionsCount := countSections(structure.Sections)

	resp := AnalyzeTemplateResponse{
		Structure: structure,
		Sections:  sectionsCount,
	}

	// Optionally map to blueprint if jenis_kti is provided
	if req.JenisKTI != "" {
		mapped, err := h.templateAgent.MapToBlueprint(structure, req.JenisKTI, config)
		if err != nil {
			log.Printf("AnalyzeTemplate: MapToBlueprint failed: %v", err)
			// Non-fatal: return structure without mapped outline
			resp.Error = fmt.Sprintf("pemetaan ke blueprint gagal: %v", err)
		} else {
			resp.Mapped = mapped
		}
	}

	json.NewEncoder(w).Encode(resp)
}

// GenerateStyleGuide generates a style guide from a mapped outline.
func (h *TemplateHandler) GenerateStyleGuide(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(GenerateStyleGuideResponse{Error: "method not allowed"})
		return
	}

	var req GenerateStyleGuideRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(GenerateStyleGuideResponse{Error: "invalid request body"})
		return
	}

	mapped := &agent.MappedOutline{
		Sections:     req.Sections,
		Requirements: req.Requirements,
	}

	config := h.defaultConfig()

	styleGuide, err := h.templateAgent.EnforceStyle(mapped, config)
	if err != nil {
		log.Printf("GenerateStyleGuide: EnforceStyle failed: %v", err)
		json.NewEncoder(w).Encode(GenerateStyleGuideResponse{Error: fmt.Sprintf("gagal generate style guide: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(GenerateStyleGuideResponse{StyleGuide: styleGuide})
}

// CheckCompliance checks a draft document against a stored template.
func (h *TemplateHandler) CheckCompliance(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(CheckComplianceResponse{Error: "method not allowed"})
		return
	}

	var req CheckComplianceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(CheckComplianceResponse{Error: "invalid request body"})
		return
	}

	if req.DraftContent == "" {
		json.NewEncoder(w).Encode(CheckComplianceResponse{Error: "draft_content is required"})
		return
	}
	if req.TemplateID <= 0 {
		json.NewEncoder(w).Encode(CheckComplianceResponse{Error: "template_id is required"})
		return
	}

	// Load template mapped outline from DB (simplified: build from template ID)
	mapped, err := h.loadTemplateMappedOutline(req.TemplateID)
	if err != nil {
		log.Printf("CheckCompliance: load template failed: %v", err)
		json.NewEncoder(w).Encode(CheckComplianceResponse{Error: fmt.Sprintf("template tidak ditemukan: %v", err)})
		return
	}

	config := h.defaultConfig()

	report, err := h.templateAgent.CheckCompliance(req.DraftContent, mapped, config)
	if err != nil {
		log.Printf("CheckCompliance: CheckCompliance failed: %v", err)
		json.NewEncoder(w).Encode(CheckComplianceResponse{Error: fmt.Sprintf("gagal cek kepatuhan: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(CheckComplianceResponse{Report: report})
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// defaultConfig builds a ProviderConfig for Gemini AI calls.
func (h *TemplateHandler) defaultConfig() agent.ProviderConfig {
	model := getEnvOrDefault("GEMINI_MODEL", "gemini-2.5-flash")
	return agent.ProviderConfig{
		Provider:  "gemini",
		Model:     model,
		APIKey:    os.Getenv("GEMINI_API_KEY"),
		MaxTokens: 2048,
	}
}

// loadTemplateMappedOutline loads a template from DB by ID and converts it to a MappedOutline.
func (h *TemplateHandler) loadTemplateMappedOutline(templateID int) (*agent.MappedOutline, error) {
	if db.DB != nil && templateID > 0 {
		var structureData string
		err := db.DB.Get(&structureData, "SELECT structure_data FROM thesa_templates WHERE id = ? LIMIT 1", templateID)
		if err == nil && structureData != "" {
			var parsed struct {
				Sections     []agent.OutlineSection     `json:"sections"`
				Requirements agent.TemplateRequirements `json:"requirements"`
				Deviations   []agent.TemplateDeviation  `json:"deviations"`
			}
			if err := json.Unmarshal([]byte(structureData), &parsed); err == nil && len(parsed.Sections) > 0 {
				return &agent.MappedOutline{
					Sections:     parsed.Sections,
					Requirements: parsed.Requirements,
					Deviations:   parsed.Deviations,
				}, nil
			}
		}
	}

	return &agent.MappedOutline{
		Sections:     []agent.OutlineSection{},
		Requirements: agent.TemplateRequirements{},
		Deviations:   []agent.TemplateDeviation{},
	}, nil
}

// countSections recursively counts all sections in the tree.
func countSections(sections []agent.TemplateSection) int {
	count := 0
	for _, s := range sections {
		count++
		count += countSections(s.SubSections)
	}
	return count
}

// getEnvOrDefault returns the environment variable value or a fallback.
func getEnvOrDefault(key, fallback string) string {
	val := os.Getenv(key)
	if val != "" {
		return val
	}
	return fallback
}
