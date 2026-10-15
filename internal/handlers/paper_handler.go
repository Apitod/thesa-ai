package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"risethub_os/backend/internal/agent"
)

type PaperHandler struct{ provider agent.AIProvider }

func NewPaperHandler(provider agent.AIProvider) *PaperHandler {
	return &PaperHandler{provider: provider}
}

type paperSource struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Authors  string `json:"authors"`
	Year     int    `json:"year"`
	Journal  string `json:"journal"`
	DOI      string `json:"doi"`
	PMID     string `json:"pmid"`
	URL      string `json:"url"`
	Citation string `json:"citation"`
	Type     string `json:"type"`
	Abstract string `json:"abstract"`
}
type generatePaperRequest struct {
	ProjectID        int           `json:"project_id"`
	Topic            string        `json:"topic"`
	Importance       string        `json:"importance"`
	Expectations     string        `json:"expectations"`
	AssignmentPrompt string        `json:"assignment_prompt"`
	Course           string        `json:"course"`
	KTIType          string        `json:"kti_type"`
	Keywords         []string      `json:"keywords"`
	Sources          []paperSource `json:"sources"`
}

func (h *PaperHandler) Generate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}
	if _, ok := currentUserID(r); !ok {
		writeJSON(w, 401, map[string]string{"message": "Silakan masuk terlebih dahulu."})
		return
	}
	var req generatePaperRequest
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10))
	if err := d.Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"message": "Permintaan generasi tidak valid: " + err.Error()})
		return
	}
	req.Topic = strings.TrimSpace(req.Topic)
	if req.Topic == "" || len(req.Topic) > 4000 || len(req.Sources) > 20 {
		writeJSON(w, 400, map[string]string{"message": "Topik atau daftar sumber tidak valid."})
		return
	}
	sources := make([]string, 0, len(req.Sources))
	for _, s := range req.Sources {
		if strings.TrimSpace(s.Title) == "" {
			continue
		}
		sources = append(sources, fmt.Sprintf("- %s — %s (%d), %s. DOI: %s; PMID: %s; URL: %s", s.Title, s.Authors, s.Year, s.Journal, s.DOI, s.PMID, s.URL))
	}
	prompt := fmt.Sprintf(`Tulis draf awal bagian "Latar Belakang" untuk %s akademik berbahasa Indonesia.
Topik: %s
Alasan penting: %s
Harapan pengguna: %s
Instruksi tugas: %s
Mata kuliah: %s
Kata kunci: %s
Sumber yang dipilih dan tervalidasi (boleh dikutip hanya jika relevan):
%s

Berikan 4–6 paragraf argumentatif. Bedakan fakta bersumber dari interpretasi, jangan mengarang sitasi atau data. Bila sumber tidak mendukung klaim, nyatakan keterbatasannya. Gunakan sitasi penulis-tahun hanya untuk sumber di atas.`, req.KTIType, req.Topic, req.Importance, req.Expectations, req.AssignmentPrompt, req.Course, strings.Join(req.Keywords, ", "), strings.Join(sources, "\n"))
	systemPrompt := "Anda adalah akademisi dan penulis karya ilmiah berstandar tinggi. Hasilkan langsung isi naskah draf akademik bagian 'Latar Belakang' tanpa kalimat pembuka obrolan, tanpa basa-basi pengantar ('Tentu, berikut...'), tanpa garis pemisah, dan tanpa penutup obrolan. Mulai langsung dari argumen paragraf pertama."
	result, err := h.provider.Chat([]agent.Message{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: prompt},
	}, agent.ProviderConfig{MaxTokens: 2048, Extra: map[string]string{"temperature": "0.45"}})
	if err != nil {
		writeJSON(w, 503, map[string]string{"code": "gemini_unavailable", "message": fmt.Sprintf("Gemini belum dapat menghasilkan draf: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"status": "generated", "provider": h.provider.Name(), "draft": strings.TrimSpace(result), "sources_used": len(sources)})
}
