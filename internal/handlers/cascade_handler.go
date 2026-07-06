package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"risethub_os/backend/internal/agent"
)

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

type CascadeStateResponse struct {
	State *agent.ProjectState `json:"state,omitempty"`
	Error string              `json:"error,omitempty"`
}

type CascadeCalculateRequest struct {
	ProjectID    int    `json:"project_id"`
	ChangedStage string `json:"changed_stage"`
}

type CascadeCalculateResponse struct {
	Impacts []agent.CascadeImpact `json:"impacts,omitempty"`
	Error   string                `json:"error,omitempty"`
}

type CascadeSnapshotRequest struct {
	ProjectID int    `json:"project_id"`
	Stage     string `json:"stage"`
	Content   string `json:"content"`
	DataJSON  string `json:"data_json"`
	Label     string `json:"label"`
}

type CascadeSnapshotResponse struct {
	Snapshot *agent.VersionSnapshot `json:"snapshot,omitempty"`
	Error    string                 `json:"error,omitempty"`
}

type CascadeSnapshotsResponse struct {
	Snapshots []agent.VersionSnapshot `json:"snapshots,omitempty"`
	Error     string                  `json:"error,omitempty"`
}

type CascadeGetSnapshotResponse struct {
	Snapshot *agent.VersionSnapshot `json:"snapshot,omitempty"`
	Error    string                 `json:"error,omitempty"`
}

type CascadeRestoreResponse struct {
	Snapshot *agent.VersionSnapshot `json:"snapshot,omitempty"`
	Error    string                 `json:"error,omitempty"`
}

type CascadeDiffResponse struct {
	Diff  string `json:"diff,omitempty"`
	Error string `json:"error,omitempty"`
}

type CascadeExecuteRequest struct {
	ProjectID    int      `json:"project_id"`
	ChangedStage string   `json:"changed_stage"`
	AcceptStages []string `json:"accept_stages"`
}

type CascadeExecuteResponse struct {
	Status string `json:"status,omitempty"`
	Error  string `json:"error,omitempty"`
}

type CascadeLogResponse struct {
	Logs  []agent.StageLog `json:"logs,omitempty"`
	Error string           `json:"error,omitempty"`
}

// ---------------------------------------------------------------------------
// CascadeHandler
// ---------------------------------------------------------------------------

// CascadeHandler handles HTTP requests for cascade engine operations.
type CascadeHandler struct {
	engine *agent.CascadeEngine
}

// NewCascadeHandler creates a new CascadeHandler.
func NewCascadeHandler() *CascadeHandler {
	return &CascadeHandler{engine: agent.NewCascadeEngine()}
}

// ---------------------------------------------------------------------------
// GetState — GET /api/v1/cascade/state?project_id=X
// ---------------------------------------------------------------------------

// GetState returns the current project state including completed stages,
// modified stages, and cascade log.
func (h *CascadeHandler) GetState(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "GET" {
		json.NewEncoder(w).Encode(CascadeStateResponse{Error: "method not allowed"})
		return
	}

	projectID, err := strconv.Atoi(r.URL.Query().Get("project_id"))
	if err != nil || projectID <= 0 {
		json.NewEncoder(w).Encode(CascadeStateResponse{Error: "valid project_id is required"})
		return
	}

	state, err := h.engine.GetProjectState(projectID)
	if err != nil {
		log.Printf("Cascade GetState: %v", err)
		json.NewEncoder(w).Encode(CascadeStateResponse{Error: fmt.Sprintf("gagal mendapatkan state: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(CascadeStateResponse{State: state})
}

// ---------------------------------------------------------------------------
// Calculate — POST /api/v1/cascade/calculate
// ---------------------------------------------------------------------------

// Calculate determines what downstream stages are affected by a change.
func (h *CascadeHandler) Calculate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(CascadeCalculateResponse{Error: "method not allowed"})
		return
	}

	var req CascadeCalculateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(CascadeCalculateResponse{Error: "invalid request body"})
		return
	}

	if req.ProjectID <= 0 {
		json.NewEncoder(w).Encode(CascadeCalculateResponse{Error: "project_id is required"})
		return
	}
	if req.ChangedStage == "" {
		json.NewEncoder(w).Encode(CascadeCalculateResponse{Error: "changed_stage is required"})
		return
	}

	impacts := h.engine.CalculateCascade(req.ProjectID, req.ChangedStage)
	json.NewEncoder(w).Encode(CascadeCalculateResponse{Impacts: impacts})
}

// ---------------------------------------------------------------------------
// CreateSnapshot — POST /api/v1/cascade/snapshot
// ---------------------------------------------------------------------------

// CreateSnapshot saves a version snapshot of a project stage.
func (h *CascadeHandler) CreateSnapshot(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(CascadeSnapshotResponse{Error: "method not allowed"})
		return
	}

	var req CascadeSnapshotRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(CascadeSnapshotResponse{Error: "invalid request body"})
		return
	}

	if req.ProjectID <= 0 {
		json.NewEncoder(w).Encode(CascadeSnapshotResponse{Error: "project_id is required"})
		return
	}
	if req.Stage == "" {
		json.NewEncoder(w).Encode(CascadeSnapshotResponse{Error: "stage is required"})
		return
	}

	snapshot, err := h.engine.CreateSnapshot(req.ProjectID, req.Stage, req.Content, req.DataJSON, req.Label)
	if err != nil {
		log.Printf("Cascade CreateSnapshot: %v", err)
		json.NewEncoder(w).Encode(CascadeSnapshotResponse{Error: fmt.Sprintf("gagal membuat snapshot: %v", err)})
		return
	}

	// Log the snapshot creation
	h.engine.LogCascade(req.ProjectID, req.Stage, "snapshot", fmt.Sprintf("Snapshot v%d dibuat: %s", snapshot.Version, req.Label))

	json.NewEncoder(w).Encode(CascadeSnapshotResponse{Snapshot: snapshot})
}

// ---------------------------------------------------------------------------
// ListSnapshots — GET /api/v1/cascade/snapshots?project_id=X&stage=Y
// ---------------------------------------------------------------------------

// ListSnapshots returns all version snapshots for a project and stage.
func (h *CascadeHandler) ListSnapshots(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "GET" {
		json.NewEncoder(w).Encode(CascadeSnapshotsResponse{Error: "method not allowed"})
		return
	}

	projectID, err := strconv.Atoi(r.URL.Query().Get("project_id"))
	if err != nil || projectID <= 0 {
		json.NewEncoder(w).Encode(CascadeSnapshotsResponse{Error: "valid project_id is required"})
		return
	}

	stage := r.URL.Query().Get("stage")
	if stage == "" {
		json.NewEncoder(w).Encode(CascadeSnapshotsResponse{Error: "stage is required"})
		return
	}

	snapshots, err := h.engine.GetSnapshots(projectID, stage)
	if err != nil {
		log.Printf("Cascade ListSnapshots: %v", err)
		json.NewEncoder(w).Encode(CascadeSnapshotsResponse{Error: fmt.Sprintf("gagal mendapatkan snapshots: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(CascadeSnapshotsResponse{Snapshots: snapshots})
}

// ---------------------------------------------------------------------------
// GetSnapshot — GET /api/v1/cascade/snapshot/get?id=X
// ---------------------------------------------------------------------------

// GetSnapshot returns a single snapshot by ID.
func (h *CascadeHandler) GetSnapshot(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "GET" {
		json.NewEncoder(w).Encode(CascadeGetSnapshotResponse{Error: "method not allowed"})
		return
	}

	id, err := strconv.Atoi(r.URL.Query().Get("id"))
	if err != nil || id <= 0 {
		json.NewEncoder(w).Encode(CascadeGetSnapshotResponse{Error: "valid snapshot id is required"})
		return
	}

	snapshot, err := h.engine.RestoreSnapshot(id)
	if err != nil {
		log.Printf("Cascade GetSnapshot: %v", err)
		json.NewEncoder(w).Encode(CascadeGetSnapshotResponse{Error: fmt.Sprintf("gagal mendapatkan snapshot: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(CascadeGetSnapshotResponse{Snapshot: snapshot})
}

// ---------------------------------------------------------------------------
// RestoreSnapshot — POST /api/v1/cascade/restore?id=X
// ---------------------------------------------------------------------------

// RestoreSnapshot retrieves a snapshot by ID (can be used for restore).
func (h *CascadeHandler) RestoreSnapshot(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(CascadeRestoreResponse{Error: "method not allowed"})
		return
	}

	id, err := strconv.Atoi(r.URL.Query().Get("id"))
	if err != nil || id <= 0 {
		json.NewEncoder(w).Encode(CascadeRestoreResponse{Error: "valid snapshot id is required"})
		return
	}

	snapshot, err := h.engine.RestoreSnapshot(id)
	if err != nil {
		log.Printf("Cascade RestoreSnapshot: %v", err)
		json.NewEncoder(w).Encode(CascadeRestoreResponse{Error: fmt.Sprintf("gagal merestore snapshot: %v", err)})
		return
	}

	// Log the restore
	h.engine.LogCascade(snapshot.ProjectID, snapshot.Stage, "restored",
		fmt.Sprintf("Snapshot v%d (%s) direstore", snapshot.Version, snapshot.Label))

	json.NewEncoder(w).Encode(CascadeRestoreResponse{Snapshot: snapshot})
}

// ---------------------------------------------------------------------------
// GetDiff — GET /api/v1/cascade/diff?s1=ID&s2=ID
// ---------------------------------------------------------------------------

// GetDiff compares two snapshots and returns a diff description.
func (h *CascadeHandler) GetDiff(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "GET" {
		json.NewEncoder(w).Encode(CascadeDiffResponse{Error: "method not allowed"})
		return
	}

	s1, err := strconv.Atoi(r.URL.Query().Get("s1"))
	if err != nil || s1 <= 0 {
		json.NewEncoder(w).Encode(CascadeDiffResponse{Error: "valid s1 is required"})
		return
	}

	s2, err := strconv.Atoi(r.URL.Query().Get("s2"))
	if err != nil || s2 <= 0 {
		json.NewEncoder(w).Encode(CascadeDiffResponse{Error: "valid s2 is required"})
		return
	}

	diff, err := h.engine.GetDiff(s1, s2)
	if err != nil {
		log.Printf("Cascade GetDiff: %v", err)
		json.NewEncoder(w).Encode(CascadeDiffResponse{Error: fmt.Sprintf("gagal mendapatkan diff: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(CascadeDiffResponse{Diff: diff})
}

// ---------------------------------------------------------------------------
// Execute — POST /api/v1/cascade/execute
// ---------------------------------------------------------------------------

// Execute applies cascade changes to downstream stages.
func (h *CascadeHandler) Execute(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(CascadeExecuteResponse{Error: "method not allowed"})
		return
	}

	var req CascadeExecuteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(CascadeExecuteResponse{Error: "invalid request body"})
		return
	}

	if req.ProjectID <= 0 {
		json.NewEncoder(w).Encode(CascadeExecuteResponse{Error: "project_id is required"})
		return
	}
	if req.ChangedStage == "" {
		json.NewEncoder(w).Encode(CascadeExecuteResponse{Error: "changed_stage is required"})
		return
	}

	if err := h.engine.ExecuteCascade(req.ProjectID, req.ChangedStage, req.AcceptStages); err != nil {
		log.Printf("Cascade Execute: %v", err)
		json.NewEncoder(w).Encode(CascadeExecuteResponse{Error: fmt.Sprintf("gagal menjalankan cascade: %v", err)})
		return
	}

	// Log the cascade execution
	desc := fmt.Sprintf("Cascade dijalankan dari %s ke stage: %v", req.ChangedStage, req.AcceptStages)
	h.engine.LogCascade(req.ProjectID, req.ChangedStage, "cascaded", desc)

	json.NewEncoder(w).Encode(CascadeExecuteResponse{Status: "cascade executed"})
}

// ---------------------------------------------------------------------------
// GetLog — GET /api/v1/cascade/log?project_id=X
// ---------------------------------------------------------------------------

// GetLog returns the cascade log for a project.
func (h *CascadeHandler) GetLog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "GET" {
		json.NewEncoder(w).Encode(CascadeLogResponse{Error: "method not allowed"})
		return
	}

	projectID, err := strconv.Atoi(r.URL.Query().Get("project_id"))
	if err != nil || projectID <= 0 {
		json.NewEncoder(w).Encode(CascadeLogResponse{Error: "valid project_id is required"})
		return
	}

	logs, err := h.engine.GetCascadeLog(projectID)
	if err != nil {
		log.Printf("Cascade GetLog: %v", err)
		json.NewEncoder(w).Encode(CascadeLogResponse{Error: fmt.Sprintf("gagal mendapatkan log: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(CascadeLogResponse{Logs: logs})
}
