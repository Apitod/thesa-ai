package agent

import (
	"encoding/json"
	"fmt"
	"strings"
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
	OverallScore int            `json:"overall_score"`
	Status       string         `json:"status"`
	PerAspect    map[string]int `json:"per_aspect"`
	NextActions  []string       `json:"next_actions"`
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

// ---------------------------------------------------------------------------
// AI Viva Voce Defense Simulator — Multi-Persona Examiners
// ---------------------------------------------------------------------------

// ExaminerPersona defines the role, profile, and questioning style of an academic examiner.
type ExaminerPersona struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Role      string `json:"role"`       // "Ketua Penguji", "Penguji I (Metodologi)", "Penguji II (Statistik & Data)"
	FocusArea string `json:"focus_area"` // "Novelty & Landasan Teori", "Validitas & Desain Sampel", "Analisis & Replikasi Data"
	Avatar    string `json:"avatar"`
	ToneStyle string `json:"tone_style"` // "kritis-konstruktif", "ketat-metodologis", "analitis-kuantitatif"
}

// ExaminerSimulateRequest carries data for an examiner round question or evaluation.
type ExaminerSimulateRequest struct {
	Mode       string          `json:"mode"` // "question" or "evaluate"
	Document   string          `json:"document"`
	Topic      string          `json:"topic"`
	Difficulty string          `json:"difficulty"` // "coaching", "standard", "killer"
	Turn       int             `json:"turn"`
	Examiner   ExaminerPersona `json:"examiner"`
	Question   string          `json:"question,omitempty"`
	Answer     string          `json:"answer,omitempty"`
}

// ExaminerSimulateResponse returns generated question or evaluation result.
type ExaminerSimulateResponse struct {
	QuestionText      string         `json:"question_text,omitempty"`
	ContextBab        string         `json:"context_bab,omitempty"`
	Intent            string         `json:"intent,omitempty"`
	Score             int            `json:"score,omitempty"`
	Grade             string         `json:"grade,omitempty"`
	Feedback          string         `json:"feedback,omitempty"`
	Critique          string         `json:"critique,omitempty"`
	StrongPoints      []string       `json:"strong_points,omitempty"`
	ImprovementPoints []string       `json:"improvement_points,omitempty"`
	AspectScores      map[string]int `json:"aspect_scores,omitempty"`
}

// SimulateExaminer handles dynamic questioning and rigorous scoring for Viva Voce defense.
func (s *AgentSupervisor) SimulateExaminer(req ExaminerSimulateRequest, config ProviderConfig) (*ExaminerSimulateResponse, error) {
	if s.provider == nil {
		return nil, fmt.Errorf("agent supervisor: AI provider not set")
	}

	if req.Mode == "evaluate" {
		return s.evaluateExaminerTurn(req, config)
	}
	return s.generateExaminerQuestion(req, config)
}

func (s *AgentSupervisor) generateExaminerQuestion(req ExaminerSimulateRequest, config ProviderConfig) (*ExaminerSimulateResponse, error) {
	docSnippet := req.Document
	if len(docSnippet) > 3000 {
		docSnippet = docSnippet[:3000] + "\n...(dipersingkat)"
	}

	prompt := fmt.Sprintf(`Anda adalah %s, bertindak sebagai %s dalam ujian sidang akademik skripsi/tesis perguruan tinggi Indonesia.
Fokus Pengujian Spesifik Anda: %s.
Tingkat Keketatan: %s.

Materi & Draf Riset Mahasiswa:
Topik Penelitian: "%s"
Kutipan Draf Naskah:
%s

TUGAS UTAMA:
Buatlah 1 buah pertanyaan teks ujian sidang yang SANGAT SPESIFIK dan KONTEKSTUAL terhadap draf naskah di atas.
- DILARANG membuat pertanyaan klise/generik.
- Sebutkan atau rujuklah langsung variabel, konsep kunci, atau metode yang tertulis pada draf mahasiswa.
- Sasarlah logika penalaran, justifikasi pemilihan metode, konsistensi argumen, atau implikasi temuan mereka.

Keluarkan HANYA JSON valid:
{
  "question_text": "Teks pertanyaan mendalam dan spesifik sesuai draf materi mahasiswa",
  "context_bab": "BAB I / BAB II / BAB III / BAB IV / BAB V",
  "intent": "Aspek kritis yang diuji dari materi mahasiswa"
}`, req.Examiner.Name, req.Examiner.Role, req.Examiner.FocusArea, req.Difficulty, req.Topic, docSnippet)

	messages := []Message{
		{Role: "system", Content: "Anda adalah penguji sidang skripsi akademik berstandar tinggi. Pertanyaan Anda harus sangat kontekstual mengacu pada teks materi mahasiswa. Jawab HANYA dalam JSON valid."},
		{Role: "user", Content: prompt},
	}

	result, err := s.provider.Chat(messages, config)
	if err != nil {
		return nil, err
	}

	var resp ExaminerSimulateResponse
	cleaned := cleanJSONString(result)
	if err := json.Unmarshal([]byte(cleaned), &resp); err != nil {
		return nil, fmt.Errorf("Gemini examiner question response is not valid JSON: %w", err)
	}

	return &resp, nil
}

func (s *AgentSupervisor) evaluateExaminerTurn(req ExaminerSimulateRequest, config ProviderConfig) (*ExaminerSimulateResponse, error) {
	prompt := fmt.Sprintf(`Anda adalah %s (%s) yang sedang mengevaluasi jawaban lisan mahasiswa pada ujian sidang skripsi.
Fokus Anda: %s.
Keketatan: %s.

Pertanyaan Penguji:
"%s"

Jawaban Lisan Mahasiswa:
"%s"

Tugas:
Evaluasi ketajaman, argumentasi logis, dan penguasaan materi dari jawaban mahasiswa tersebut.
Beri penilaian rubrik akademik (skor 50-100).

Keluarkan format JSON murni:
{
  "score": 85,
  "grade": "A / A- / B+ / B / C",
  "feedback": "Ulasan singkat jawaban mahasiswa",
  "critique": "Kritik atau sanggahan konstruktif penguji",
  "strong_points": ["Kelebihan 1", "Kelebihan 2"],
  "improvement_points": ["Catatan perbaikan 1", "Catatan perbaikan 2"],
  "aspect_scores": {
    "logic": 85,
    "method": 80,
    "literature": 82,
    "oral": 88
  }
}`, req.Examiner.Name, req.Examiner.Role, req.Examiner.FocusArea, req.Difficulty, req.Question, req.Answer)

	messages := []Message{
		{Role: "system", Content: "Anda adalah evaluator sidang skripsi perguruan tinggi Indonesia yang adil dan objektif. Jawab HANYA dalam JSON valid."},
		{Role: "user", Content: prompt},
	}

	result, err := s.provider.Chat(messages, config)
	if err != nil {
		return nil, err
	}

	var resp ExaminerSimulateResponse
	cleaned := cleanJSONString(result)
	if err := json.Unmarshal([]byte(cleaned), &resp); err != nil {
		return nil, fmt.Errorf("Gemini examiner evaluation response is not valid JSON: %w", err)
	}

	return &resp, nil
}

// ---------------------------------------------------------------------------
// Deliberative Co-Authoring & Conversation Turn
// ---------------------------------------------------------------------------

// ConversationTurnRequest carries all context for a single user turn in workspace
type ConversationTurnRequest struct {
	ProjectID     int               `json:"project_id"`
	CurrentStep   string            `json:"current_step"`   // e.g. "1.1", "1.2", "1.3", "2.1", "2.2", "3.1"
	TargetSection string            `json:"target_section"` // section being revised or discussed
	UserMessage   string            `json:"user_message"`   // Free-text input from user
	ActionType    string            `json:"action_type"`    // "free_text" | "chip_select" | "revision" | "reconcile" | "approve"
	PaperContext  map[string]string `json:"paper_context"`  // Current content of each section
	EditDelta     *EditDelta        `json:"edit_delta"`     // What user changed since last turn
	Topic         string            `json:"topic"`
	Problems      []string          `json:"problems"`
	Goals         []string          `json:"goals"`
}

// EditDelta represents a semantic change made in the paper
type EditDelta struct {
	Section  string `json:"section"`   // Section ID, e.g. "1.1", "1.2", "2.1"
	Before   string `json:"before"`    // Previous content
	After    string `json:"after"`     // Current content
	EditType string `json:"edit_type"` // "addition" | "deletion" | "rewrite" | "refinement"
}

// Recommendation provides a proactive, pedagogical suggestion for next action
type Recommendation struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Rationale   string `json:"rationale"` // Why this is recommended (pedagogical)
	Icon        string `json:"icon"`
	Relevance   string `json:"relevance"` // "high" | "medium"
	ActionType  string `json:"action_type"`
}

// ConversationTurnResponse is returned to the frontend workspace co-pilot
type ConversationTurnResponse struct {
	ResponseType    string           `json:"response_type"` // "draft" | "revision" | "probe" | "cascade_alert" | "advice"
	Title           string           `json:"title"`
	Message         string           `json:"message"`
	DraftContent    string           `json:"draft_content,omitempty"`
	TargetSection   string           `json:"target_section,omitempty"`
	Rationale       string           `json:"rationale"` // Explains WHY to strengthen user comprehension
	Recommendations []Recommendation `json:"recommendations"`
	CascadeWarnings []CascadeImpact  `json:"cascade_warnings,omitempty"`
}

// ExecuteConversationTurn processes a user turn with LLM reasoning, rationale, and cascade analysis
func (s *AgentSupervisor) ExecuteConversationTurn(req ConversationTurnRequest, config ProviderConfig) (*ConversationTurnResponse, error) {
	if s.provider == nil {
		return nil, fmt.Errorf("agent supervisor: AI provider not configured")
	}

	prompt := fmt.Sprintf(`Anda adalah Thesa Co-Authoring Engine, mitra dialog sokratik penulisan akademik perguruan tinggi Indonesia.
PRINSIP: Anda BUKAN sekadar ghostwriter otomatis, melainkan co-author yang membimbing dan memperkuat pemahaman mahasiswa.

Konteks Percakapan:
- Topik: %s
- Langkah Aktif: %s
- Bagian Target: %s
- Tipe Aksi: %s
- Masukan Pengguna: "%s"
- Masalah Riset: %s
- Tujuan Riset: %s
- Isi naskah saat ini: %s

Format JSON yang WAJIB dihasilkan:
{
  "response_type": "draft",
  "title": "Judul Respon Ringkas",
  "message": "Ulasan pedagogis ramah dan tajam",
  "draft_content": "Paragraf akademik berkualitas tinggi hasil sintesis pemikiran mahasiswa",
  "rationale": "Penjelasan MENGAPA formulasi draf ini kokoh secara metodologis & argumentatif",
  "recommendations": [
    {
      "id": "rec-1",
      "title": "Aksi Lanjutan Relevan",
      "description": "Deskripsi singkat saran",
      "rationale": "Alasan akademis",
      "icon": "auto_stories",
      "relevance": "high",
      "action_type": "insert"
    }
  ]
}`, req.Topic, req.CurrentStep, req.TargetSection, req.ActionType, req.UserMessage, strings.Join(req.Problems, "; "), strings.Join(req.Goals, "; "), formatPaperContext(req.PaperContext))

	messages := []Message{
		{Role: "system", Content: "Anda adalah Thesa Co-Authoring Engine. Respons HANYA dalam JSON valid tanpa markdown fence."},
		{Role: "user", Content: prompt},
	}

	result, err := s.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("generate conversation response: %w", err)
	}

	var resp ConversationTurnResponse
	cleaned := cleanJSONString(result)
	if err := json.Unmarshal([]byte(cleaned), &resp); err != nil {
		return nil, fmt.Errorf("Gemini returned invalid conversation JSON: %w", err)
	}

	return &resp, nil
}

func formatPaperContext(context map[string]string) string {
	if len(context) == 0 {
		return "(belum ada)"
	}
	parts := make([]string, 0, len(context))
	for section, content := range context {
		if len(content) > 1200 {
			content = content[:1200] + "…"
		}
		parts = append(parts, section+": "+content)
	}
	return strings.Join(parts, "\n")
}
