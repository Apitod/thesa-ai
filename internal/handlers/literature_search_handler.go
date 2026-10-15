package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"risethub_os/backend/internal/agent"
)

// LiteratureSearchHandler queries PubMed directly; it never returns a seeded catalogue.
type LiteratureSearchHandler struct{ client *agent.PubMedClient }

func NewLiteratureSearchHandler() *LiteratureSearchHandler {
	c := agent.NewPubMedClient("thesa@risethub.com")
	c.SetTimeout(15 * time.Second)
	return &LiteratureSearchHandler{client: c}
}
func (h *LiteratureSearchHandler) Search(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", 405)
		return
	}
	if _, ok := currentUserID(r); !ok {
		writeJSON(w, 401, map[string]string{"message": "Silakan masuk terlebih dahulu."})
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(query) < 3 || len(query) > 500 {
		writeJSON(w, 400, map[string]string{"message": "Kata kunci harus 3–500 karakter."})
		return
	}
	papers, err := h.client.SearchPapers(query, 10)
	if err != nil {
		log.Printf("[Thesa Literature] PubMed search failed for query %q: %v", query, err)
		writeJSON(w, 503, map[string]string{"code": "literature_unavailable", "message": fmt.Sprintf("PubMed belum dapat dihubungi: %v", err)})
		return
	}
	out := make([]map[string]any, 0, len(papers))
	for _, p := range papers {
		out = append(out, map[string]any{"id": "pmid-" + p.PMID, "pmid": p.PMID, "title": p.Title, "authors": strings.Join(p.Authors, ", "), "year": p.Year, "journal": p.Journal, "doi": p.DOI, "url": fmt.Sprintf("https://pubmed.ncbi.nlm.nih.gov/%s/", p.PMID), "type": "pubmed", "citation": citation(p.Authors, p.Year)})
	}
	writeJSON(w, 200, map[string]any{"source": "PubMed", "query": query, "papers": out})
}
func citation(authors []string, year int) string {
	if len(authors) == 0 {
		return fmt.Sprintf("(%d)", year)
	}
	surname := strings.Fields(authors[0])
	if len(surname) == 0 {
		return fmt.Sprintf("(%d)", year)
	}
	if len(authors) > 2 {
		return fmt.Sprintf("(%s et al., %d)", surname[0], year)
	}
	return fmt.Sprintf("(%s, %d)", surname[0], year)
}
