package agent

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// PubMed data structures
// ---------------------------------------------------------------------------

// PaperRef is a lightweight reference returned from a search.
type PaperRef struct {
	PMID      string
	Title     string
	Authors   []string
	Journal   string
	Year      int
	DOI       string
	Relevance float64
}

// Author represents a single author.
type Author struct {
	LastName string
	ForeName string
	Initials string
}

// PaperDetail holds the full metadata for a single PubMed paper.
type PaperDetail struct {
	PMID             string
	Title            string
	Authors          []Author
	Journal          string
	ISSN             string
	Year             int
	Month            int
	Volume           string
	Issue            string
	Pages            string
	DOI              string
	Abstract         string
	Keywords         []string
	PublicationTypes []string
	PMCID            string
	MeshTerms        []string
}

// PubMedFilter allows structured filtering of PubMed searches.
type PubMedFilter struct {
	YearFrom        int
	YearTo          int
	JournalName     string
	AuthorName      string
	PublicationType string // "Review", "Clinical Trial", "Meta-Analysis", "Randomized Controlled Trial", etc.
	FreeFullText    bool
}

// SearchResult holds the combined result of a PubMed search.
type SearchResult struct {
	Papers     []PaperRef
	TotalCount int
	Query      string
}

// ---------------------------------------------------------------------------
// XML structures for PubMed efetch response
// ---------------------------------------------------------------------------

type pmcXML struct {
	XMLName  xml.Name        `xml:"PubmedArticleSet"`
	Articles []pubmedArticle `xml:"PubmedArticle"`
}

type pubmedArticle struct {
	MedlineCitation medlineCitation `xml:"MedlineCitation"`
	PubmedData      pubmedData      `xml:"PubmedData"`
}

type medlineCitation struct {
	PMID                pmid                `xml:"PMID"`
	Title               string              `xml:"Article>ArticleTitle"`
	Journal             journalInfo         `xml:"Article>Journal"`
	AuthorList          authorList          `xml:"Article>AuthorList"`
	ArticleDate         medlineDate         `xml:"Article>ArticleDate"`
	Pages               string              `xml:"Article>Pagination>MedlinePgn"`
	Abstract            abstractText        `xml:"Article>Abstract"`
	Keywords            keywordList         `xml:"KeywordList"`
	ELocationID         eLocationID         `xml:"Article>ELocationID"`
	MeshHeadingList     meshHeadingList     `xml:"MeshHeadingList"`
	PublicationTypeList publicationTypeList `xml:"Article>PublicationTypeList"`
}

type pmid struct {
	Version string `xml:"Version,attr"`
	Value   string `xml:",chardata"`
}

type journalInfo struct {
	Title        string       `xml:"Title"`
	ISSN         issn         `xml:"ISSN"`
	JournalIssue journalIssue `xml:"JournalIssue"`
}

type journalIssue struct {
	Volume  string      `xml:"Volume"`
	Issue   string      `xml:"Issue"`
	PubDate medlineDate `xml:"PubDate"`
}

type issn struct {
	IssnType string `xml:"IssnType,attr"`
	Value    string `xml:",chardata"`
}

type authorList struct {
	Authors []authorXML `xml:"Author"`
}

type authorXML struct {
	LastName string `xml:"LastName"`
	ForeName string `xml:"ForeName"`
	Initials string `xml:"Initials"`
}

type abstractText struct {
	Texts []abstractElement `xml:"AbstractText"`
}

type abstractElement struct {
	Label string `xml:"Label,attr"`
	Text  string `xml:",chardata"`
}

type keywordList struct {
	Keywords []keywordXML `xml:"Keyword"`
}

type keywordXML struct {
	MajorTopicYN string `xml:"MajorTopicYN,attr"`
	Value        string `xml:",chardata"`
}

type medlineDate struct {
	Year        string `xml:"Year"`
	Month       string `xml:"Month"`
	Day         string `xml:"Day"`
	MedlineDate string `xml:"MedlineDate"`
}

type eLocationID struct {
	EIdType string `xml:"EIdType,attr"`
	Value   string `xml:",chardata"`
}

type meshHeadingList struct {
	MeshHeadings []meshHeading `xml:"MeshHeading"`
}

type meshHeading struct {
	DescriptorName descriptorName `xml:"DescriptorName"`
}

type descriptorName struct {
	MajorTopicYN string `xml:"MajorTopicYN,attr"`
	Value        string `xml:",chardata"`
}

type publicationTypeList struct {
	PublicationTypes []publicationTypeXML `xml:"PublicationType"`
}

type publicationTypeXML struct {
	UI    string `xml:"UI,attr"`
	Value string `xml:",chardata"`
}

type pubmedData struct {
	ArticleIDList articleIDList `xml:"ArticleIdList"`
}

type articleIDList struct {
	ArticleIDs []articleID `xml:"ArticleId"`
}

type articleID struct {
	IdType string `xml:"IdType,attr"`
	Value  string `xml:",chardata"`
}

// ---------------------------------------------------------------------------
// JSON structures for PubMed esearch response
// ---------------------------------------------------------------------------

type esearchResponse struct {
	Header struct {
		Type    string `json:"type"`
		Version string `json:"version"`
	} `json:"header"`
	Result struct {
		Count     string   `json:"count"`
		RetMax    string   `json:"retmax"`
		RetStart  string   `json:"retstart"`
		IDList    []string `json:"idlist"`
		QueryKey  string   `json:"querykey"`
		WebEnv    string   `json:"webenv"`
		ErrorList struct {
			PhrasesNotFound []string `json:"phrasesnotfound"`
			FieldsNotFound  []string `json:"fieldsnotfound"`
		} `json:"errorlist"`
		TranslationSet []struct {
			From string `json:"from"`
			To   string `json:"to"`
		} `json:"translationset"`
		TranslationStack []struct {
			Term    string `json:"term"`
			Field   string `json:"field"`
			Count   string `json:"count"`
			Explode string `json:"explode"`
		} `json:"translationstack"`
		QueryTranslation string `json:"querytranslation"`
	} `json:"esearchresult"`
}

// ---------------------------------------------------------------------------
// PubMedClient
// ---------------------------------------------------------------------------

// PubMedClient is a client for the NCBI PubMed E-utilities API.
type PubMedClient struct {
	httpClient *http.Client
	baseURL    string
	toolName   string
	email      string
	apiKey     string // optional, for higher rate limits
}

// NewPubMedClient creates a new PubMed client.
// email should be set to your email address as required by NCBI.
func NewPubMedClient(email string) *PubMedClient {
	return &PubMedClient{
		httpClient: &http.Client{Timeout: 30 * time.Second},
		baseURL:    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
		toolName:   "ThesaResearch",
		email:      email,
	}
}

// SetAPIKey sets an optional NCBI API key for higher rate limits.
func (c *PubMedClient) SetAPIKey(key string) {
	c.apiKey = key
}

// SetTimeout sets the HTTP client timeout.
func (c *PubMedClient) SetTimeout(d time.Duration) {
	c.httpClient.Timeout = d
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

// SearchPapers performs a PubMed search and returns paper references.
func (c *PubMedClient) SearchPapers(query string, maxResults int) ([]PaperRef, error) {
	if maxResults <= 0 {
		maxResults = 20
	}
	if maxResults > 100 {
		maxResults = 100
	}

	ids, total, err := c.esearch(query, maxResults)
	if err != nil {
		return nil, fmt.Errorf("pubmed search: %w", err)
	}

	if len(ids) == 0 {
		return []PaperRef{}, nil
	}

	// Fetch details for all found IDs
	details, err := c.FetchPaperDetails(ids)
	if err != nil {
		return nil, fmt.Errorf("pubmed search: fetch details: %w", err)
	}

	results := make([]PaperRef, 0, len(details))
	for _, d := range details {
		ref := PaperRef{
			PMID:    d.PMID,
			Title:   d.Title,
			Journal: d.Journal,
			Year:    d.Year,
			DOI:     d.DOI,
		}
		for _, a := range d.Authors {
			name := strings.TrimSpace(a.LastName + " " + a.ForeName)
			if name != "" {
				ref.Authors = append(ref.Authors, name)
			}
		}
		results = append(results, ref)
	}

	_ = total // total is embedded in the result, but we don't expose it in PaperRef slice
	return results, nil
}

// SearchWithFilters performs a PubMed search with structured filters.
func (c *PubMedClient) SearchWithFilters(query string, filters PubMedFilter) ([]PaperRef, error) {
	parts := []string{}

	// Base query
	if query != "" {
		parts = append(parts, "("+query+")")
	}

	// Year range
	if filters.YearFrom > 0 {
		parts = append(parts, fmt.Sprintf(`("%d"[Date - Publication] : "%d"[Date - Publication])`, filters.YearFrom, filters.YearTo))
	} else if filters.YearTo > 0 {
		parts = append(parts, fmt.Sprintf(`("1900"[Date - Publication] : "%d"[Date - Publication])`, filters.YearTo))
	}

	// Journal name
	if filters.JournalName != "" {
		parts = append(parts, fmt.Sprintf(`"%s"[Journal]`, filters.JournalName))
	}

	// Author name
	if filters.AuthorName != "" {
		parts = append(parts, fmt.Sprintf(`"%s"[Author]`, filters.AuthorName))
	}

	// Publication type filter
	if filters.PublicationType != "" {
		parts = append(parts, fmt.Sprintf(`"%s"[Publication Type]`, filters.PublicationType))
	}

	// Free full text
	if filters.FreeFullText {
		parts = append(parts, `"free full text"[Filter]`)
	}

	fullQuery := strings.Join(parts, " AND ")
	if fullQuery == "" {
		return nil, fmt.Errorf("pubmed: empty query with no filters")
	}

	return c.SearchPapers(fullQuery, 20)
}

// FetchByDOI searches for a paper by its DOI.
func (c *PubMedClient) FetchByDOI(doi string) (*PaperDetail, error) {
	if doi == "" {
		return nil, fmt.Errorf("pubmed: DOI is empty")
	}

	// Search by DOI
	ids, _, err := c.esearch(doi+"[DOI]", 5)
	if err != nil {
		return nil, fmt.Errorf("pubmed fetch by DOI: %w", err)
	}

	if len(ids) == 0 {
		return nil, fmt.Errorf("pubmed: no paper found for DOI: %s", doi)
	}

	details, err := c.FetchPaperDetails(ids[:1])
	if err != nil {
		return nil, fmt.Errorf("pubmed fetch by DOI: details: %w", err)
	}

	if len(details) == 0 {
		return nil, fmt.Errorf("pubmed: no details for DOI: %s", doi)
	}

	return &details[0], nil
}

// FetchPaperDetails fetches full details for one or more PubMed IDs.
func (c *PubMedClient) FetchPaperDetails(pubmedIDs []string) ([]PaperDetail, error) {
	if len(pubmedIDs) == 0 {
		return nil, nil
	}

	// NCBI limits IDs to 200 per request; split if needed
	batchSize := 200
	allDetails := make([]PaperDetail, 0, len(pubmedIDs))

	for i := 0; i < len(pubmedIDs); i += batchSize {
		end := i + batchSize
		if end > len(pubmedIDs) {
			end = len(pubmedIDs)
		}
		batch := pubmedIDs[i:end]

		details, err := c.efetch(batch)
		if err != nil {
			return nil, fmt.Errorf("pubmed fetch details (batch %d-%d): %w", i, end, err)
		}
		allDetails = append(allDetails, details...)
	}

	return allDetails, nil
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// esearch calls the PubMed ESearch API and returns (idList, totalCount, error).
func (c *PubMedClient) esearch(query string, maxResults int) ([]string, int, error) {
	params := url.Values{}
	params.Set("db", "pubmed")
	params.Set("term", query)
	params.Set("retmax", strconv.Itoa(maxResults))
	params.Set("retmode", "json")
	params.Set("tool", c.toolName)
	if c.email != "" {
		params.Set("email", c.email)
	}
	if c.apiKey != "" {
		params.Set("api_key", c.apiKey)
	}

	reqURL := c.baseURL + "/esearch.fcgi?" + params.Encode()

	body, err := c.doRequest(reqURL)
	if err != nil {
		return nil, 0, err
	}

	var resp esearchResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, 0, fmt.Errorf("parse esearch JSON: %w", err)
	}

	total, _ := strconv.Atoi(resp.Result.Count)

	return resp.Result.IDList, total, nil
}

// efetch calls the PubMed EFetch API and returns parsed PaperDetail records.
func (c *PubMedClient) efetch(ids []string) ([]PaperDetail, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	params := url.Values{}
	params.Set("db", "pubmed")
	params.Set("id", strings.Join(ids, ","))
	params.Set("retmode", "xml")
	params.Set("tool", c.toolName)
	if c.email != "" {
		params.Set("email", c.email)
	}
	if c.apiKey != "" {
		params.Set("api_key", c.apiKey)
	}

	reqURL := c.baseURL + "/efetch.fcgi?" + params.Encode()

	xmlBody, err := c.doRequest(reqURL)
	if err != nil {
		return nil, err
	}

	return c.parsePubmedXML(xmlBody)
}

// doRequest performs an HTTP GET and returns the response body.
func (c *PubMedClient) doRequest(urlStr string) ([]byte, error) {
	req, err := http.NewRequest("GET", urlStr, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http get: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("PubMed API returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	return body, nil
}

// parsePubmedXML parses the PubMed EFetch XML response into PaperDetail records.
func (c *PubMedClient) parsePubmedXML(data []byte) ([]PaperDetail, error) {
	var doc pmcXML
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parse PubMed XML: %w", err)
	}

	details := make([]PaperDetail, 0, len(doc.Articles))
	for _, article := range doc.Articles {
		d := PaperDetail{}

		// PMID
		d.PMID = article.MedlineCitation.PMID.Value

		// Title
		d.Title = strings.TrimSpace(article.MedlineCitation.Title)

		// Authors
		for _, a := range article.MedlineCitation.AuthorList.Authors {
			author := Author{
				LastName: strings.TrimSpace(a.LastName),
				ForeName: strings.TrimSpace(a.ForeName),
				Initials: strings.TrimSpace(a.Initials),
			}
			// Skip empty authors
			if author.LastName == "" && author.ForeName == "" {
				continue
			}
			d.Authors = append(d.Authors, author)
		}

		// Journal
		d.Journal = strings.TrimSpace(article.MedlineCitation.Journal.Title)

		// ISSN
		d.ISSN = strings.TrimSpace(article.MedlineCitation.Journal.ISSN.Value)

		// Volume, Issue, Pages
		d.Volume = strings.TrimSpace(article.MedlineCitation.Journal.JournalIssue.Volume)
		d.Issue = strings.TrimSpace(article.MedlineCitation.Journal.JournalIssue.Issue)
		d.Pages = strings.TrimSpace(article.MedlineCitation.Pages)

		// Year
		yearStr := strings.TrimSpace(article.MedlineCitation.Journal.JournalIssue.PubDate.Year)
		if yearStr == "" {
			yearStr = strings.TrimSpace(article.MedlineCitation.ArticleDate.Year)
		}
		if yearStr == "" && article.MedlineCitation.Journal.JournalIssue.PubDate.MedlineDate != "" {
			md := article.MedlineCitation.Journal.JournalIssue.PubDate.MedlineDate
			if len(md) >= 4 {
				yearStr = md[:4]
			}
		}
		if yearStr != "" {
			if y, err := strconv.Atoi(yearStr); err == nil {
				d.Year = y
			}
		}

		// Month
		monthStr := strings.TrimSpace(article.MedlineCitation.Journal.JournalIssue.PubDate.Month)
		if monthStr == "" {
			monthStr = strings.TrimSpace(article.MedlineCitation.ArticleDate.Month)
		}
		if monthStr != "" {
			monthMap := map[string]int{
				"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
				"jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
			}
			monthLower := strings.ToLower(monthStr)
			if m, ok := monthMap[monthLower]; ok {
				d.Month = m
			} else if m, err := strconv.Atoi(monthStr); err == nil && m >= 1 && m <= 12 {
				d.Month = m
			}
		}

		// Abstract
		abstractParts := make([]string, 0, len(article.MedlineCitation.Abstract.Texts))
		for _, t := range article.MedlineCitation.Abstract.Texts {
			text := strings.TrimSpace(t.Text)
			if text != "" {
				if t.Label != "" {
					abstractParts = append(abstractParts, t.Label+": "+text)
				} else {
					abstractParts = append(abstractParts, text)
				}
			}
		}
		d.Abstract = strings.Join(abstractParts, "\n")

		// Keywords
		for _, kw := range article.MedlineCitation.Keywords.Keywords {
			k := strings.TrimSpace(kw.Value)
			if k != "" {
				d.Keywords = append(d.Keywords, k)
			}
		}

		// Publication Types
		for _, pt := range article.MedlineCitation.PublicationTypeList.PublicationTypes {
			t := strings.TrimSpace(pt.Value)
			if t != "" {
				d.PublicationTypes = append(d.PublicationTypes, t)
			}
		}

		// Mesh Terms
		for _, mh := range article.MedlineCitation.MeshHeadingList.MeshHeadings {
			term := strings.TrimSpace(mh.DescriptorName.Value)
			if term != "" {
				d.MeshTerms = append(d.MeshTerms, term)
			}
		}

		// ELocationID (DOI)
		doi := strings.TrimSpace(article.MedlineCitation.ELocationID.Value)
		eidType := article.MedlineCitation.ELocationID.EIdType
		if doi != "" && eidType == "doi" {
			d.DOI = doi
		}

		// Article IDs from PubmedData (DOI, PMCID)
		for _, aid := range article.PubmedData.ArticleIDList.ArticleIDs {
			val := strings.TrimSpace(aid.Value)
			if val == "" {
				continue
			}
			switch aid.IdType {
			case "doi":
				if d.DOI == "" {
					d.DOI = val
				}
			case "pmc":
				d.PMCID = val
			}
		}

		details = append(details, d)
	}

	return details, nil
}
