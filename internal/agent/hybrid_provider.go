package agent

import (
	"log"
	"os"
	"strings"
	"time"

	"risethub_os/backend/internal/db"
)

// HybridProvider wraps DeepSeek and Google Gemini providers with zero-downtime auto-failover and usage logging.
type HybridProvider struct {
	deepseekProvider *DeepSeekProvider
	geminiProvider   *GeminiProvider
	primaryProvider  string
}

// NewHybridProvider initializes the hybrid LLM provider with failover capability.
func NewHybridProvider() *HybridProvider {
	primary := strings.ToLower(os.Getenv("AI_PRIMARY_PROVIDER"))
	if primary != "gemini" {
		primary = "deepseek"
	}

	return &HybridProvider{
		deepseekProvider: NewDeepSeekProvider(),
		geminiProvider:   NewGeminiProvider(),
		primaryProvider:  primary,
	}
}

// Name returns the provider identifier.
func (h *HybridProvider) Name() string {
	return "hybrid (" + h.primaryProvider + " primary)"
}

// Chat executes a chat completion using primary provider, automatically failing over to secondary if an error occurs.
func (h *HybridProvider) Chat(messages []Message, config ProviderConfig) (string, error) {
	start := time.Now()

	// Determine primary & secondary configuration
	deepseekKey := os.Getenv("DEEPSEEK_API_KEY")
	geminiKey := os.Getenv("GEMINI_API_KEY")

	var primaryProvider, secondaryProvider AIProvider
	var primaryConfig, secondaryConfig ProviderConfig

	if h.primaryProvider == "gemini" {
		primaryProvider = h.geminiProvider
		primaryConfig = ProviderConfig{
			Provider:  "gemini",
			Model:     getEnvOrDefault("GEMINI_MODEL", "gemini-1.5-flash"),
			APIKey:    geminiKey,
			MaxTokens: config.MaxTokens,
			Extra:     config.Extra,
		}

		secondaryProvider = h.deepseekProvider
		secondaryConfig = ProviderConfig{
			Provider:  "deepseek",
			Model:     getEnvOrDefault("DEEPSEEK_MODEL", "deepseek-chat"),
			APIKey:    deepseekKey,
			MaxTokens: config.MaxTokens,
			Extra:     config.Extra,
		}
	} else {
		primaryProvider = h.deepseekProvider
		primaryConfig = ProviderConfig{
			Provider:  "deepseek",
			Model:     getEnvOrDefault("DEEPSEEK_MODEL", "deepseek-chat"),
			APIKey:    deepseekKey,
			MaxTokens: config.MaxTokens,
			Extra:     config.Extra,
		}

		secondaryProvider = h.geminiProvider
		secondaryConfig = ProviderConfig{
			Provider:  "gemini",
			Model:     getEnvOrDefault("GEMINI_MODEL", "gemini-1.5-flash"),
			APIKey:    geminiKey,
			MaxTokens: config.MaxTokens,
			Extra:     config.Extra,
		}
	}

	// 1. Try Primary Provider if API key is present
	if primaryConfig.APIKey != "" && !strings.HasPrefix(primaryConfig.APIKey, "sk-demo") && !strings.HasPrefix(primaryConfig.APIKey, "AIzaSyDemo") {
		resp, err := primaryProvider.Chat(messages, primaryConfig)
		latency := int(time.Since(start).Milliseconds())
		if err == nil && resp != "" {
			h.logUsage(primaryConfig.Provider, primaryConfig.Model, messages, resp, latency, "success", "")
			return resp, nil
		}
		log.Printf("[Thesa LLM Router] Primary provider (%s) encountered issue: %v. Initiating auto-failover...", primaryConfig.Provider, err)
		h.logUsage(primaryConfig.Provider, primaryConfig.Model, messages, "", latency, "failover", err.Error())
	}

	// 2. Auto-Failover to Secondary Provider
	if secondaryConfig.APIKey != "" && !strings.HasPrefix(secondaryConfig.APIKey, "sk-demo") && !strings.HasPrefix(secondaryConfig.APIKey, "AIzaSyDemo") {
		secStart := time.Now()
		resp, err := secondaryProvider.Chat(messages, secondaryConfig)
		latency := int(time.Since(secStart).Milliseconds())
		if err == nil && resp != "" {
			log.Printf("[Thesa LLM Router] Failover to secondary provider (%s) succeeded in %dms.", secondaryConfig.Provider, latency)
			h.logUsage(secondaryConfig.Provider, secondaryConfig.Model, messages, resp, latency, "success_failover", "")
			return resp, nil
		}
		log.Printf("[Thesa LLM Router] Secondary provider (%s) also encountered issue: %v.", secondaryConfig.Provider, err)
		h.logUsage(secondaryConfig.Provider, secondaryConfig.Model, messages, "", latency, "failed", err.Error())
	}

	// 3. Graceful Fallback Mock / Academic Reasoning Engine (Never break user experience in sandbox/demo)
	log.Println("[Thesa LLM Router] Running in resilient fallback mode.")
	fallbackResponse := h.generateResilientMock(messages)
	h.logUsage("fallback_engine", "thesa-academic-core", messages, fallbackResponse, int(time.Since(start).Milliseconds()), "fallback_mock", "")
	return fallbackResponse, nil
}

// logUsage records token consumption and performance metrics to MySQL database if connected.
func (h *HybridProvider) logUsage(provider, model string, messages []Message, response string, latencyMs int, status, errMsg string) {
	if db.DB == nil {
		return
	}

	// Estimate token counts
	promptChars := 0
	for _, m := range messages {
		promptChars += len(m.Content)
	}
	promptTokens := promptChars / 4
	completionTokens := len(response) / 4
	totalTokens := promptTokens + completionTokens

	// Estimate cost in IDR (Approx Rp 2.5 per 1,000 tokens for DeepSeek/Flash)
	costIDR := float64(totalTokens) * 0.0025

	go func() {
		query := `INSERT INTO llm_usage_logs (user_id, provider, model, task_type, prompt_tokens, completion_tokens, total_tokens, latency_ms, cost_idr, status, error_message)
		          VALUES (?, ?, ?, 'chat_completion', ?, ?, ?, ?, ?, ?, ?)`
		_, err := db.DB.Exec(query, 1, provider, model, promptTokens, completionTokens, totalTokens, latencyMs, costIDR, status, errMsg)
		if err != nil {
			log.Printf("[Thesa LLM Telemetry] Could not record usage log: %v", err)
		}
	}()
}

// generateResilientMock produces context-aware socratic academic responses when external APIs are unreachable.
func (h *HybridProvider) generateResilientMock(messages []Message) string {
	lastMsg := ""
	if len(messages) > 0 {
		lastMsg = strings.ToLower(messages[len(messages)-1].Content)
	}

	if strings.Contains(lastMsg, "latar belakang") || strings.Contains(lastMsg, "1.1") {
		return "Kajian ini berfokus pada urgensi fenomena empiris yang relevan dengan perkembangan kontemporer. Berdasarkan sintesis teori dan temuan di lapangan, penataan kerangka konseptual yang kokoh menjadi syarat mutlak dalam memetakan akar permasalahan secara terukur."
	}
	if strings.Contains(lastMsg, "rumusan masalah") || strings.Contains(lastMsg, "1.2") {
		return "1. Bagaimana karakteristik dan determinan utama yang mempengaruhi dinamika permasalahan ini di lapangan?\n2. Bagaimana efektivitas implementasi intervensi strategis dalam menjawab tantangan tersebut secara berkelanjutan?"
	}
	if strings.Contains(lastMsg, "pembahasan") || strings.Contains(lastMsg, "bab 2") {
		return "2.1 Tinjauan Teori & Kerangka Analisis\nLandasan teoretis menegaskan perlunya sinkronisasi antara kebijakan dan eksekusi operasional. Temuan empiris mengonfirmasi bahwa transparansi tata kelola serta adopsi teknologi menjadi katalis kunci dalam mencapai efisiensi terukur."
	}
	if strings.Contains(lastMsg, "kesimpulan") || strings.Contains(lastMsg, "bab 3") {
		return "3.1 Kesimpulan\nAnalisis komprehensif membuktikan bahwa integrasi strategi terarah mampu menjawab tantangan riset secara signifikan.\n\n3.2 Saran\nDisarankan bagi para pemangku kepentingan untuk memperkuat standarisasi prosedur operasional serta melakukan monitoring berkala."
	}

	return "Analisis akademik menunjukkan perlunya penajaman metodologis dan integrasi rujukan literatur terkini guna memastikan validitas temuan yang dipertanggungjawabkan secara ilmiah."
}

func getEnvOrDefault(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
