package agent

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ---------------------------------------------------------------------------
// Literature Agent
// ---------------------------------------------------------------------------

// PaperSummary holds an AI-generated summary of a single paper.
type PaperSummary struct {
	Paper          PaperDetail
	Summary        string
	KeyFindings    []string
	Methodology    string
	Limitations    []string
	RelevanceScore float64
}

// GapAnalysis holds the result of a research gap analysis across papers.
type GapAnalysis struct {
	IdentifiedGaps  []ResearchGap
	Recommendations []string
	Strengths       []string
	Weaknesses      []string
}

// ResearchGap describes a single identified research gap.
type ResearchGap struct {
	Area        string
	Description string
	Evidence    string
	PotentialRQ string
}

// LiteratureAgent combines PubMed search with AI-powered analysis.
type LiteratureAgent struct {
	provider AIProvider
	pubmed   *PubMedClient
}

// NewLiteratureAgent creates a new LiteratureAgent.
// It initialises the PubMed client and stores the AI provider reference.
func NewLiteratureAgent(provider AIProvider) *LiteratureAgent {
	return &LiteratureAgent{
		provider: provider,
		pubmed:   NewPubMedClient("thesa@risethub.com"),
	}
}

// SetPubMedEmail allows overriding the email used in PubMed API calls.
func (a *LiteratureAgent) SetPubMedEmail(email string) {
	a.pubmed = NewPubMedClient(email)
}

// SetPubMedAPIKey sets an optional NCBI API key for higher rate limits.
func (a *LiteratureAgent) SetPubMedAPIKey(key string) {
	a.pubmed.SetAPIKey(key)
}

// PubMedClient returns the underlying PubMed client for direct use.
func (a *LiteratureAgent) PubMedClient() *PubMedClient {
	return a.pubmed
}

// ---------------------------------------------------------------------------
// Search & Summarise
// ---------------------------------------------------------------------------

// SearchAndSummarize searches PubMed and uses AI to summarise each paper.
// The config parameter controls which AI model/provider settings to use.
func (a *LiteratureAgent) SearchAndSummarize(query string, filters PubMedFilter, config ProviderConfig) ([]PaperSummary, error) {
	if a.provider == nil {
		return nil, fmt.Errorf("literature agent: AI provider not set")
	}

	// Search
	var refs []PaperRef
	var err error
	hasFilters := filters.YearFrom > 0 || filters.YearTo > 0 ||
		filters.JournalName != "" || filters.AuthorName != "" ||
		filters.PublicationType != "" || filters.FreeFullText

	if hasFilters {
		refs, err = a.pubmed.SearchWithFilters(query, filters)
	} else {
		refs, err = a.pubmed.SearchPapers(query, 10)
	}
	if err != nil {
		return nil, fmt.Errorf("literature agent: search failed: %w", err)
	}

	if len(refs) == 0 {
		return []PaperSummary{}, nil
	}

	// Collect PMIDs
	ids := make([]string, 0, len(refs))
	for _, r := range refs {
		ids = append(ids, r.PMID)
	}

	// Fetch full details
	details, err := a.pubmed.FetchPaperDetails(ids)
	if err != nil {
		return nil, fmt.Errorf("literature agent: fetch details failed: %w", err)
	}

	// Summarise each paper with AI
	// We process papers one at a time to keep prompts concise and avoid token limits.
	summaries := make([]PaperSummary, 0, len(details))
	for _, paper := range details {
		sum, err := a.summarisePaper(paper, config)
		if err != nil {
			// If AI summarisation fails for one paper, return a minimal summary
			sum = PaperSummary{
				Paper:   paper,
				Summary: fmt.Sprintf("Could not generate AI summary: %v", err),
			}
		}
		summaries = append(summaries, sum)
	}

	return summaries, nil
}

// summarisePaper sends a single paper to the AI for structured summarisation.
func (a *LiteratureAgent) summarisePaper(paper PaperDetail, config ProviderConfig) (PaperSummary, error) {
	// Build a concise paper description
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Title: %s\n", paper.Title))
	sb.WriteString(fmt.Sprintf("Authors: %s\n", joinAuthors(paper.Authors)))
	sb.WriteString(fmt.Sprintf("Journal: %s (%d)\n", paper.Journal, paper.Year))
	if paper.DOI != "" {
		sb.WriteString(fmt.Sprintf("DOI: %s\n", paper.DOI))
	}
	if paper.Abstract != "" {
		// Truncate abstract to avoid exceeding token limits
		abstract := paper.Abstract
		if len(abstract) > 1500 {
			abstract = abstract[:1500] + "..."
		}
		sb.WriteString(fmt.Sprintf("Abstract: %s\n", abstract))
	}
	if len(paper.Keywords) > 0 {
		sb.WriteString(fmt.Sprintf("Keywords: %s\n", strings.Join(paper.Keywords, "; ")))
	}
	if len(paper.PublicationTypes) > 0 {
		sb.WriteString(fmt.Sprintf("Type: %s\n", strings.Join(paper.PublicationTypes, "; ")))
	}

	prompt := fmt.Sprintf(`You are a literature review assistant. Summarise the following academic paper in a structured format.

Paper Details:
%s

Please provide the following:
1. SUMMARY: A 2-3 sentence summary of what this paper is about.
2. KEY_FINDINGS: List the main findings or results (bullet points).
3. METHODOLOGY: What research method was used (e.g. experiment, survey, meta-analysis, theoretical review).
4. LIMITATIONS: Any limitations mentioned or implied in the paper (bullet points).
5. RELEVANCE_SCORE: A score from 0.0 to 1.0 indicating how broadly useful this paper is for academic research.

Respond in JSON format with exactly these keys: summary, key_findings (array), methodology, limitations (array), relevance_score (float).`, sb.String())

	messages := []Message{
		{Role: "system", Content: "You are a precise literature review assistant. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := a.provider.Chat(messages, config)
	if err != nil {
		return PaperSummary{
			Paper:          paper,
			Summary:        paper.Abstract,
			KeyFindings:    []string{},
			Methodology:    "",
			Limitations:    []string{},
			RelevanceScore: 0.5,
		}, fmt.Errorf("AI summarisation failed: %w", err)
	}

	// Parse JSON response
	return parsePaperSummaryJSON(result, paper)
}

// parsePaperSummaryJSON extracts structured data from the AI's JSON response.
func parsePaperSummaryJSON(jsonStr string, paper PaperDetail) (PaperSummary, error) {
	// Try to extract JSON if wrapped in markdown code fences
	cleaned := jsonStr
	if idx := strings.Index(cleaned, "{"); idx >= 0 {
		cleaned = cleaned[idx:]
	}
	if idx := strings.LastIndex(cleaned, "}"); idx >= 0 {
		cleaned = cleaned[:idx+1]
	}

	var parsed struct {
		Summary        string   `json:"summary"`
		KeyFindings    []string `json:"key_findings"`
		Methodology    string   `json:"methodology"`
		Limitations    []string `json:"limitations"`
		RelevanceScore float64  `json:"relevance_score"`
	}

	if err := json.Unmarshal([]byte(cleaned), &parsed); err != nil {
		// Fallback: return paper abstract as summary
		return PaperSummary{
			Paper:          paper,
			Summary:        paper.Abstract,
			KeyFindings:    []string{},
			Methodology:    "",
			Limitations:    []string{},
			RelevanceScore: 0.5,
		}, fmt.Errorf("parse AI response: %w", err)
	}

	if parsed.KeyFindings == nil {
		parsed.KeyFindings = []string{}
	}
	if parsed.Limitations == nil {
		parsed.Limitations = []string{}
	}

	return PaperSummary{
		Paper:          paper,
		Summary:        parsed.Summary,
		KeyFindings:    parsed.KeyFindings,
		Methodology:    parsed.Methodology,
		Limitations:    parsed.Limitations,
		RelevanceScore: parsed.RelevanceScore,
	}, nil
}

// ---------------------------------------------------------------------------
// Gap Analysis
// ---------------------------------------------------------------------------

// AnalyzeGap performs a research gap analysis on a collection of papers using AI.
// The config parameter controls which AI model/provider settings to use.
func (a *LiteratureAgent) AnalyzeGap(papers []PaperDetail, config ProviderConfig) (GapAnalysis, error) {
	if a.provider == nil {
		return GapAnalysis{}, fmt.Errorf("literature agent: AI provider not set")
	}
	if len(papers) == 0 {
		return GapAnalysis{}, fmt.Errorf("literature agent: no papers to analyse")
	}

	// Build a concise overview of all papers
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Total papers: %d\n\n", len(papers)))
	for i, p := range papers {
		sb.WriteString(fmt.Sprintf("--- Paper %d ---\n", i+1))
		sb.WriteString(fmt.Sprintf("Title: %s\n", p.Title))
		sb.WriteString(fmt.Sprintf("Authors: %s\n", joinAuthors(p.Authors)))
		sb.WriteString(fmt.Sprintf("Year: %d\n", p.Year))
		sb.WriteString(fmt.Sprintf("Journal: %s\n", p.Journal))
		if p.Abstract != "" {
			abstract := p.Abstract
			if len(abstract) > 800 {
				abstract = abstract[:800] + "..."
			}
			sb.WriteString(fmt.Sprintf("Abstract: %s\n", abstract))
		}
		if len(p.Keywords) > 0 {
			sb.WriteString(fmt.Sprintf("Keywords: %s\n", strings.Join(p.Keywords, "; ")))
		}
		sb.WriteString("\n")
	}

	prompt := fmt.Sprintf(`You are a research gap analysis expert. Based on the following collection of academic papers, identify research gaps and provide insights.

Papers:
%s

Analyse the collection and respond in JSON format with exactly these keys:
- identified_gaps: array of objects with fields: area (string), description (string), evidence (string, reference to a specific paper or general observation), potential_rq (string, a potential research question that could address this gap)
- recommendations: array of strings, suggesting future research directions
- strengths: array of strings, what this body of literature does well
- weaknesses: array of strings, methodological or conceptual weaknesses across the papers`, sb.String())

	messages := []Message{
		{Role: "system", Content: "You are a precise research gap analyst. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := a.provider.Chat(messages, config)
	if err != nil {
		return GapAnalysis{}, fmt.Errorf("gap analysis failed: %w", err)
	}

	return parseGapAnalysisJSON(result)
}

// parseGapAnalysisJSON extracts structured gap analysis from AI JSON response.
func parseGapAnalysisJSON(jsonStr string) (GapAnalysis, error) {
	// Clean: extract JSON from potential markdown fences
	cleaned := jsonStr
	if idx := strings.Index(cleaned, "{"); idx >= 0 {
		cleaned = cleaned[idx:]
	}
	if idx := strings.LastIndex(cleaned, "}"); idx >= 0 {
		cleaned = cleaned[:idx+1]
	}

	var parsed struct {
		IdentifiedGaps []struct {
			Area        string `json:"area"`
			Description string `json:"description"`
			Evidence    string `json:"evidence"`
			PotentialRQ string `json:"potential_rq"`
		} `json:"identified_gaps"`
		Recommendations []string `json:"recommendations"`
		Strengths       []string `json:"strengths"`
		Weaknesses      []string `json:"weaknesses"`
	}

	if err := json.Unmarshal([]byte(cleaned), &parsed); err != nil {
		return GapAnalysis{}, fmt.Errorf("parse gap analysis JSON: %w", err)
	}

	gaps := make([]ResearchGap, 0, len(parsed.IdentifiedGaps))
	for _, g := range parsed.IdentifiedGaps {
		gaps = append(gaps, ResearchGap{
			Area:        g.Area,
			Description: g.Description,
			Evidence:    g.Evidence,
			PotentialRQ: g.PotentialRQ,
		})
	}

	if parsed.Recommendations == nil {
		parsed.Recommendations = []string{}
	}
	if parsed.Strengths == nil {
		parsed.Strengths = []string{}
	}
	if parsed.Weaknesses == nil {
		parsed.Weaknesses = []string{}
	}

	return GapAnalysis{
		IdentifiedGaps:  gaps,
		Recommendations: parsed.Recommendations,
		Strengths:       parsed.Strengths,
		Weaknesses:      parsed.Weaknesses,
	}, nil
}

// ---------------------------------------------------------------------------
// Keyword Recommendation
// ---------------------------------------------------------------------------

// RecommendKeywords uses AI to suggest PubMed search keywords for a given topic.
// The config parameter controls which AI model/provider settings to use.
func (a *LiteratureAgent) RecommendKeywords(topic string, config ProviderConfig) ([]string, error) {
	if a.provider == nil {
		return nil, fmt.Errorf("literature agent: AI provider not set")
	}
	if topic == "" {
		return nil, fmt.Errorf("literature agent: topic is empty")
	}

	prompt := fmt.Sprintf(`Given the research topic: "%s"

Generate a list of 10-15 effective PubMed search keywords or phrases that would return the most relevant results. Include:
1. Core concepts and their synonyms
2. Related subtopics
3. Methodological terms (e.g. "clinical trial", "meta-analysis", "systematic review")
4. Boolean combinations where appropriate

Respond in JSON format with exactly one key: "keywords" containing an array of strings.`, topic)

	messages := []Message{
		{Role: "system", Content: "You are a biomedical literature search expert. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := a.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("keyword recommendation failed: %w", err)
	}

	return parseKeywordsJSON(result)
}

// parseKeywordsJSON extracts keyword list from AI JSON response.
func parseKeywordsJSON(jsonStr string) ([]string, error) {
	cleaned := jsonStr
	if idx := strings.Index(cleaned, "{"); idx >= 0 {
		cleaned = cleaned[idx:]
	}
	if idx := strings.LastIndex(cleaned, "}"); idx >= 0 {
		cleaned = cleaned[:idx+1]
	}

	var parsed struct {
		Keywords []string `json:"keywords"`
	}

	if err := json.Unmarshal([]byte(cleaned), &parsed); err != nil {
		return nil, fmt.Errorf("parse keywords JSON: %w", err)
	}

	if parsed.Keywords == nil {
		parsed.Keywords = []string{}
	}

	return parsed.Keywords, nil
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

// joinAuthors joins a slice of Author into a readable string.
func joinAuthors(authors []Author) string {
	names := make([]string, 0, len(authors))
	for _, a := range authors {
		name := strings.TrimSpace(a.LastName + " " + a.ForeName)
		if name == "" {
			name = a.Initials
		}
		if name != "" {
			names = append(names, strings.TrimSpace(name))
		}
	}
	return strings.Join(names, "; ")
}
