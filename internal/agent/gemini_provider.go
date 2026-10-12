package agent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// GeminiProvider implements AIProvider for Google's Gemini API.
type GeminiProvider struct {
	httpClient *http.Client
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiContent struct {
	Role  string       `json:"role"` // "user" or "model"
	Parts []geminiPart `json:"parts"`
}

type geminiGenerationConfig struct {
	Temperature     float64 `json:"temperature,omitempty"`
	MaxOutputTokens int     `json:"maxOutputTokens,omitempty"`
}

type geminiChatRequest struct {
	Contents         []geminiContent        `json:"contents"`
	GenerationConfig geminiGenerationConfig `json:"generationConfig,omitempty"`
}

type geminiChatResponse struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
			Role string `json:"role"`
		} `json:"content"`
		FinishReason string `json:"finishReason"`
	} `json:"candidates"`
	UsageMetadata struct {
		PromptTokenCount     int `json:"promptTokenCount"`
		CandidatesTokenCount int `json:"candidatesTokenCount"`
		TotalTokenCount      int `json:"totalTokenCount"`
	} `json:"usageMetadata"`
	Error *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
	} `json:"error,omitempty"`
}

// NewGeminiProvider creates a new Google Gemini provider.
func NewGeminiProvider() *GeminiProvider {
	return &GeminiProvider{
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}
}

// Name returns the provider name.
func (p *GeminiProvider) Name() string {
	return "gemini"
}

// Chat sends messages to Gemini and returns the response text.
func (p *GeminiProvider) Chat(messages []Message, config ProviderConfig) (string, error) {
	apiKey := config.APIKey
	if apiKey == "" {
		return "", fmt.Errorf("GeminiProvider: API key not set")
	}

	model := strings.TrimSpace(config.Model)
	if model == "" || model == "gemini-1.5-flash" || model == "gemini-1.5-pro" {
		model = "gemini-2.5-flash"
	}

	maxTokens := config.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 1500
	} else if maxTokens > 2500 {
		maxTokens = 2500
	}

	temperature := 0.7
	if config.Extra != nil {
		if t, ok := config.Extra["temperature"]; ok {
			fmt.Sscanf(t, "%f", &temperature)
		}
	}

	// Optimize context turns for token economics
	optimizedMessages := optimizeContextWindow(messages)

	// Format messages for Gemini API
	contents := make([]geminiContent, 0, len(optimizedMessages))
	for _, m := range optimizedMessages {
		role := "user"
		if m.Role == "assistant" || m.Role == "model" {
			role = "model"
		}
		content := m.Content
		if len(content) > 4000 {
			content = content[:4000] + "... [Konteks diringkas untuk efisiensi token]"
		}
		contents = append(contents, geminiContent{
			Role: role,
			Parts: []geminiPart{
				{Text: content},
			},
		})
	}

	reqBody := geminiChatRequest{
		Contents: contents,
		GenerationConfig: geminiGenerationConfig{
			Temperature:     temperature,
			MaxOutputTokens: maxTokens,
		},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("GeminiProvider: marshal request: %w", err)
	}

	apiURL := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent", model)

	var respBody []byte
	var lastErr error

	// Retry loop with exponential backoff (up to 3 attempts)
	maxRetries := 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		httpReq, err := http.NewRequest("POST", apiURL, bytes.NewReader(body))
		if err != nil {
			return "", fmt.Errorf("GeminiProvider: create request: %w", err)
		}

		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("X-goog-api-key", apiKey)

		resp, err := p.httpClient.Do(httpReq)
		if err != nil {
			lastErr = fmt.Errorf("gemini http call attempt %d: %w", attempt, err)
			if attempt < maxRetries {
				time.Sleep(time.Duration(attempt) * 1200 * time.Millisecond)
				continue
			}
			break
		}

		respBody, err = io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("gemini read response attempt %d: %w", attempt, err)
			if attempt < maxRetries {
				time.Sleep(time.Duration(attempt) * 1000 * time.Millisecond)
				continue
			}
			break
		}

		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("Gemini API returned HTTP %d: %s", resp.StatusCode, string(respBody))
			if attempt < maxRetries {
				time.Sleep(time.Duration(attempt*attempt) * 1000 * time.Millisecond)
				continue
			}
			break
		}

		if resp.StatusCode != http.StatusOK {
			return "", fmt.Errorf("Gemini API returned HTTP %d: %s", resp.StatusCode, string(respBody))
		}

		// Success
		lastErr = nil
		break
	}

	if lastErr != nil {
		return "", fmt.Errorf("GeminiProvider: %w", lastErr)
	}

	var chatResp geminiChatResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		return "", fmt.Errorf("GeminiProvider: unmarshal response: %w", err)
	}

	if chatResp.Error != nil {
		return "", fmt.Errorf("Gemini API error (%d): %s", chatResp.Error.Code, chatResp.Error.Message)
	}

	if len(chatResp.Candidates) == 0 || len(chatResp.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("GeminiProvider: empty candidate response from API")
	}

	var sb strings.Builder
	for _, part := range chatResp.Candidates[0].Content.Parts {
		sb.WriteString(part.Text)
	}

	if sb.Len() == 0 {
		return "", fmt.Errorf("GeminiProvider: empty candidate response text from API")
	}

	return sb.String(), nil
}
