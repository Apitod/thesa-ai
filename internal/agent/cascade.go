package agent

import (
	"fmt"
	"time"

	"risethub_os/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// CascadeMatrix defines impacts between stages
type CascadeMatrix struct {
	Source   string   `json:"source"`
	Targets  []string `json:"targets"`  // stages affected when source changes
	Severity string   `json:"severity"` // "low"|"medium"|"high"
}

// ProjectState represents the current state of a project
type ProjectState struct {
	ProjectID       int               `json:"project_id"`
	CurrentStage    string            `json:"current_stage"`
	CompletedStages []string          `json:"completed_stages"`
	ModifiedStages  []string          `json:"modified_stages"`
	CascadeLog      []CascadeLogEntry `json:"cascade_log"`
}

// CascadeLogEntry is a single entry in the cascade log
type CascadeLogEntry struct {
	Timestamp   time.Time `json:"timestamp"`
	SourceStage string    `json:"source_stage"`
	Action      string    `json:"action"` // "modified"|"cascaded"|"restored"
	Description string    `json:"description"`
}

// CascadeImpact describes how a change affects a downstream stage
type CascadeImpact struct {
	TargetStage string `json:"target_stage"`
	Severity    string `json:"severity"`
	Message     string `json:"message"`
	NeedsReview bool   `json:"needs_review"`
}

// VersionSnapshot is a saved version of a stage
type VersionSnapshot struct {
	ID        int       `json:"id"`
	ProjectID int       `json:"project_id"`
	Stage     string    `json:"stage"`
	Version   int       `json:"version"`
	Content   string    `json:"content"`
	DataJSON  string    `json:"data_json"`
	Label     string    `json:"label"`
	CreatedAt time.Time `json:"created_at"`
}

// StageLog is a cascade log entry from the database
type StageLog struct {
	ID          int       `json:"id"`
	ProjectID   int       `json:"project_id"`
	SourceStage string    `json:"source_stage"`
	Action      string    `json:"action"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

// ---------------------------------------------------------------------------
// CascadeEngine
// ---------------------------------------------------------------------------

// CascadeEngine provides cascade logic and version snapshot management.
type CascadeEngine struct{}

// NewCascadeEngine creates a new CascadeEngine
func NewCascadeEngine() *CascadeEngine {
	return &CascadeEngine{}
}

// GetCascadeMatrix returns the predefined cascade matrix defining which
// stages are affected when a source stage changes.
func (e *CascadeEngine) GetCascadeMatrix() []CascadeMatrix {
	return []CascadeMatrix{
		{Source: "topic", Targets: []string{"literature", "outline", "writing", "exercise"}, Severity: "high"},
		{Source: "literature", Targets: []string{"outline", "writing", "exercise"}, Severity: "medium"},
		{Source: "template", Targets: []string{"outline"}, Severity: "medium"},
		{Source: "outline", Targets: []string{"writing", "exercise"}, Severity: "high"},
		{Source: "writing", Targets: []string{"exercise"}, Severity: "low"},
		{Source: "exercise", Targets: []string{}, Severity: "low"},
	}
}

// stageNames maps integer stage IDs to their string representation
var stageNames = map[int]string{
	1: "topic",
	2: "literature",
	3: "outline",
	4: "writing",
	5: "exercise",
}

// GetProjectState retrieves the current project state from the database.
func (e *CascadeEngine) GetProjectState(projectID int) (*ProjectState, error) {
	state := &ProjectState{ProjectID: projectID}

	if db.DB == nil || !db.IsConnected() {
		state.CurrentStage = "topic"
		state.CompletedStages = []string{"topic", "literature"}
		return state, nil
	}

	// Get current_stage from research_projects (INT)
	var currentStageInt int
	err := db.DB.Get(&currentStageInt, "SELECT current_stage FROM research_projects WHERE id=?", projectID)
	if err != nil {
		currentStageInt = 1
	}

	if name, ok := stageNames[currentStageInt]; ok {
		state.CurrentStage = name
	} else {
		state.CurrentStage = fmt.Sprintf("unknown(%d)", currentStageInt)
	}

	// Load completed stages
	type stageRow struct {
		Stage  string `db:"stage"`
		Status string `db:"status"`
	}
	var stages []stageRow
	err = db.DB.Select(&stages, "SELECT stage, status FROM project_stages WHERE project_id=?", projectID)
	if err == nil {
		for _, s := range stages {
			state.CompletedStages = append(state.CompletedStages, s.Stage)
			if s.Status == "needs_review" {
				state.ModifiedStages = append(state.ModifiedStages, s.Stage)
			}
		}
	}

	// Load cascade log
	logs, err := e.GetCascadeLog(projectID)
	if err == nil {
		for _, l := range logs {
			state.CascadeLog = append(state.CascadeLog, CascadeLogEntry{
				Timestamp:   l.CreatedAt,
				SourceStage: l.SourceStage,
				Action:      l.Action,
				Description: l.Description,
			})
		}
	}

	return state, nil
}

// CalculateCascade determines what downstream stages are affected when a
// given stage changes.
func (e *CascadeEngine) CalculateCascade(projectID int, changedStage string) []CascadeImpact {
	var impacts []CascadeImpact
	for _, matrix := range e.GetCascadeMatrix() {
		if matrix.Source == changedStage {
			for _, target := range matrix.Targets {
				message := ""
				needsReview := true
				switch changedStage {
				case "topic":
					message = fmt.Sprintf("Topik berubah. Revisi %s diperlukan untuk menyesuaikan dengan topik baru.", target)
				case "literature":
					message = fmt.Sprintf("Literatur berubah. Cek %s apakah masih relevan.", target)
				case "outline":
					message = fmt.Sprintf("Kerangka berubah. %s perlu disesuaikan.", target)
				case "writing":
					message = fmt.Sprintf("Penulisan berubah. Latihan di %s perlu di-review.", target)
				}
				impacts = append(impacts, CascadeImpact{
					TargetStage: target,
					Severity:    matrix.Severity,
					Message:     message,
					NeedsReview: needsReview,
				})
			}
		}
	}
	return impacts
}

// CreateSnapshot saves a version snapshot for a project stage.
func (e *CascadeEngine) CreateSnapshot(projectID int, stage string, content string, dataJSON string, label string) (*VersionSnapshot, error) {
	if db.DB == nil || !db.IsConnected() {
		return &VersionSnapshot{
			ID:        1,
			ProjectID: projectID,
			Stage:     stage,
			Version:   1,
			Content:   content,
			DataJSON:  dataJSON,
			Label:     label,
			CreatedAt: time.Now(),
		}, nil
	}

	// Get next version number
	var maxVer int
	err := db.DB.Get(&maxVer, "SELECT COALESCE(MAX(version),0) FROM version_snapshots WHERE project_id=? AND stage=?", projectID, stage)
	if err != nil {
		maxVer = 0
	}

	res, err := db.DB.Exec(
		"INSERT INTO version_snapshots (project_id, stage, version, content, data_json, label, created_at) VALUES (?,?,?,?,?,?,NOW())",
		projectID, stage, maxVer+1, content, dataJSON, label,
	)
	if err != nil {
		return nil, fmt.Errorf("create snapshot: %w", err)
	}

	id, _ := res.LastInsertId()
	return &VersionSnapshot{
		ID:        int(id),
		ProjectID: projectID,
		Stage:     stage,
		Version:   maxVer + 1,
		Content:   content,
		DataJSON:  dataJSON,
		Label:     label,
		CreatedAt: time.Now(),
	}, nil
}

// RestoreSnapshot retrieves a snapshot by its ID.
func (e *CascadeEngine) RestoreSnapshot(snapshotID int) (*VersionSnapshot, error) {
	if db.DB == nil || !db.IsConnected() {
		return &VersionSnapshot{
			ID:        snapshotID,
			ProjectID: 1,
			Stage:     "outline",
			Version:   1,
			Label:     "Default Snapshot",
			CreatedAt: time.Now(),
		}, nil
	}

	var snap VersionSnapshot
	err := db.DB.Get(&snap, "SELECT * FROM version_snapshots WHERE id=?", snapshotID)
	if err != nil {
		return nil, fmt.Errorf("get snapshot: %w", err)
	}
	return &snap, nil
}

// GetSnapshots lists version snapshots for a project and stage.
func (e *CascadeEngine) GetSnapshots(projectID int, stage string) ([]VersionSnapshot, error) {
	if db.DB == nil || !db.IsConnected() {
		return []VersionSnapshot{}, nil
	}

	var snaps []VersionSnapshot
	err := db.DB.Select(&snaps, "SELECT * FROM version_snapshots WHERE project_id=? AND stage=? ORDER BY version DESC", projectID, stage)
	if err != nil {
		return nil, fmt.Errorf("list snapshots: %w", err)
	}
	return snaps, nil
}

// GetDiff compares two snapshots and returns a description of differences.
func (e *CascadeEngine) GetDiff(snapshotID1, snapshotID2 int) (string, error) {
	s1, err := e.RestoreSnapshot(snapshotID1)
	if err != nil {
		return "", err
	}
	s2, err := e.RestoreSnapshot(snapshotID2)
	if err != nil {
		return "", err
	}

	if s1.Content == s2.Content {
		return "No changes between versions.", nil
	}

	return fmt.Sprintf("Content differs between v%d and v%d. First snapshot: %d chars, Second: %d chars.",
		s1.Version, s2.Version, len(s1.Content), len(s2.Content)), nil
}

// ExecuteCascade marks cascaded stages as needs_review in project_stages.
func (e *CascadeEngine) ExecuteCascade(projectID int, changedStage string, acceptStages []string) error {
	impacts := e.CalculateCascade(projectID, changedStage)
	if db.DB == nil || !db.IsConnected() {
		return nil
	}

	for _, impact := range impacts {
		// Check if user accepted this cascade
		accepted := false
		for _, as := range acceptStages {
			if as == impact.TargetStage || as == "all" {
				accepted = true
				break
			}
		}
		if !accepted {
			continue
		}

		_, err := db.DB.Exec(
			"INSERT INTO project_stages (project_id, stage, status, notes, updated_at) VALUES (?,?,?,?,NOW()) "+
				"ON DUPLICATE KEY UPDATE status=?, notes=?, updated_at=NOW()",
			projectID, impact.TargetStage, "needs_review", impact.Message,
			"needs_review", impact.Message,
		)
		if err != nil {
			return fmt.Errorf("cascade to %s: %w", impact.TargetStage, err)
		}
	}
	return nil
}

// LogCascade saves a cascade event to the log.
func (e *CascadeEngine) LogCascade(projectID int, sourceStage string, action string, description string) error {
	if db.DB == nil || !db.IsConnected() {
		return nil
	}

	_, err := db.DB.Exec(
		"INSERT INTO cascade_log (project_id, source_stage, action, description, created_at) VALUES (?,?,?,?,NOW())",
		projectID, sourceStage, action, description,
	)
	return err
}

// GetCascadeLog retrieves the cascade log for a project.
func (e *CascadeEngine) GetCascadeLog(projectID int) ([]StageLog, error) {
	if db.DB == nil || !db.IsConnected() {
		return []StageLog{}, nil
	}

	var logs []StageLog
	err := db.DB.Select(&logs, "SELECT * FROM cascade_log WHERE project_id=? ORDER BY created_at DESC", projectID)
	if err != nil {
		return nil, fmt.Errorf("get cascade log: %w", err)
	}
	return logs, nil
}
