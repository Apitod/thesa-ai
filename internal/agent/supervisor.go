package agent

import (
	"encoding/json"
	"fmt"
)

// ---------------------------------------------------------------------------
// AgentSupervisor — AI-powered macro review, Socratic dialog, format check,
// and readiness scoring for academic writing projects
// ---------------------------------------------------------------------------

// AgentSupervisor handles AI-driven evaluation of full documents, Socratic
// questioning, answer evaluation, format validation, and readiness scoring.
type AgentSupervisor struct {
	provider AIProvider
}

// NewAgentSupervisor creates a new AgentSupervisor.
func NewAgentSupervisor(provider AIProvider) *AgentSupervisor {
	return &AgentSupervisor{provider: provider}
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

// MacroReview captures macro-level quality scores for a full document.
type MacroReview struct {
	StructureScore  int      `json:"structure_score"`
	ArgumentFlow    int      `json:"argument_flow"`
	CoverageScore   int      `json:"coverage_score"`
	CitationDensity int      `json:"citation_density"`
	OverallScore    int      `json:"overall_score"`
	Recommendations []string `json:"recommendations"`
}

// SocraticQuestion represents a single Socratic question probing the writer.
type SocraticQuestion struct {
	ID             int    `json:"id"`
	Question       string `json:"question"`
	Type           string `json:"type"`
	RelatedSection string `json:"related_section"`
}

// SocraticEvaluation holds the score and feedback for a Socratic answer.
type SocraticEvaluation struct {
	Score      int    `json:"score"`
	Feedback   string `json:"feedback"`
	Understood bool   `json:"understood"`
}

// FormatCheck reports whether document metadata meets template formatting rules.
type FormatCheck struct {
	Valid  bool          `json:"valid"`
	Issues []FormatIssue `json:"issues"`
}

// FormatIssue describes a single formatting rule violation.
type FormatIssue struct {
	Rule     string `json:"rule"`
	Found    string `json:"found"`
	Expected string `json:"expected"`
	Severity string `json:"severity"`
}

// DocumentMetadata holds high-level metadata about a document.
type DocumentMetadata struct {
	Title         string `json:"title"`
	Author        string `json:"author"`
	WordCount     int    `json:"word_count"`
	PageCount     int    `json:"page_count"`
	CitationCount int    `json:"citation_count"`
	Font          string `json:"font"`
	Spacing       string `json:"spacing"`
}

// ReadinessReport provides an overall readiness score for a document.
type ReadinessReport struct {
	OverallScore int               `json:"overall_score"`
	Status       string            `json:"status"`
	PerAspect    map[string]int    `json:"per_aspect"`
	NextActions  []string          `json:"next_actions"`
}

// ---------------------------------------------------------------------------
// AnalyzeDocument — macro-level review of a full document
// ---------------------------------------------------------------------------

// AnalyzeDocument sends the full document to the AI and returns a MacroReview
// with structure, argument flow, coverage, citation density, and overall scores.
func (s *AgentSupervisor) AnalyzeDocument(fullDocument string, config ProviderConfig) (*MacroReview, error) {
	if s.provider == nil {
		return nil, fmt.Errorf("agent supervisor: AI provider not set")
	}
	if fullDocument == "" {
		return nil, fmt.Errorf("agent supervisor: document is empty")
	}

	// Truncate document to avoid token limits
	doc := fullDocument
	if len(doc) > 8000 {
		doc = doc[:8000] + "... [truncated]"
	}

	prompt := fmt.Sprintf(`You are an academic writing reviewer. Analyze this full document for macro-level quality.

Document:
%s

Score each aspect 0-100:
- structure_score: how well the document is organized (sections, flow, hierarchy)
- argument_flow: logical progression of arguments and ideas
- coverage_score: breadth and depth of topic coverage
- citation_density: appropriate use and frequency of citations
- overall_score: holistic quality score

Provide 3-5 specific, actionable recommendations for improvement.

Return JSON with exactly these keys: "structure_score", "argument_flow", "coverage_score", "citation_density", "overall_score", "recommendations".

Output ONLY valid JSON, no markdown fences, no extra text.`, doc)

	messages := []Message{
		{Role: "system", Content: "You are a precise academic writing reviewer. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := s.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("agent supervisor: AnalyzeDocument AI call failed: %w", err)
	}

	return parseMacroReviewJSON(result)
}

// parseMacroReviewJSON extracts MacroReview from AI JSON response.
func parseMacroReviewJSON(jsonStr string) (*MacroReview, error) {
	cleaned := cleanJSONString(jsonStr)

	var review MacroReview
	if err := json.Unmarshal([]byte(cleaned), &review); err != nil {
		return &MacroReview{
			StructureScore:  0,
			ArgumentFlow:    0,
			CoverageScore:   0,
			CitationDensity: 0,
			OverallScore:    0,
			Recommendations: []string{},
		}, fmt.Errorf("parse macro review JSON: %w", err)
	}

	if review.Recommendations == nil {
		review.Recommendations = []string{}
	}

	return &review, nil
}

// ---------------------------------------------------------------------------
// SocraticDialog — generate Socratic questions that probe the writer
// ---------------------------------------------------------------------------

// SocraticDialog generates 3-5 Socratic questions that test the writer's
// understanding of their own document, probing analytical depth.
func (s *AgentSupervisor) SocraticDialog(fullDocument string, config ProviderConfig) ([]SocraticQuestion, error) {
	if s.provider == nil {
		return nil, fmt.Errorf("agent supervisor: AI provider not set")
	}
	if fullDocument == "" {
		return nil, fmt.Errorf("agent supervisor: document is empty")
	}

	doc := fullDocument
	if len(doc) > 8000 {
		doc = doc[:8000] + "... [truncated]"
	}

	prompt := fmt.Sprintf(`You are a Socratic tutor for academic writing. Generate 3-5 Socratic questions that test the writer's understanding of their own document. Questions should probe analytical depth, not factual recall.

Document:
%s

Each question must have:
- "id": unique integer
- "question": the Socratic question
- "type": one of "analytical", "comparative", or "critical"
- "related_section": which section of the document the question relates to

Return a JSON array of questions.

Output ONLY valid JSON, no markdown fences, no extra text.`, doc)

	messages := []Message{
		{Role: "system", Content: "You are a precise Socratic tutor. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := s.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("agent supervisor: SocraticDialog AI call failed: %w", err)
	}

	return parseSocraticQuestionsJSON(result)
}

// parseSocraticQuestionsJSON extracts a slice of SocraticQuestion from JSON.
func parseSocraticQuestionsJSON(jsonStr string) ([]SocraticQuestion, error) {
	cleaned := cleanJSONString(jsonStr)

	var questions []SocraticQuestion
	if err := json.Unmarshal([]byte(cleaned), &questions); err != nil {
		return []SocraticQuestion{}, fmt.Errorf("parse Socratic questions JSON: %w", err)
	}

	if questions == nil {
		return []SocraticQuestion{}, nil
	}

	return questions, nil
}

// ---------------------------------------------------------------------------
// EvaluateAnswer — evaluate a writer's answer to a Socratic question
// ---------------------------------------------------------------------------

// EvaluateAnswer scores an answer to a Socratic question on a 0-100 scale,
// provides feedback, and determines if the writer understood the concept.
func (s *AgentSupervisor) EvaluateAnswer(question SocraticQuestion, answer string, config ProviderConfig) (*SocraticEvaluation, error) {
	if s.provider == nil {
		return nil, fmt.Errorf("agent supervisor: AI provider not set")
	}
	if answer == "" {
		return nil, fmt.Errorf("agent supervisor: answer is empty")
	}

	prompt := fmt.Sprintf(`You are an academic writing evaluator. Evaluate this answer to a Socratic question.

Question: %s
Answer: %s

Score 0-100, provide constructive feedback, and determine if the writer understood the core concept.

Return JSON with exactly these keys: "score", "feedback", "understood".

Output ONLY valid JSON, no markdown fences, no extra text.`, question.Question, answer)

	messages := []Message{
		{Role: "system", Content: "You are a precise academic writing evaluator. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := s.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("agent supervisor: EvaluateAnswer AI call failed: %w", err)
	}

	return parseSocraticEvaluationJSON(result)
}

// parseSocraticEvaluationJSON extracts SocraticEvaluation from JSON response.
func parseSocraticEvaluationJSON(jsonStr string) (*SocraticEvaluation, error) {
	cleaned := cleanJSONString(jsonStr)

	var eval SocraticEvaluation
	if err := json.Unmarshal([]byte(cleaned), &eval); err != nil {
		return &SocraticEvaluation{
			Score:      0,
			Feedback:   "",
			Understood: false,
		}, fmt.Errorf("parse Socratic evaluation JSON: %w", err)
	}

	return &eval, nil
}

// ---------------------------------------------------------------------------
// ValidateFormat — check document metadata against template formatting rules
// ---------------------------------------------------------------------------

// ValidateFormat checks document metadata against a set of template formatting
// rules and returns a FormatCheck with any issues found.
func (s *AgentSupervisor) ValidateFormat(metadata DocumentMetadata, templateRules *StyleGuide, config ProviderConfig) (*FormatCheck, error) {
	if s.provider == nil {
		return nil, fmt.Errorf("agent supervisor: AI provider not set")
	}

	metaJSON, _ := json.Marshal(metadata)
	rulesJSON, _ := json.Marshal(templateRules)

	prompt := fmt.Sprintf(`You are an academic formatting validator. Check the following document metadata against the template formatting rules.

Document Metadata (JSON):
%s

Template Rules (JSON):
%s

Validate each rule against the metadata. For each violation, record:
- "rule": which rule was violated
- "found": what the document actually has
- "expected": what the rule requires
- "severity": "error" or "warning"

Return JSON with exactly these keys: "valid" (boolean, true if no errors), "issues" (array of issue objects).

Output ONLY valid JSON, no markdown fences, no extra text.`, string(metaJSON), string(rulesJSON))

	messages := []Message{
		{Role: "system", Content: "You are a precise academic formatting validator. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := s.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("agent supervisor: ValidateFormat AI call failed: %w", err)
	}

	return parseFormatCheckJSON(result)
}

// parseFormatCheckJSON extracts FormatCheck from JSON response.
func parseFormatCheckJSON(jsonStr string) (*FormatCheck, error) {
	cleaned := cleanJSONString(jsonStr)

	var check FormatCheck
	if err := json.Unmarshal([]byte(cleaned), &check); err != nil {
		return &FormatCheck{
			Valid:  false,
			Issues: []FormatIssue{},
		}, fmt.Errorf("parse format check JSON: %w", err)
	}

	if check.Issues == nil {
		check.Issues = []FormatIssue{}
	}

	return &check, nil
}

// ---------------------------------------------------------------------------
// ScoreReadiness — compute overall readiness score from all evaluations
// ---------------------------------------------------------------------------

// ScoreReadiness calculates the final readiness score from macro review results,
// Socratic evaluations, and format check data, returning a ReadinessReport with
// per-aspect scores, overall status, and recommended next actions.
func (s *AgentSupervisor) ScoreReadiness(macro MacroReview, socratic []SocraticEvaluation, format FormatCheck, config ProviderConfig) (*ReadinessReport, error) {
	if s.provider == nil {
		return nil, fmt.Errorf("agent supervisor: AI provider not set")
	}

	macroJSON, _ := json.Marshal(macro)
	socJSON, _ := json.Marshal(socratic)
	fmtJSON, _ := json.Marshal(format)

	prompt := fmt.Sprintf(`You are an academic readiness assessor. Calculate the overall readiness score from the following evaluation data.

Macro Review (JSON):
%s

Socratic Evaluations (JSON):
%s

Format Check (JSON):
%s

Return a readiness assessment with:
- "overall_score": 0-100, weighted composite score
- "status": one of "ready" (score >= 80, no critical issues), "revise" (score 50-79, minor revisions needed), "rewrite" (score < 50, major issues)
- "per_aspect": object with aspect names as keys and scores 0-100 as values (e.g. "macro_quality", "analytical_depth", "format_compliance")
- "next_actions": array of strings with specific recommended next actions

Output ONLY valid JSON, no markdown fences, no extra text.`,
		string(macroJSON), string(socJSON), string(fmtJSON))

	messages := []Message{
		{Role: "system", Content: "You are a precise academic readiness assessor. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := s.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("agent supervisor: ScoreReadiness AI call failed: %w", err)
	}

	return parseReadinessReportJSON(result)
}

// parseReadinessReportJSON extracts ReadinessReport from JSON response.
func parseReadinessReportJSON(jsonStr string) (*ReadinessReport, error) {
	cleaned := cleanJSONString(jsonStr)

	var report ReadinessReport
	if err := json.Unmarshal([]byte(cleaned), &report); err != nil {
		return &ReadinessReport{
			OverallScore: 0,
			Status:       "revise",
			PerAspect:    map[string]int{},
			NextActions:  []string{},
		}, fmt.Errorf("parse readiness report JSON: %w", err)
	}

	if report.PerAspect == nil {
		report.PerAspect = map[string]int{}
	}
	if report.NextActions == nil {
		report.NextActions = []string{}
	}

	return &report, nil
}
