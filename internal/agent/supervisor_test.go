package agent

import (
	"testing"
)

type testMockProvider struct{}

func (m *testMockProvider) Chat(messages []Message, config ProviderConfig) (string, error) {
	return `{"score": 90, "grade": "A", "feedback": "Argumen sangat solid", "critique": "None", "aspect_scores": {"logic": 90, "method": 90, "literature": 90, "oral": 90}}`, nil
}

func (m *testMockProvider) StreamChat(messages []Message, config ProviderConfig, onChunk func(chunk string) error) error {
	return onChunk("Test chunk")
}

func TestAgentSupervisor_SimulateExaminer(t *testing.T) {
	prov := &testMockProvider{}
	sup := NewAgentSupervisor(prov)

	cfg := ProviderConfig{
		Provider: "deepseek",
		Model:    "deepseek-chat",
	}

	req := ExaminerSimulateRequest{
		Mode:       "evaluate",
		Topic:      "Evaluasi Koherensi LLM",
		Difficulty: "standard",
		Turn:       1,
		Examiner: ExaminerPersona{
			ID:        "ex1",
			Name:      "Prof. Dr. Hardi Santoso",
			Role:      "Ketua Penguji",
			FocusArea: "Teori & Novelty",
		},
		Question: "Apa novelty utama riset ini?",
		Answer:   "Novelty riset ini terletak pada mekanisme cascade evaluation antar bab naskah.",
	}

	resp, err := sup.SimulateExaminer(req, cfg)
	if err != nil {
		t.Fatalf("SimulateExaminer failed: %v", err)
	}

	if resp.Score != 90 {
		t.Errorf("expected score 90, got %d", resp.Score)
	}
	if resp.Grade != "A" {
		t.Errorf("expected grade A, got %s", resp.Grade)
	}
}
