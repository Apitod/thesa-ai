package agent

import (
	"fmt"
	"log"
	"os"
	"time"

	"risethub_os/backend/internal/db"
)

// HybridProvider is retained for compatibility with existing agents. Thesa uses
// Gemini only: academic context must never be silently sent to another provider.
type HybridProvider struct{ geminiProvider *GeminiProvider }

func NewHybridProvider() *HybridProvider { return &HybridProvider{geminiProvider: NewGeminiProvider()} }
func (h *HybridProvider) Name() string   { return "gemini" }

// Chat returns provider failures to callers. It intentionally has no mock or
// secondary-provider fallback, so every displayed draft is model output.
func (h *HybridProvider) Chat(messages []Message, config ProviderConfig) (string, error) {
	start := time.Now()
	cfg := ProviderConfig{Provider: "gemini", Model: getEnvOrDefault("GEMINI_MODEL", "gemini-2.5-flash"), APIKey: os.Getenv("GEMINI_API_KEY"), MaxTokens: config.MaxTokens, Extra: config.Extra}
	if cfg.APIKey == "" || cfg.APIKey == "your_gemini_api_key_here" {
		err := fmt.Errorf("Gemini API key belum dikonfigurasi")
		h.logUsage("gemini", cfg.Model, messages, "", int(time.Since(start).Milliseconds()), "failed", err.Error())
		return "", err
	}
	response, err := h.geminiProvider.Chat(messages, cfg)
	latency := int(time.Since(start).Milliseconds())
	if err != nil || response == "" {
		if err == nil {
			err = fmt.Errorf("Gemini mengembalikan respons kosong")
		}
		log.Printf("[Thesa Gemini] request failed: %v", err)
		h.logUsage("gemini", cfg.Model, messages, "", latency, "failed", err.Error())
		return "", err
	}
	h.logUsage("gemini", cfg.Model, messages, response, latency, "success", "")
	return response, nil
}

func (h *HybridProvider) logUsage(provider, model string, messages []Message, response string, latencyMs int, status, errMsg string) {
	if db.DB == nil {
		return
	}
	promptChars := 0
	for _, m := range messages {
		promptChars += len(m.Content)
	}
	promptTokens, completionTokens := promptChars/4, len(response)/4
	go func() {
		_, err := db.DB.Exec(`INSERT INTO llm_usage_logs (user_id, provider, model, task_type, prompt_tokens, completion_tokens, total_tokens, latency_ms, cost_idr, status, error_message)
			VALUES (?, ?, ?, 'chat_completion', ?, ?, ?, ?, ?, ?, ?)`, 1, provider, model, promptTokens, completionTokens, promptTokens+completionTokens, latencyMs, float64(promptTokens+completionTokens)*0.0025, status, errMsg)
		if err != nil {
			log.Printf("[Thesa LLM Telemetry] Could not record usage log: %v", err)
		}
	}()
}

func getEnvOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
