package agent

// Message represents a single message in a chat conversation.
type Message struct {
	Role    string
	Content string
}

// ProviderConfig holds configuration for an AI provider call.
type ProviderConfig struct {
	Provider  string
	Model     string
	APIKey    string
	MaxTokens int
	Extra     map[string]string
}

// AIProvider is the interface for interacting with AI language models.
type AIProvider interface {
	// Chat sends a chat request and returns the response text.
	Chat(messages []Message, config ProviderConfig) (string, error)

	// Name returns the provider name (e.g., "deepseek", "gemini").
	Name() string
}
