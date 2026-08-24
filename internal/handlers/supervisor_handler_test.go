package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"risethub_os/backend/internal/agent"
)

type mockAIProvider struct{}

func (m *mockAIProvider) Chat(messages []agent.Message, config agent.ProviderConfig) (string, error) {
	return `{"score": 88, "grade": "A", "feedback": "Mock feedback mantap", "critique": "Pertahankan argumen", "understood": true, "aspect_scores": {"logic": 88, "method": 86, "literature": 90, "oral": 88}}`, nil
}

func (m *mockAIProvider) StreamChat(messages []agent.Message, config agent.ProviderConfig, onChunk func(chunk string) error) error {
	return onChunk("Mock chunk")
}

func TestSupervisorHandler_ExaminerSimulate_Question(t *testing.T) {
	mockProv := &mockAIProvider{}
	sup := agent.NewAgentSupervisor(mockProv)
	h := NewSupervisorHandler(sup, mockProv)

	reqData := agent.ExaminerSimulateRequest{
		Mode:       "question",
		Document:   "Draf skripsi tentang transformasi digital...",
		Topic:      "Transformasi Digital",
		Difficulty: "standard",
		Turn:       1,
		Examiner: agent.ExaminerPersona{
			ID:        "ex1",
			Name:      "Prof. Dr. Hardi Santoso",
			Role:      "Ketua Penguji",
			FocusArea: "Teori & Novelty",
		},
	}

	body, _ := json.Marshal(reqData)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/supervisor/examiner-simulate", bytes.NewBuffer(body))
	rec := httptest.NewRecorder()

	h.ExaminerSimulate(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
}

func TestSupervisorHandler_ExaminerSimulate_Evaluate(t *testing.T) {
	mockProv := &mockAIProvider{}
	sup := agent.NewAgentSupervisor(mockProv)
	h := NewSupervisorHandler(sup, mockProv)

	reqData := agent.ExaminerSimulateRequest{
		Mode:       "evaluate",
		Topic:      "Transformasi Digital",
		Difficulty: "standard",
		Turn:       1,
		Examiner: agent.ExaminerPersona{
			ID:        "ex1",
			Name:      "Prof. Dr. Hardi Santoso",
			Role:      "Ketua Penguji",
			FocusArea: "Teori & Novelty",
		},
		Question: "Bagaimana Anda memvalidasi sampel penelitian?",
		Answer:   "Kami menggunakan teknik purposive sampling dengan kriteria inklusi ketat dan uji reliabilitas Cronbach Alpha di atas 0.8.",
	}

	body, _ := json.Marshal(reqData)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/supervisor/examiner-simulate", bytes.NewBuffer(body))
	rec := httptest.NewRecorder()

	h.ExaminerSimulate(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var resp agent.ExaminerSimulateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse evaluate response: %v", err)
	}

	if resp.Score < 50 {
		t.Errorf("expected score >= 50, got %d", resp.Score)
	}
}
