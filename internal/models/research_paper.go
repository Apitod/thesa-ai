package models

// ResearchPaper represents a row in the research_papers table.
type ResearchPaper struct {
	ID        int        `db:"id" json:"id"`
	ProjectID int        `db:"project_id" json:"project_id"`
	Title     string     `db:"title" json:"title"`
	Authors   string     `db:"authors" json:"authors"`
	Year      int        `db:"year" json:"year"`
	Abstract  string     `db:"abstract" json:"abstract"`
	URL       string     `db:"url" json:"url"`
	KeyPoints NullString `db:"key_points" json:"key_points"`
}

// NullString is a nullable string that handles database NULL values.
type NullString struct {
	String string
	Valid  bool
}
