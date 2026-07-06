package agent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// DeepSeekProvider implements AIProvider for DeepSeek's API.
type DeepSeekProvider struct {
	httpClient *http.Client
}

// ChatRequest is the JSON payload sent to the DeepSeek API.
type deepSeekChatRequest struct {
	Model       string           `json:"model"`
	Messages    []deepSeekMsg    `json:"messages"`
	MaxTokens   int              `json:"max_tokens,omitempty"`
	Temperature float64          `json:"temperature,omitempty"`
	Stream      bool             `json:"stream"`
}

type deepSeekMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type deepSeekChatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// NewDeepSeekProvider creates a new DeepSeek provider.
func NewDeepSeekProvider() *DeepSeekProvider {
	return &DeepSeekProvider{
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}
}

// Chat sends messages to DeepSeek and returns the response text.
func (p *DeepSeekProvider) Chat(messages []Message, config ProviderConfig) (string, error) {
	apiKey := config.APIKey
	if apiKey == "" {
		return "", fmt.Errorf("DeepSeekProvider: API key not set")
	}

	model := config.Model
	if model == "" {
		model = "deepseek-chat"
	}

	maxTokens := config.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 2048
	}

	temperature := 0.7
	if config.Extra != nil {
		if t, ok := config.Extra["temperature"]; ok {
			fmt.Sscanf(t, "%f", &temperature)
		}
	}

	// Convert messages
	apiMessages := make([]deepSeekMsg, 0, len(messages))
	for _, m := range messages {
		apiMessages = append(apiMessages, deepSeekMsg{
			Role:    m.Role,
			Content: m.Content,
		})
	}

	reqBody := deepSeekChatRequest{
		Model:       model,
		Messages:    apiMessages,
		MaxTokens:   maxTokens,
		Temperature: temperature,
		Stream:      false,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("DeepSeekProvider: marshal request: %w", err)
	}

	apiURL := "https://api.deepseek.com/chat/completions"
	httpReq, err := http.NewRequest("POST", apiURL, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("DeepSeekProvider: create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("DeepSeekProvider: http call: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("DeepSeekProvider: read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("DeepSeekProvider: API returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var chatResp deepSeekChatResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		return "", fmt.Errorf("DeepSeekProvider: parse response: %w", err)
	}

	if chatResp.Error != nil {
		return "", fmt.Errorf("DeepSeekProvider: API error: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		return "", fmt.Errorf("DeepSeekProvider: no choices in response")
	}

	return chatResp.Choices[0].Message.Content, nil
}

// Name returns the provider name.
func (p *DeepSeekProvider) Name() string {
	return "deepseek"
}
