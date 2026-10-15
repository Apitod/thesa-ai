package agent

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"risethub_os/backend/internal/db"
)

// ---------------------------------------------------------------------------
// OutlineGenerator — AI-powered outline generation, editing, and management
// ---------------------------------------------------------------------------

// OutlineGenerator handles AI-driven outline generation, section editing,
// word target distribution, and persistence for academic writing projects.
type OutlineGenerator struct {
	provider AIProvider
}

// NewOutlineGenerator creates a new OutlineGenerator.
func NewOutlineGenerator(provider AIProvider) *OutlineGenerator {
	return &OutlineGenerator{provider: provider}
}

// ---------------------------------------------------------------------------
// GenerateOutline — generate a complete academic outline from topic & gap
// ---------------------------------------------------------------------------

// TopicFocus defines the topic and angle for outline generation.
type TopicFocus struct {
	Topic string `json:"topic"`
	Angle string `json:"angle"`
}

// GenerateOutline sends topic context and gap summary to the AI and returns
// a structured MappedOutline with sections arranged hierarchically.
func (g *OutlineGenerator) GenerateOutline(topicFocus TopicFocus, gapSummary string, jenisKTI string, templateStructure *TemplateStructure, config ProviderConfig) (*MappedOutline, error) {
	if g.provider == nil {
		return nil, fmt.Errorf("outline generator: AI provider not set")
	}

	var templateSectionsStr string
	if templateStructure != nil && len(templateStructure.Sections) > 0 {
		secJSON, _ := json.Marshal(templateStructure.Sections)
		templateSectionsStr = string(secJSON)
	} else {
		templateSectionsStr = "none (use standard blueprint)"
	}

	prompt := fmt.Sprintf(`You are an academic outline specialist. Generate a detailed academic outline for a %s.

Topic: %s
Angle: %s
GAP (Research Gap Summary): %s
Template Sections: %s

Expected standard blueprints by jenis KTI:
- "Makalah": Pendahuluan, Kajian Pustaka, Pembahasan, Penutup
- "Proposal": Pendahuluan, Kajian Pustaka, Metode Penelitian, Rencana Kegiatan
- "Skripsi": Pendahuluan, Kajian Pustaka, Metode Penelitian, Hasil & Pembahasan, Penutup
- "Tesis": Pendahuluan, Kajian Pustaka, Metode Penelitian, Hasil, Pembahasan, Penutup
- "Disertasi": Pendahuluan, Kajian Pustaka, Kerangka Teori, Metode Penelitian, Hasil, Pembahasan, Penutup

Return a structured JSON outline with the following structure:
{
  "sections": [
    {
      "id": 1,
      "title": "Pendahuluan",
      "level": 1,
      "description": "What this section should contain",
      "target_words": 500,
      "status": "generated",
      "subsections": [
        {
          "id": 2,
          "title": "Latar Belakang",
          "level": 2,
          "description": "...",
          "target_words": 200,
          "status": "generated",
          "subsections": []
        }
      ]
    }
  ],
  "requirements": {
    "min_pages": 30,
    "max_pages": 50,
    "format_rules": ["Times New Roman 12pt", "1.5 line spacing"],
    "citation_style": "APA 7th Edition"
  },
  "deviations": []
}

Each section must have: id (unique int), title, level (1=chapter, 2=sub-section, 3=sub-sub-section), description, target_words, status, subsections.
Ensure the outline is comprehensive and follows academic writing standards for the specified jenis KTI.
Output ONLY valid JSON, no markdown fences, no extra text.`,
		jenisKTI,
		topicFocus.Topic,
		topicFocus.Angle,
		gapSummary,
		templateSectionsStr,
	)

	messages := []Message{
		{Role: "system", Content: "You are a precise academic outline specialist. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := g.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("outline generator: GenerateOutline AI call failed: %w", err)
	}

	return parseGeneratedOutlineJSON(result)
}

// parseGeneratedOutlineJSON extracts MappedOutline from AI JSON response.
func parseGeneratedOutlineJSON(jsonStr string) (*MappedOutline, error) {
	cleaned := cleanJSONString(jsonStr)

	var parsed struct {
		Sections   []OutlineSection     `json:"sections"`
		Reqs       TemplateRequirements `json:"requirements"`
		Deviations []TemplateDeviation  `json:"deviations"`
	}

	if err := json.Unmarshal([]byte(cleaned), &parsed); err != nil {
		return &MappedOutline{
			Sections:     []OutlineSection{},
			Requirements: TemplateRequirements{},
			Deviations:   []TemplateDeviation{},
		}, fmt.Errorf("parse generated outline JSON: %w", err)
	}

	if parsed.Sections == nil {
		parsed.Sections = []OutlineSection{}
	}
	if parsed.Deviations == nil {
		parsed.Deviations = []TemplateDeviation{}
	}

	return &MappedOutline{
		Sections:     parsed.Sections,
		Requirements: parsed.Reqs,
		Deviations:   parsed.Deviations,
	}, nil
}

// ---------------------------------------------------------------------------
// EditSection — edit a single section in an existing outline
// ---------------------------------------------------------------------------

// EditSection sends a user instruction for modifying a specific section and
// returns the full updated outline.
func (g *OutlineGenerator) EditSection(existingOutline *MappedOutline, sectionID int, instruction string, config ProviderConfig) (*MappedOutline, error) {
	if g.provider == nil {
		return nil, fmt.Errorf("outline generator: AI provider not set")
	}
	if existingOutline == nil {
		return nil, fmt.Errorf("outline generator: existing outline is nil")
	}

	outlineJSON, _ := json.Marshal(existingOutline)

	prompt := fmt.Sprintf(`You are an academic outline editor. Modify section %d in the following outline based on the user's instruction.

Current outline (JSON):
%s

Section ID to modify: %d
User instruction: %s

Update the specified section's title, description, target_words, subsections, or any other property as needed.
If the instruction is about adding subsections, create appropriate sub-sections with valid IDs (use unique integers above the existing max ID).
Return the FULL updated outline JSON with the EXACT same structure as the input.
Output ONLY valid JSON, no markdown fences, no extra text.`,
		sectionID, string(outlineJSON), sectionID, instruction)

	messages := []Message{
		{Role: "system", Content: "You are a precise academic outline editor. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := g.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("outline generator: EditSection AI call failed: %w", err)
	}

	return parseGeneratedOutlineJSON(result)
}

// ---------------------------------------------------------------------------
// SetTargetWords — distribute total word count proportionally across sections
// ---------------------------------------------------------------------------

// SetTargetWords distributes a total word target proportionally across all
// outline sections based on their level and relative importance.
func (g *OutlineGenerator) SetTargetWords(existingOutline *MappedOutline, totalWords int, config ProviderConfig) (*MappedOutline, error) {
	if g.provider == nil {
		return nil, fmt.Errorf("outline generator: AI provider not set")
	}
	if existingOutline == nil {
		return nil, fmt.Errorf("outline generator: existing outline is nil")
	}

	outlineJSON, _ := json.Marshal(existingOutline)

	prompt := fmt.Sprintf(`You are an academic word distribution assistant. Distribute %d total words proportionally across all sections in the following outline.

Current outline (JSON):
%s
Total words to distribute: %d

Rules:
- Top-level sections (level 1) should get proportionally more words than sub-sections (level 2 or 3).
- Sections with more subsections should get more words to cover their content.
- The sum of all target_words across ALL sections (including nested ones) should exactly equal %d.
- If a section has subsections, its own target_words should be approximately the sum of its subsections + some overhead.
- Update the "target_words" field on every section.
- Keep all other fields unchanged.

Return the FULL updated outline JSON with target_words filled for every section.
Output ONLY valid JSON, no markdown fences, no extra text.`,
		totalWords, string(outlineJSON), totalWords, totalWords)

	messages := []Message{
		{Role: "system", Content: "You are a precise academic word distribution assistant. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := g.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("outline generator: SetTargetWords AI call failed: %w", err)
	}

	return parseGeneratedOutlineJSON(result)
}

// ---------------------------------------------------------------------------
// SaveOutline — persist the outline to the database
// ---------------------------------------------------------------------------

// SaveOutline inserts the outline sections into thesa_outlines and thesis_outline
// tables. Returns an error if persistence fails.
func (g *OutlineGenerator) SaveOutline(projectID int, outline *MappedOutline) error {
	if outline == nil {
		return fmt.Errorf("outline generator: outline is nil")
	}

	outlineJSON, err := json.Marshal(outline)
	if err != nil {
		return fmt.Errorf("outline generator: failed to marshal outline: %w", err)
	}

	// If DB is offline, return nil gracefully
	if db.DB == nil || !db.IsConnected() {
		return nil
	}

	// Insert into thesa_outlines (top-level outline record)
	_, err = db.DB.Exec(
		`INSERT INTO thesa_outlines (project_id, outline_data, version, created_at, updated_at)
		 VALUES (?, ?, 1, NOW(), NOW())
		 ON DUPLICATE KEY UPDATE outline_data = VALUES(outline_data), version = version + 1, updated_at = NOW()`,
		projectID, string(outlineJSON),
	)
	if err != nil {
		return fmt.Errorf("outline generator: failed to insert thesa_outlines: %w", err)
	}

	// Insert individual sections into thesis_outline
	// First, delete existing sections for this project to avoid duplicates
	_, err = db.DB.Exec(`DELETE FROM thesis_outline WHERE project_id = ?`, projectID)
	if err != nil {
		return fmt.Errorf("outline generator: failed to clear existing thesis_outline: %w", err)
	}

	// Insert each section and its subsections recursively
	err = insertOutlineSections(projectID, 0, outline.Sections)
	if err != nil {
		return fmt.Errorf("outline generator: failed to insert thesis_outline sections: %w", err)
	}

	return nil
}

// insertOutlineSections recursively inserts outline sections into the thesis_outline table.
func insertOutlineSections(projectID int, parentID int, sections []OutlineSection) error {
	for _, sec := range sections {
		title := sec.Title
		description := sec.Description
		targetWords := sec.TargetWords
		status := sec.Status
		if status == "" {
			status = "generated"
		}

		_, err := db.DB.Exec(
			`INSERT INTO thesis_outline (project_id, parent_id, title, description, target_words, sort_order, status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
			projectID, parentID, title, description, targetWords, sec.ID, status,
		)
		if err != nil {
			return fmt.Errorf("insert section '%s': %w", title, err)
		}

		// Insert subsections recursively
		if len(sec.Subsections) > 0 {
			err = insertOutlineSections(projectID, sec.ID, sec.Subsections)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// FlattenOutline — flatten hierarchical sections into a linear list
// ---------------------------------------------------------------------------

// FlattenOutlineSection recursively collects all sections into a flat slice.
func FlattenOutlineSection(sections []OutlineSection) []OutlineSection {
	var result []OutlineSection
	for _, s := range sections {
		result = append(result, s)
		if len(s.Subsections) > 0 {
			result = append(result, FlattenOutlineSection(s.Subsections)...)
		}
	}
	return result
}

// FindMaxSectionID finds the maximum ID across all sections recursively.
func FindMaxSectionID(sections []OutlineSection) int {
	maxID := 0
	for _, s := range sections {
		if s.ID > maxID {
			maxID = s.ID
		}
		if len(s.Subsections) > 0 {
			subMax := FindMaxSectionID(s.Subsections)
			if subMax > maxID {
				maxID = subMax
			}
		}
	}
	return maxID
}

// StringOrUnknown returns the string value or "unknown" if empty.
func StringOrUnknown(s string) string {
	if strings.TrimSpace(s) == "" {
		return "unknown"
	}
	return s
}

// IntOrZero returns the int value or 0 as default.
func IntOrZero(s string) int {
	v, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return v
}
