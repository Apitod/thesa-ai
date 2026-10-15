package agent

import (
	"strings"
)

// TaskType categorizes the workload complexity for intelligent model routing.
type TaskType string

const (
	TaskSocraticChat      TaskType = "socratic_chat"      // Quick reflexive conversational turns
	TaskTopicValidation   TaskType = "topic_validation"   // Fast premise & constraint checks
	TaskExerciseFeedback  TaskType = "exercise_feedback"  // Socratic micro-feedback
	TaskGapAnalysis       TaskType = "gap_analysis"       // Literature synthesis & novelty reasoning
	TaskOutlineGeneration TaskType = "outline_generation" // Structured syllabus & outline creation
	TaskDefenseSimulation TaskType = "defense_simulation" // Academic examiner challenge
	TaskChapterDrafting   TaskType = "chapter_drafting"   // Long-form academic drafting
)

// RoutedConfig contains optimized model selection and token budget parameters.
type RoutedConfig struct {
	Model            string  `json:"model"`
	MaxTokens        int     `json:"max_tokens"`
	Temperature      float64 `json:"temperature"`
	ContextTurns     int     `json:"context_turns"`
	CompressionLevel string  `json:"compression_level"`  // "aggressive" | "standard" | "verbatim"
	CostTier         string  `json:"cost_tier"`          // "ultra_low" | "medium" | "deep_reasoning"
	EstimatedCostIDR float64 `json:"estimated_cost_idr"` // Estimated cost in Rupiah per invocation
}

// SmartLLMRouter dynamically chooses the most economical model and minimizes token footprint.
type SmartLLMRouter struct {
	defaultProvider string
}

// NewSmartLLMRouter creates an instance of SmartLLMRouter.
func NewSmartLLMRouter() *SmartLLMRouter {
	return &SmartLLMRouter{
		defaultProvider: "gemini",
	}
}

// RouteTask determines the optimal model, max tokens, and context window based on task complexity, user tier, and token balance.
func (r *SmartLLMRouter) RouteTask(task TaskType, userTier string, remainingTokens int) RoutedConfig {
	geminiModel := getEnvOrDefault("GEMINI_MODEL", "gemini-2.5-flash")
	isLowTokenBudget := remainingTokens > 0 && remainingTokens < 30000

	switch task {
	case TaskSocraticChat:
		maxTokens := 500
		turns := 6
		comp := "standard"
		if isLowTokenBudget {
			maxTokens = 350
			turns = 4
		}
		return RoutedConfig{
			Model:            geminiModel,
			MaxTokens:        maxTokens,
			Temperature:      0.6,
			ContextTurns:     turns,
			CompressionLevel: comp,
			CostTier:         "ultra_low",
			EstimatedCostIDR: 1.8,
		}

	case TaskTopicValidation, TaskExerciseFeedback:
		return RoutedConfig{
			Model:            geminiModel,
			MaxTokens:        400,
			Temperature:      0.5,
			ContextTurns:     3,
			CompressionLevel: "standard",
			CostTier:         "ultra_low",
			EstimatedCostIDR: 1.2,
		}

	case TaskDefenseSimulation:
		return RoutedConfig{
			Model:            geminiModel,
			MaxTokens:        600,
			Temperature:      0.7,
			ContextTurns:     4,
			CompressionLevel: "standard",
			CostTier:         "ultra_low",
			EstimatedCostIDR: 2.1,
		}

	case TaskGapAnalysis:
		maxTokens := 1600
		costTier := "medium"
		costIDR := 6.5

		return RoutedConfig{
			Model:            geminiModel,
			MaxTokens:        maxTokens,
			Temperature:      0.4,
			ContextTurns:     3,
			CompressionLevel: "standard",
			CostTier:         costTier,
			EstimatedCostIDR: costIDR,
		}

	case TaskOutlineGeneration:
		return RoutedConfig{
			Model:            geminiModel,
			MaxTokens:        2048,
			Temperature:      0.4,
			ContextTurns:     2,
			CompressionLevel: "standard",
			CostTier:         "medium",
			EstimatedCostIDR: 8.5,
		}

	case TaskChapterDrafting:
		maxTokens := 2048
		if isLowTokenBudget {
			maxTokens = 1200
		}
		return RoutedConfig{
			Model:            geminiModel,
			MaxTokens:        maxTokens,
			Temperature:      0.7,
			ContextTurns:     4,
			CompressionLevel: "standard",
			CostTier:         "medium",
			EstimatedCostIDR: 9.2,
		}

	default:
		return RoutedConfig{
			Model:            geminiModel,
			MaxTokens:        800,
			Temperature:      0.7,
			ContextTurns:     4,
			CompressionLevel: "standard",
			CostTier:         "ultra_low",
			EstimatedCostIDR: 2.5,
		}
	}
}

// CompressPrompt aggressively compresses prompt text by removing extra whitespaces, duplicate newlines, and truncating length.
func CompressPrompt(text string, level string) string {
	if level == "verbatim" || len(text) == 0 {
		return text
	}

	lines := strings.Split(text, "\n")
	var cleaned []string
	for _, l := range lines {
		trimmed := strings.TrimSpace(l)
		if trimmed != "" {
			cleaned = append(cleaned, trimmed)
		}
	}
	result := strings.Join(cleaned, "\n")

	if level == "aggressive" && len(result) > 2500 {
		return result[:2500] + "..."
	}
	return result
}
