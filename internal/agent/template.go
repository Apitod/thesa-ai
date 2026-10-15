package agent

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ---------------------------------------------------------------------------
// Template Agent — AI-powered analysis of academic writing guides & templates
// ---------------------------------------------------------------------------

// TemplateStructure is the structured outline extracted from a template/panduan.
type TemplateStructure struct {
	Sections     []TemplateSection    `json:"sections"`
	Requirements TemplateRequirements `json:"requirements"`
	HasPDF       bool                 `json:"has_pdf"`
	Source       string               `json:"source"` // "pdf" | "input" | "regex"
}

// TemplateRequirements holds formatting requirements from the template.
type TemplateRequirements struct {
	MinPages      int      `json:"min_pages"`
	MaxPages      int      `json:"max_pages"`
	FormatRules   []string `json:"format_rules"`
	CitationStyle string   `json:"citation_style"`
}

// TemplateSection describes a single chapter or section in the writing guide.
type TemplateSection struct {
	Label       string            `json:"label"` // e.g. "Bab 1", "Bab 2"
	Title       string            `json:"title"` // e.g. "Pendahuluan", "Kajian Pustaka"
	Description string            `json:"description"`
	Required    bool              `json:"required"`
	SubSections []TemplateSection `json:"sub_sections,omitempty"`
}

// MappedOutline is the result of mapping a template structure to a canonical
// blueprint outline that can be consumed by the Outline Agent.
type MappedOutline struct {
	Sections     []OutlineSection     `json:"sections"`
	Requirements TemplateRequirements `json:"requirements"`
	Deviations   []TemplateDeviation  `json:"deviations,omitempty"`
}

// OutlineSection is a single node in the mapped blueprint outline.
type OutlineSection struct {
	ID          int              `json:"id"`
	Title       string           `json:"title"`
	Level       int              `json:"level"`
	Description string           `json:"description"`
	TargetWords int              `json:"target_words"`
	Status      string           `json:"status"`
	Subsections []OutlineSection `json:"subsections,omitempty"`
}

// TemplateDeviation records a mismatch between the template and the blueprint.
type TemplateDeviation struct {
	Section    string `json:"section"`
	Issue      string `json:"issue"`
	Severity   string `json:"severity"` // "warning" | "error"
	Suggestion string `json:"suggestion"`
}

// StyleGuide holds formatting and citation rules derived from a template.
type StyleGuide struct {
	ActiveRules         []string `json:"active_rules"`
	CitationStyle       string   `json:"citation_style"`
	FormatRequirements  []string `json:"format_requirements"`
	ValidationChecklist []string `json:"validation_checklist"`
}

// ComplianceIssue describes a single rule violation found in a draft.
type ComplianceIssue struct {
	Section  string `json:"section"`
	Rule     string `json:"rule"`
	Found    string `json:"found"`
	Expected string `json:"expected"`
	Severity string `json:"severity"`
}

// ComplianceReport is the full compliance check result.
type ComplianceReport struct {
	OverallCompliance float64           `json:"overall_compliance"`
	Passed            []string          `json:"passed"`
	Failed            []ComplianceIssue `json:"failed"`
	TotalChecks       int               `json:"total_checks"`
}

// ---------------------------------------------------------------------------
// TemplateAgent
// ---------------------------------------------------------------------------

// TemplateAgent performs AI-powered analysis on academic writing guides and
// institutional templates to extract structure, map to blueprints, generate
// style guides, and check draft compliance.
type TemplateAgent struct {
	provider AIProvider
}

// NewTemplateAgent creates a new TemplateAgent.
func NewTemplateAgent(provider AIProvider) *TemplateAgent {
	return &TemplateAgent{provider: provider}
}

// ---------------------------------------------------------------------------
// ParseTemplate — extract structured outline from raw template text
// ---------------------------------------------------------------------------

// ParseTemplate sends raw template text to the AI and returns a structured
// TemplateStructure describing sections, requirements, and formatting rules.
func (a *TemplateAgent) ParseTemplate(rawText string, source string, config ProviderConfig) (*TemplateStructure, error) {
	if a.provider == nil {
		return nil, fmt.Errorf("template agent: AI provider not set")
	}
	if rawText == "" {
		return nil, fmt.Errorf("template agent: raw text is empty")
	}

	prompt := fmt.Sprintf(`You are an academic writing guide analyst. Analyse the following academic writing guide / template text and extract its structure.

Template text:
%s

Source: %s

Extract the following in JSON format:
1. "sections": array of required / suggested sections or chapters. Each section has:
   - "label": the section heading label (e.g. "Bab 1", "Bab 2", "A.", "I.")
   - "title": the descriptive title (e.g. "Pendahuluan", "Kajian Pustaka")
   - "description": a short summary of what this section should contain
   - "required": boolean, whether this section is mandatory
   - "sub_sections": optional nested sub-sections with the same shape
2. "requirements": object with:
   - "min_pages": minimum page count (int, 0 if not specified)
   - "max_pages": maximum page count (int, 0 if not specified)
   - "format_rules": array of strings describing format requirements (font, margins, spacing, etc.)
   - "citation_style": the citation style if mentioned (e.g. "APA", "IEEE", "" if not specified)
3. "has_pdf": boolean indicating whether this was extracted from a PDF
4. "source": the source type string passed in

Output ONLY valid JSON, no markdown fences, no extra text.`, rawText, source)

	messages := []Message{
		{Role: "system", Content: "You are a precise academic writing guide analyst. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := a.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("template agent: ParseTemplate AI call failed: %w", err)
	}

	return parseTemplateStructureJSON(result, source)
}

// parseTemplateStructureJSON extracts TemplateStructure from AI JSON response.
func parseTemplateStructureJSON(jsonStr string, source string) (*TemplateStructure, error) {
	cleaned := cleanJSONString(jsonStr)

	var parsed struct {
		Sections     []TemplateSection    `json:"sections"`
		Requirements TemplateRequirements `json:"requirements"`
		HasPDF       bool                 `json:"has_pdf"`
		Source       string               `json:"source"`
	}

	if err := json.Unmarshal([]byte(cleaned), &parsed); err != nil {
		// Return a minimal structure rather than failing hard
		return &TemplateStructure{
			Sections:     []TemplateSection{},
			Requirements: TemplateRequirements{},
			HasPDF:       false,
			Source:       source,
		}, fmt.Errorf("parse template structure JSON: %w", err)
	}

	if parsed.Sections == nil {
		parsed.Sections = []TemplateSection{}
	}
	if parsed.Requirements.FormatRules == nil {
		parsed.Requirements.FormatRules = []string{}
	}
	if parsed.Source == "" {
		parsed.Source = source
	}

	return &TemplateStructure{
		Sections:     parsed.Sections,
		Requirements: parsed.Requirements,
		HasPDF:       parsed.HasPDF,
		Source:       parsed.Source,
	}, nil
}

// ---------------------------------------------------------------------------
// MapToBlueprint — map template sections to a canonical blueprint outline
// ---------------------------------------------------------------------------

// MapToBlueprint maps a TemplateStructure to a MappedOutline that aligns the
// institution's template with a standard KTI blueprint (Makalah / Proposal /
// Skripsi / Tesis / Disertasi).
func (a *TemplateAgent) MapToBlueprint(templateStructure *TemplateStructure, jenisKTI string, config ProviderConfig) (*MappedOutline, error) {
	if a.provider == nil {
		return nil, fmt.Errorf("template agent: AI provider not set")
	}
	if templateStructure == nil {
		return nil, fmt.Errorf("template agent: template structure is nil")
	}

	sectionsJSON, _ := json.Marshal(templateStructure.Sections)
	reqsJSON, _ := json.Marshal(templateStructure.Requirements)

	prompt := fmt.Sprintf(`You are an academic outline mapping assistant. Map the following institution template sections to a standard KTI blueprint for a "%s".

Template Sections (JSON):
%s

Template Requirements (JSON):
%s

Expected standard blueprints by jenis KTI:
- "Makalah": Pendahuluan, Kajian Pustaka, Pembahasan, Penutup
- "Proposal": Pendahuluan, Kajian Pustaka, Metode Penelitian, Rencana Kegiatan
- "Skripsi": Pendahuluan, Kajian Pustaka, Metode Penelitian, Hasil & Pembahasan, Penutup
- "Tesis": Pendahuluan, Kajian Pustaka, Metode Penelitian, Hasil, Pembahasan, Penutup
- "Disertasi": Pendahuluan, Kajian Pustaka, Kerangka Teori, Metode Penelitian, Hasil, Pembahasan, Penutup

For each mapped section, provide:
1. "id": unique integer
2. "title": the merged title that best represents this section
3. "level": nesting level (1 for top-level chapter, 2 for sub-section)
4. "description": what this section should contain
5. "target_words": recommended word count based on typical page limits
6. "status": "mapped" if matched to a template section, "blueprint" if canonical but not in template
7. "subsections": nested outline sections

Also identify any "deviations": mismatches between template and blueprint. Each deviation has:
- "section": the section name
- "issue": description of the mismatch
- "severity": "warning" or "error"
- "suggestion": how to resolve

Output ONLY valid JSON with exactly these keys: "sections", "requirements", "deviations".`, jenisKTI, string(sectionsJSON), string(reqsJSON))

	messages := []Message{
		{Role: "system", Content: "You are a precise academic outline mapping assistant. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := a.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("template agent: MapToBlueprint AI call failed: %w", err)
	}

	return parseMappedOutlineJSON(result, templateStructure.Requirements)
}

// parseMappedOutlineJSON extracts MappedOutline from AI JSON response.
func parseMappedOutlineJSON(jsonStr string, fallbackReqs TemplateRequirements) (*MappedOutline, error) {
	cleaned := cleanJSONString(jsonStr)

	var parsed struct {
		Sections   []OutlineSection     `json:"sections"`
		Reqs       TemplateRequirements `json:"requirements"`
		Deviations []TemplateDeviation  `json:"deviations"`
	}

	if err := json.Unmarshal([]byte(cleaned), &parsed); err != nil {
		// Return a minimal mapped outline
		return &MappedOutline{
			Sections:     []OutlineSection{},
			Requirements: fallbackReqs,
			Deviations:   []TemplateDeviation{},
		}, fmt.Errorf("parse mapped outline JSON: %w", err)
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
// EnforceStyle — generate a style guide from the mapped outline
// ---------------------------------------------------------------------------

// EnforceStyle analyses the mapped outline and generates a StyleGuide with
// formatting rules, citation requirements, and a validation checklist.
func (a *TemplateAgent) EnforceStyle(mapped *MappedOutline, config ProviderConfig) (*StyleGuide, error) {
	if a.provider == nil {
		return nil, fmt.Errorf("template agent: AI provider not set")
	}
	if mapped == nil {
		return nil, fmt.Errorf("template agent: mapped outline is nil")
	}

	sectionsJSON, _ := json.Marshal(mapped.Sections)
	reqsJSON, _ := json.Marshal(mapped.Requirements)

	prompt := fmt.Sprintf(`You are an academic style enforcer. Given the following mapped outline and requirements, generate a comprehensive style guide.

Mapped Outline Sections (JSON):
%s

Requirements (JSON):
%s

Generate a StyleGuide with:
1. "active_rules": array of strings, the formatting rules that apply (e.g. "Use Times New Roman 12pt", "1.5 line spacing", "Justified alignment")
2. "citation_style": the citation style to use (e.g. "APA 7th Edition")
3. "format_requirements": array of strings, specific format checks (e.g. "Margins: 4cm left, 3cm top/right/bottom", "Minimum 20 references")
4. "validation_checklist": array of strings, items to verify before submission (e.g. "All tables numbered sequentially", "Reference list matches in-text citations")

Infer rules from the section descriptions and requirements. Be practical and specific.

Output ONLY valid JSON with exactly these keys: "active_rules", "citation_style", "format_requirements", "validation_checklist".`, string(sectionsJSON), string(reqsJSON))

	messages := []Message{
		{Role: "system", Content: "You are a precise academic style enforcer. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := a.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("template agent: EnforceStyle AI call failed: %w", err)
	}

	return parseStyleGuideJSON(result)
}

// parseStyleGuideJSON extracts StyleGuide from AI JSON response.
func parseStyleGuideJSON(jsonStr string) (*StyleGuide, error) {
	cleaned := cleanJSONString(jsonStr)

	var parsed struct {
		ActiveRules         []string `json:"active_rules"`
		CitationStyle       string   `json:"citation_style"`
		FormatRequirements  []string `json:"format_requirements"`
		ValidationChecklist []string `json:"validation_checklist"`
	}

	if err := json.Unmarshal([]byte(cleaned), &parsed); err != nil {
		return &StyleGuide{
			ActiveRules:         []string{},
			CitationStyle:       "",
			FormatRequirements:  []string{},
			ValidationChecklist: []string{},
		}, fmt.Errorf("parse style guide JSON: %w", err)
	}

	if parsed.ActiveRules == nil {
		parsed.ActiveRules = []string{}
	}
	if parsed.FormatRequirements == nil {
		parsed.FormatRequirements = []string{}
	}
	if parsed.ValidationChecklist == nil {
		parsed.ValidationChecklist = []string{}
	}

	return &StyleGuide{
		ActiveRules:         parsed.ActiveRules,
		CitationStyle:       parsed.CitationStyle,
		FormatRequirements:  parsed.FormatRequirements,
		ValidationChecklist: parsed.ValidationChecklist,
	}, nil
}

// ---------------------------------------------------------------------------
// CheckCompliance — check a draft against the template requirements
// ---------------------------------------------------------------------------

// CheckCompliance evaluates a draft document against the mapped outline and
// returns a ComplianceReport detailing which requirements pass or fail.
func (a *TemplateAgent) CheckCompliance(draftContent string, mapped *MappedOutline, config ProviderConfig) (*ComplianceReport, error) {
	if a.provider == nil {
		return nil, fmt.Errorf("template agent: AI provider not set")
	}
	if mapped == nil {
		return nil, fmt.Errorf("template agent: mapped outline is nil")
	}
	if draftContent == "" {
		return nil, fmt.Errorf("template agent: draft content is empty")
	}

	// Truncate draft to avoid token limits
	draftPreview := draftContent
	if len(draftPreview) > 6000 {
		draftPreview = draftPreview[:6000] + "... [truncated]"
	}

	sectionsJSON, _ := json.Marshal(mapped.Sections)
	reqsJSON, _ := json.Marshal(mapped.Requirements)

	prompt := fmt.Sprintf(`You are an academic compliance checker. Compare the following draft document against the template requirements and identify any violations.

Draft Content (first 6000 chars):
%s

Template Outline Sections (JSON):
%s

Template Requirements (JSON):
%s

For each requirement found in the template, check if the draft complies. Return:
1. "overall_compliance": a float from 0.0 to 1.0 indicating the proportion of checks passed
2. "passed": array of strings describing checks that passed
3. "failed": array of objects, each with:
   - "section": which section of the draft has the issue
   - "rule": the rule being violated
   - "found": what was found in the draft
   - "expected": what was expected
   - "severity": "warning" or "error"
4. "total_checks": total number of checks performed

Be thorough but fair. Consider: presence of required sections, formatting hints from content, citation style, page length indicators.

Output ONLY valid JSON with exactly these keys: "overall_compliance", "passed", "failed", "total_checks".`, draftPreview, string(sectionsJSON), string(reqsJSON))

	messages := []Message{
		{Role: "system", Content: "You are a precise academic compliance checker. Always respond with valid JSON only."},
		{Role: "user", Content: prompt},
	}

	result, err := a.provider.Chat(messages, config)
	if err != nil {
		return nil, fmt.Errorf("template agent: CheckCompliance AI call failed: %w", err)
	}

	return parseComplianceReportJSON(result)
}

// parseComplianceReportJSON extracts ComplianceReport from AI JSON response.
func parseComplianceReportJSON(jsonStr string) (*ComplianceReport, error) {
	cleaned := cleanJSONString(jsonStr)

	var parsed struct {
		OverallCompliance float64           `json:"overall_compliance"`
		Passed            []string          `json:"passed"`
		Failed            []ComplianceIssue `json:"failed"`
		TotalChecks       int               `json:"total_checks"`
	}

	if err := json.Unmarshal([]byte(cleaned), &parsed); err != nil {
		return &ComplianceReport{
			OverallCompliance: 0.0,
			Passed:            []string{},
			Failed:            []ComplianceIssue{},
			TotalChecks:       0,
		}, fmt.Errorf("parse compliance report JSON: %w", err)
	}

	if parsed.Passed == nil {
		parsed.Passed = []string{}
	}
	if parsed.Failed == nil {
		parsed.Failed = []ComplianceIssue{}
	}

	return &ComplianceReport{
		OverallCompliance: parsed.OverallCompliance,
		Passed:            parsed.Passed,
		Failed:            parsed.Failed,
		TotalChecks:       parsed.TotalChecks,
	}, nil
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

// cleanJSONString removes markdown fences and trims whitespace from AI output.
func cleanJSONString(s string) string {
	s = strings.TrimSpace(s)

	// Strip markdown code fences if present
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	s = strings.TrimSpace(s)

	// If the response starts with valid JSON delimiters, return as-is
	if len(s) > 0 && (s[0] == '[' || s[0] == '{') {
		return s
	}

	// LLM sometimes prefixes the JSON with preamble text.
	// Find the first '[' (for arrays) or '{' (for objects) and last matching closer.
	if idx := strings.Index(s, "["); idx != -1 {
		if end := strings.LastIndex(s, "]"); end > idx {
			return s[idx : end+1]
		}
	}
	if idx := strings.Index(s, "{"); idx != -1 {
		if end := strings.LastIndex(s, "}"); end > idx {
			return s[idx : end+1]
		}
	}

	return s
}
