package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"risethub_os/backend/internal/agent"
)

type paperTestProvider struct {
	prompt string
	err    error
}

func (p *paperTestProvider) Name() string { return "gemini" }
func (p *paperTestProvider) Chat(messages []agent.Message, _ agent.ProviderConfig) (string, error) {
	p.prompt = messages[len(messages)-1].Content
	if p.err != nil {
		return "", p.err
	}
	return "Draf asli dari Gemini test.", nil
}

func TestPaperGenerationUsesResearchContextAndSelectedSources(t *testing.T) {
	login := httptest.NewRecorder()
	NewAuthHandler().Login(login, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{"email":"alif.awwaz@ui.ac.id","password":"thesa2026"}`)))
	var auth AuthResponse
	_ = json.Unmarshal(login.Body.Bytes(), &auth)
	p := &paperTestProvider{}
	body := `{"topic":"Dampak AI di pendidikan","importance":"perlu diteliti","expectations":"draf argumentatif","keywords":["AI"],"sources":[{"title":"Artikel terverifikasi","authors":"Sari","year":2024,"journal":"Jurnal Uji","doi":"10.1/test"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/paper/generate", bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer "+auth.Token)
	rec := httptest.NewRecorder()
	NewPaperHandler(p).Generate(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains([]byte(p.prompt), []byte("Dampak AI di pendidikan")) || !bytes.Contains([]byte(p.prompt), []byte("Artikel terverifikasi")) {
		t.Fatalf("research context/sources were not included in prompt: %s", p.prompt)
	}
}
