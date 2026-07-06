package agent

import (
	"encoding/json"
	"fmt"

	"risethub_os/backend/internal/db"
)

// ---------------------------------------------------------------------------
// ExerciseAgent — AI-powered exercise generation, review, and skill insights
// ---------------------------------------------------------------------------

// ExerciseAgent handles AI-driven question generation, answer review,
// skill analysis, and reflection persistence for academic exercises.
type ExerciseAgent struct {
	provider AIProvider
}

// NewExerciseAgent creates a new ExerciseAgent.
func NewExerciseAgent(provider AIProvider) *ExerciseAgent {
	return &ExerciseAgent{provider: provider}
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

// ExerciseQuestion represents a single question generated from a document.
type ExerciseQuestion struct {
	ID             int    `json:"id"`
	Question       string `json:"question"`
	Type           string `json:"type"`
	Difficulty     string `json:"difficulty"`
	RelatedSection string `json:"related_section"`
}

// AnswerFeedback represents AI feedback on a user's answer.
type AnswerFeedback struct {
	Score      int    `json:"score"`
	Feedback   string `json:"feedback"`
	Understood bool   `json:"understood"`
}

// SkillInsight represents an analysis of skill strengths and weaknesses.
type SkillInsight struct {
	Strengths           []string `json:"strengths"`
	AreasForImprovement []string `json:"areas_for_improvement"`
	OverallProgress     float64  `json:"overall_progress"`
	RecommendedFocus    string   `json:"recommended_focus"`
}

// ---------------------------------------------------------------------------
// GenerateQuestions — generate 3-5 questions from an academic document
// ---------------------------------------------------------------------------

// GenerateQuestions sends the document to the AI and returns a set of
// analytical/comparative/critical questions to test understanding.
func (e *ExerciseAgent) GenerateQuestions(document string, config ProviderConfig) ([]ExerciseQuestion, error) {
	if e.provider == nil {
		return nil, fmt.Errorf("exercise agent: AI provider not set")
	}
	if document == "" {
		return nil, fmt.Errorf("exercise agent: document is empty")
	}

	// Truncate document to avoid token limits
	doc := document
	if len(doc) > 8000 {
		doc = doc[:8000] + "... [truncated]"
	}

	prompt := fmt.Sprintf(`You are an academic exercise designer. Generate 3-5 questions from this academic document to test understanding. Questions should be analytical, comparative, or critical — not simple recall.

Document:
%s

Each question must have:
- "id": unique integer
- "question": the question text
- "type": one of "analytical", "comparative", or "critical"
- "difficulty": one of "easy", "medium", or "hard"
- "related_section": which section of the document the question relates to

Return a JSON array of questions.

Output ONLY valid JSON, no markdown fences, no extra text.`, doc)

	messages := []Message{
		{Role: "system", Content: "You are a precise academic exercise designer. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := e.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("exercise agent: GenerateQuestions AI call failed: %w", err)
	}

	return parseExerciseQuestionsJSON(result)
}

// parseExerciseQuestionsJSON extracts a slice of ExerciseQuestion from JSON.
func parseExerciseQuestionsJSON(jsonStr string) ([]ExerciseQuestion, error) {
	cleaned := cleanJSONString(jsonStr)

	var questions []ExerciseQuestion
	if err := json.Unmarshal([]byte(cleaned), &questions); err != nil {
		return []ExerciseQuestion{}, fmt.Errorf("parse exercise questions JSON: %w", err)
	}

	if questions == nil {
		return []ExerciseQuestion{}, nil
	}

	return questions, nil
}

// ---------------------------------------------------------------------------
// ReviewAnswer — score and review a user's answer to an exercise question
// ---------------------------------------------------------------------------

// ReviewAnswer sends the question and answer to the AI and returns a score
// (0-100), feedback, and understanding assessment.
func (e *ExerciseAgent) ReviewAnswer(question ExerciseQuestion, answer string, config ProviderConfig) (*AnswerFeedback, error) {
	if e.provider == nil {
		return nil, fmt.Errorf("exercise agent: AI provider not set")
	}
	if answer == "" {
		return nil, fmt.Errorf("exercise agent: answer is empty")
	}

	prompt := fmt.Sprintf(`You are an academic exercise evaluator. Review this answer to an exercise question.

Question: %s
Answer: %s

Score the answer 0-100. Provide constructive feedback. Determine if the core concept was understood.

Return JSON with exactly these keys: "score", "feedback", "understood".

Output ONLY valid JSON, no markdown fences, no extra text.`, question.Question, answer)

	messages := []Message{
		{Role: "system", Content: "You are a precise academic exercise evaluator. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := e.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("exercise agent: ReviewAnswer AI call failed: %w", err)
	}

	return parseAnswerFeedbackJSON(result)
}

// parseAnswerFeedbackJSON extracts AnswerFeedback from JSON response.
func parseAnswerFeedbackJSON(jsonStr string) (*AnswerFeedback, error) {
	cleaned := cleanJSONString(jsonStr)

	var feedback AnswerFeedback
	if err := json.Unmarshal([]byte(cleaned), &feedback); err != nil {
		return &AnswerFeedback{
			Score:      0,
			Feedback:   "",
			Understood: false,
		}, fmt.Errorf("parse answer feedback JSON: %w", err)
	}

	return &feedback, nil
}

// ---------------------------------------------------------------------------
// GenerateSkillInsights — analyze answer feedbacks for skill strengths/weaknesses
// ---------------------------------------------------------------------------

// GenerateSkillInsights analyzes a collection of answer feedbacks and returns
// identified strengths, areas for improvement, overall progress, and
// recommended focus.
func (e *ExerciseAgent) GenerateSkillInsights(existingAnswers []AnswerFeedback, config ProviderConfig) (*SkillInsight, error) {
	if e.provider == nil {
		return nil, fmt.Errorf("exercise agent: AI provider not set")
	}

	answersJSON, err := json.Marshal(existingAnswers)
	if err != nil {
		return nil, fmt.Errorf("exercise agent: failed to marshal answers: %w", err)
	}

	prompt := fmt.Sprintf(`You are a skill analysis specialist. Analyze these answer feedbacks and identify skill strengths and weaknesses.

Answers:
%s

Return a JSON object with:
- "strengths": array of strings describing what the learner does well
- "areas_for_improvement": array of strings describing areas needing development
- "overall_progress": float 0-100 representing overall learning progress
- "recommended_focus": string with recommended next topic or skill to focus on

Output ONLY valid JSON, no markdown fences, no extra text.`, string(answersJSON))

	messages := []Message{
		{Role: "system", Content: "You are a precise skill analysis specialist. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := e.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("exercise agent: GenerateSkillInsights AI call failed: %w", err)
	}

	return parseSkillInsightJSON(result)
}

// parseSkillInsightJSON extracts SkillInsight from JSON response.
func parseSkillInsightJSON(jsonStr string) (*SkillInsight, error) {
	cleaned := cleanJSONString(jsonStr)

	var insight SkillInsight
	if err := json.Unmarshal([]byte(cleaned), &insight); err != nil {
		return &SkillInsight{
			Strengths:           []string{},
			AreasForImprovement: []string{},
			OverallProgress:     0,
			RecommendedFocus:    "",
		}, fmt.Errorf("parse skill insight JSON: %w", err)
	}

	if insight.Strengths == nil {
		insight.Strengths = []string{}
	}
	if insight.AreasForImprovement == nil {
		insight.AreasForImprovement = []string{}
	}

	return &insight, nil
}

// ---------------------------------------------------------------------------
// SaveReflection — persist a learner reflection to the database
// ---------------------------------------------------------------------------

// SaveReflection inserts a reflection entry into the skill_reflections table
// for the given project. No AI is involved — this is a direct DB operation.
func (e *ExerciseAgent) SaveReflection(projectID int, reflection string) error {
	if projectID <= 0 {
		return fmt.Errorf("exercise agent: invalid project ID")
	}
	if reflection == "" {
		return fmt.Errorf("exercise agent: reflection is empty")
	}

	_, err := db.DB.Exec(
		`INSERT INTO skill_reflections (project_id, reflection, created_at)
		 VALUES (?, ?, NOW())
		 ON DUPLICATE KEY UPDATE reflection = VALUES(reflection), updated_at = NOW()`,
		projectID, reflection,
	)
	if err != nil {
		return fmt.Errorf("exercise agent: failed to save reflection: %w", err)
	}

	return nil
}
