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
	Model       string        `json:"model"`
	Messages    []deepSeekMsg `json:"messages"`
	MaxTokens   int           `json:"max_tokens,omitempty"`
	Temperature float64       `json:"temperature,omitempty"`
	Stream      bool          `json:"stream"`
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
		maxTokens = 1500
	} else if maxTokens > 2500 {
		// Cap max output tokens to prevent runaway cost
		maxTokens = 2500
	}

	temperature := 0.7
	if config.Extra != nil {
		if t, ok := config.Extra["temperature"]; ok {
			fmt.Sscanf(t, "%f", &temperature)
		}
	}

	// Token Economy Optimization: Sliding Context Window (Keep System Prompt + Last 6 message turns max)
	optimizedMessages := optimizeContextWindow(messages)

	// Convert messages
	apiMessages := make([]deepSeekMsg, 0, len(optimizedMessages))
	for _, m := range optimizedMessages {
		content := m.Content
		// Compress individual turn content if it exceeds 4,000 characters
		if len(content) > 4000 {
			content = content[:4000] + "... [Ringkasan konteks otomatis untuk efisiensi token]"
		}
		apiMessages = append(apiMessages, deepSeekMsg{
			Role:    m.Role,
			Content: content,
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

	var respBody []byte
	var lastErr error

	// Retry loop with exponential backoff (up to 3 attempts) for transient errors (429, 500, 502, 503, 504)
	maxRetries := 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		httpReq, err := http.NewRequest("POST", apiURL, bytes.NewReader(body))
		if err != nil {
			return "", fmt.Errorf("DeepSeekProvider: create request: %w", err)
		}

		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)

		resp, err := p.httpClient.Do(httpReq)
		if err != nil {
			lastErr = fmt.Errorf("http call attempt %d: %w", attempt, err)
			if attempt < maxRetries {
				time.Sleep(time.Duration(attempt) * 1200 * time.Millisecond)
				continue
			}
			break
		}

		respBody, err = io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("read response attempt %d: %w", attempt, err)
			if attempt < maxRetries {
				time.Sleep(time.Duration(attempt) * 1000 * time.Millisecond)
				continue
			}
			break
		}

		// Handle transient rate limit (429) or server errors (500, 502, 503, 504)
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("API returned HTTP %d: %s", resp.StatusCode, string(respBody))
			if attempt < maxRetries {
				time.Sleep(time.Duration(attempt*attempt) * 1000 * time.Millisecond)
				continue
			}
			break
		}

		if resp.StatusCode != http.StatusOK {
			return "", fmt.Errorf("DeepSeekProvider: API returned HTTP %d: %s", resp.StatusCode, string(respBody))
		}

		// Success
		lastErr = nil
		break
	}

	if lastErr != nil {
		return "", fmt.Errorf("DeepSeekProvider failed after %d retries: %w", maxRetries, lastErr)
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

// optimizeContextWindow keeps the system message plus the most recent 6 conversational turns
// to protect profit margin from exponential token inflation.
func optimizeContextWindow(messages []Message) []Message {
	if len(messages) <= 7 {
		return messages
	}

	var systemMsgs []Message
	var convMsgs []Message

	for _, m := range messages {
		if m.Role == "system" {
			systemMsgs = append(systemMsgs, m)
		} else {
			convMsgs = append(convMsgs, m)
		}
	}

	// Keep last 6 conversation turns
	if len(convMsgs) > 6 {
		convMsgs = convMsgs[len(convMsgs)-6:]
	}

	result := make([]Message, 0, len(systemMsgs)+len(convMsgs))
	result = append(result, systemMsgs...)
	result = append(result, convMsgs...)
	return result
}
