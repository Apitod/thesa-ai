package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"risethub_os/backend/internal/db"
)

// ProjectHandler persists the actual workspace state for the authenticated user.
type ProjectHandler struct{}

func NewProjectHandler() *ProjectHandler { return &ProjectHandler{} }

type projectRequest struct {
	ProjectID int             `json:"project_id"`
	Title     string          `json:"title"`
	Topic     string          `json:"topic"`
	Stage     int             `json:"current_stage"`
	State     json.RawMessage `json:"state"`
}
type projectRow struct {
	ID           int    `db:"id" json:"id"`
	Title        string `db:"title" json:"title"`
	Topic        string `db:"topic" json:"topic"`
	CurrentStage int    `db:"current_stage" json:"current_stage"`
	UpdatedAt    string `db:"updated_at" json:"updated_at"`
}

func currentUserID(r *http.Request) (int, bool) {
	u, ok := ValidateUserSession(extractBearerToken(r))
	if !ok || u == nil {
		return 0, false
	}
	return u.ID, true
}
func decodeProject(w http.ResponseWriter, r *http.Request) (projectRequest, bool) {
	var req projectRequest
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	d.DisallowUnknownFields()
	if err := d.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Data proyek tidak valid."})
		return req, false
	}
	req.Title, req.Topic = strings.TrimSpace(req.Title), strings.TrimSpace(req.Topic)
	if req.Title == "" || len(req.Title) > 255 || len(req.Topic) > 8000 || !json.Valid(req.State) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Judul, topik, atau state proyek tidak valid."})
		return req, false
	}
	if req.Stage < 1 || req.Stage > 20 {
		req.Stage = 1
	}
	return req, true
}
func (h *ProjectHandler) Create(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := currentUserID(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Silakan masuk terlebih dahulu."})
		return
	}
	req, ok := decodeProject(w, r)
	if !ok {
		return
	}
	if db.DB == nil {
		writeJSON(w, 503, map[string]string{"message": "Penyimpanan proyek belum tersedia."})
		return
	}
	tx, err := db.DB.Beginx()
	if err != nil {
		writeJSON(w, 500, map[string]string{"message": "Gagal memulai penyimpanan proyek."})
		return
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO research_projects (user_id,title,topic,current_stage) VALUES (?,?,?,?)`, userID, req.Title, req.Topic, req.Stage)
	if err != nil {
		writeJSON(w, 500, map[string]string{"message": "Gagal membuat proyek."})
		return
	}
	id64, _ := result.LastInsertId()
	if _, err = tx.Exec(`INSERT INTO version_snapshots (project_id,stage,version,data_json,label) VALUES (?, 'workspace', 1, ?, 'Dibuat')`, id64, string(req.State)); err != nil {
		writeJSON(w, 500, map[string]string{"message": "Gagal menyimpan isi proyek."})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"message": "Gagal menyimpan proyek."})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"project_id": id64})
}
func (h *ProjectHandler) Save(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}
	userID, ok := currentUserID(r)
	if !ok {
		writeJSON(w, 401, map[string]string{"message": "Silakan masuk terlebih dahulu."})
		return
	}
	req, ok := decodeProject(w, r)
	if !ok {
		return
	}
	if req.ProjectID < 1 {
		writeJSON(w, 400, map[string]string{"message": "project_id wajib diisi."})
		return
	}
	if db.DB == nil {
		writeJSON(w, 503, map[string]string{"message": "Penyimpanan proyek belum tersedia."})
		return
	}
	tx, err := db.DB.Beginx()
	if err != nil {
		writeJSON(w, 500, map[string]string{"message": "Gagal menyimpan proyek."})
		return
	}
	defer tx.Rollback()
	var exists int
	if err = tx.Get(&exists, `SELECT COUNT(*) FROM research_projects WHERE id=? AND user_id=?`, req.ProjectID, userID); err != nil || exists == 0 {
		writeJSON(w, 404, map[string]string{"message": "Proyek tidak ditemukan."})
		return
	}
	if _, err = tx.Exec(`UPDATE research_projects SET title=?,topic=?,current_stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`, req.Title, req.Topic, req.Stage, req.ProjectID, userID); err != nil {
		writeJSON(w, 500, map[string]string{"message": "Gagal menyimpan proyek."})
		return
	}
	var next int
	if err = tx.Get(&next, `SELECT COALESCE(MAX(version),0)+1 FROM version_snapshots WHERE project_id=?`, req.ProjectID); err != nil {
		writeJSON(w, 500, map[string]string{"message": "Gagal membuat versi proyek."})
		return
	}
	if _, err = tx.Exec(`INSERT INTO version_snapshots (project_id,stage,version,data_json,label) VALUES (?, 'workspace', ?, ?, 'Pembaruan otomatis')`, req.ProjectID, next, string(req.State)); err != nil {
		writeJSON(w, 500, map[string]string{"message": "Gagal menyimpan isi proyek."})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"message": "Gagal menyimpan proyek."})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "version": next})
}
func (h *ProjectHandler) List(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", 405)
		return
	}
	userID, ok := currentUserID(r)
	if !ok {
		writeJSON(w, 401, map[string]string{"message": "Silakan masuk terlebih dahulu."})
		return
	}
	if db.DB == nil {
		writeJSON(w, 503, map[string]string{"message": "Penyimpanan proyek belum tersedia."})
		return
	}
	var rows []projectRow
	err := db.DB.Select(&rows, `SELECT id,title,topic,current_stage,DATE_FORMAT(updated_at,'%Y-%m-%dT%H:%i:%sZ') updated_at FROM research_projects WHERE user_id=? ORDER BY updated_at DESC LIMIT 50`, userID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"message": "Gagal memuat proyek."})
		return
	}
	writeJSON(w, 200, map[string]any{"projects": rows})
}
func (h *ProjectHandler) Get(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", 405)
		return
	}
	userID, ok := currentUserID(r)
	if !ok {
		writeJSON(w, 401, map[string]string{"message": "Silakan masuk terlebih dahulu."})
		return
	}
	id, err := strconv.Atoi(r.URL.Query().Get("id"))
	if err != nil || id < 1 {
		writeJSON(w, 400, map[string]string{"message": "ID proyek tidak valid."})
		return
	}
	if db.DB == nil {
		writeJSON(w, 503, map[string]string{"message": "Penyimpanan proyek belum tersedia."})
		return
	}
	var p projectRow
	if err = db.DB.Get(&p, `SELECT id,title,topic,current_stage,DATE_FORMAT(updated_at,'%Y-%m-%dT%H:%i:%sZ') updated_at FROM research_projects WHERE id=? AND user_id=?`, id, userID); err != nil {
		writeJSON(w, 404, map[string]string{"message": "Proyek tidak ditemukan."})
		return
	}
	var state string
	_ = db.DB.Get(&state, `SELECT data_json FROM version_snapshots WHERE project_id=? AND stage='workspace' ORDER BY version DESC LIMIT 1`, id)
	if !json.Valid([]byte(state)) {
		state = `{}`
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"project": p, "state": json.RawMessage(state)})
}
