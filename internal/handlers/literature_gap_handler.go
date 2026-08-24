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

type GapAnalysisRequest struct {
	ProjectID int   `json:"project_id"`
	PaperIDs  []int `json:"paper_ids"`
}

type GapAnalysisResponse struct {
	Analysis        string   `json:"analysis"`
	Gaps            []string `json:"gaps"`
	Recommendations []string `json:"recommendations"`
	PapersAnalyzed  int      `json:"papers_analyzed"`
	Error           string   `json:"error,omitempty"`
}

type GapAnalysisHandler struct {
	litAgent  *agent.LiteratureAgent
	aiProvider agent.AIProvider
}

func NewGapAnalysisHandler(litAgent *agent.LiteratureAgent, provider agent.AIProvider) *GapAnalysisHandler {
	return &GapAnalysisHandler{
		litAgent:   litAgent,
		aiProvider: provider,
	}
}

func (h *GapAnalysisHandler) Analyze(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(GapAnalysisResponse{Error: "method not allowed"})
		return
	}

	var req GapAnalysisRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(GapAnalysisResponse{Error: "invalid request body"})
		return
	}

	if len(req.PaperIDs) == 0 {
		json.NewEncoder(w).Encode(GapAnalysisResponse{Error: "paper_ids required"})
		return
	}

	// Fetch papers from DB
	papers, err := h.getPapersByIDs(req.PaperIDs)
	if err != nil {
		log.Printf("GapAnalysis: fetch error: %v", err)
		json.NewEncoder(w).Encode(GapAnalysisResponse{Error: "gagal mengambil data paper"})
		return
	}

	if len(papers) == 0 {
		json.NewEncoder(w).Encode(GapAnalysisResponse{Error: "paper tidak ditemukan"})
		return
	}

	// Get topic context
	topicContext := h.getTopicContext(req.ProjectID)

	// Convert gapPaper slice to agent.PaperDetail slice
	paperDetails := make([]agent.PaperDetail, 0, len(papers))
	for _, p := range papers {
		paperDetails = append(paperDetails, paperToPaperDetail(p))
	}

	// Build provider config from env
	apiKey := os.Getenv("DEEPSEEK_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("DEEPSEEK_KEY")
	}
	config := agent.ProviderConfig{
		Provider:  "deepseek",
		Model:     "deepseek-chat",
		APIKey:    apiKey,
		MaxTokens: 2000,
	}

	// Call LiteratureAgent.AnalyzeGap
	gapResult, err := h.litAgent.AnalyzeGap(paperDetails, config)
	if err != nil {
		log.Printf("GapAnalysis: AnalyzeGap failed: %v", err)
		// Fallback: return basic analysis
		analysis, gaps, recommendations := h.fallbackAnalysis(papers, topicContext)
		json.NewEncoder(w).Encode(GapAnalysisResponse{
			Analysis:        analysis,
			Gaps:            gaps,
			Recommendations: recommendations,
			PapersAnalyzed:  len(papers),
		})
		return
	}

	// Convert agent.GapAnalysis to GapAnalysisResponse
	analysis := buildAnalysisText(gapResult, topicContext, len(papers))

	gaps := make([]string, 0, len(gapResult.IdentifiedGaps))
	for _, g := range gapResult.IdentifiedGaps {
		desc := g.Description
		if g.Area != "" {
			desc = fmt.Sprintf("[%s] %s", g.Area, g.Description)
		}
		gaps = append(gaps, desc)
	}

	recommendations := gapResult.Recommendations
	if recommendations == nil {
		recommendations = []string{}
	}

	resp := GapAnalysisResponse{
		Analysis:        analysis,
		Gaps:            gaps,
		Recommendations: recommendations,
		PapersAnalyzed:  len(papers),
	}
	json.NewEncoder(w).Encode(resp)
}

// buildAnalysisText constructs a human-readable analysis paragraph from the GapAnalysis struct.
func buildAnalysisText(ga agent.GapAnalysis, topicContext string, paperCount int) string {
	var sb strings.Builder
	if topicContext != "" {
		sb.WriteString(fmt.Sprintf("Analisis gap literatur untuk topik \"%s\". ", topicContext))
	}
	sb.WriteString(fmt.Sprintf("Dianalisis %d paper. ", paperCount))

	if len(ga.Strengths) > 0 {
		sb.WriteString("Kekuatan literatur: ")
		sb.WriteString(strings.Join(ga.Strengths, "; "))
		sb.WriteString(". ")
	}
	if len(ga.Weaknesses) > 0 {
		sb.WriteString("Kelemahan: ")
		sb.WriteString(strings.Join(ga.Weaknesses, "; "))
		sb.WriteString(". ")
	}
	if len(ga.IdentifiedGaps) > 0 {
		sb.WriteString(fmt.Sprintf("Teridentifikasi %d celah penelitian. ", len(ga.IdentifiedGaps)))
	}

	result := sb.String()
	if result == "" {
		result = fmt.Sprintf("Analisis gap literatur selesai untuk %d paper.", paperCount)
	}
	return result
}

// Minimal paper struct for gap analysis
type gapPaper struct {
	ID        int    `db:"id"`
	Title     string `db:"title"`
	Authors   string `db:"authors"`
	Abstract  string `db:"abstract"`
	KeyPoints string `db:"key_points"`
}

func (h *GapAnalysisHandler) getPapersByIDs(ids []int) ([]gapPaper, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	if db.DB == nil || !db.IsConnected() {
		return []gapPaper{}, nil
	}

	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	query := fmt.Sprintf(
		"SELECT id, title, COALESCE(authors,'') as authors, COALESCE(abstract,'') as abstract, COALESCE(key_points,'') as key_points FROM research_papers WHERE id IN (%s)",
		strings.Join(placeholders, ","),
	)
	var papers []gapPaper
	err := db.DB.Select(&papers, query, args...)
	return papers, err
}

func (h *GapAnalysisHandler) getTopicContext(projectID int) string {
	if db.DB == nil || !db.IsConnected() {
		return ""
	}

	var topics []struct {
		Topic string `db:"topic"`
	}
	err := db.DB.Select(&topics, "SELECT topic FROM research_topics WHERE project_id = ? LIMIT 1", projectID)
	if err != nil || len(topics) == 0 {
		return ""
	}
	return topics[0].Topic
}

// paperToPaperDetail converts a DB gapPaper to agent.PaperDetail for gap analysis.
func paperToPaperDetail(p gapPaper) agent.PaperDetail {
	authors := []agent.Author{}
	if p.Authors != "" {
		authors = append(authors, agent.Author{LastName: p.Authors})
	}
	return agent.PaperDetail{
		PMID:     fmt.Sprintf("local-%d", p.ID),
		Title:    p.Title,
		Abstract: p.Abstract,
		Authors:  authors,
		Year:     2025,
	}
}

func (h *GapAnalysisHandler) fallbackAnalysis(papers []gapPaper, topic string) (string, []string, []string) {
	var titles []string
	for _, p := range papers {
		titles = append(titles, p.Title)
	}

	analysis := fmt.Sprintf(
		"Analisis dilakukan terhadap %d paper terkait \"%s\". Paper yang dianalisis: %s. "+
			"Untuk analisis gap yang lebih mendalam, pastikan setiap paper memiliki abstrak yang lengkap dan key points yang telah digenerate.",
		len(papers), topic, strings.Join(titles, "; "),
	)

	gaps := []string{
		"Belum ada penelitian yang mengintegrasikan seluruh temuan dari paper-paper ini secara komprehensif",
		"Perlu eksplorasi lebih lanjut terkait kesenjangan metodologis antar penelitian",
		"Konteks lokal spesifik mungkin belum terakomodasi dalam literatur yang ada",
	}

	recommendations := []string{
		"Lengkapi abstrak dan generate key points pada setiap paper untuk analisis yang lebih akurat",
		"Tambahkan lebih banyak literatur yang relevan untuk memperkaya analisis",
		"Gunakan metode systematic literature review untuk hasil yang lebih komprehensif",
	}

	return analysis, gaps, recommendations
}

func cleanJSON(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	return strings.TrimSpace(s)
}
