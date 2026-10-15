package agent

import (
	"encoding/xml"
	"net"
	"strings"
	"testing"
)

const samplePubmedXML = `<?xml version="1.0"?>
<!DOCTYPE PubmedArticleSet PUBLIC "-//NLM//DTD PubMedArticle, 1st January 2024//EN" "https://dtd.nlm.nih.gov/ncbi/pubmed/out/pubmed_240101.dtd">
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">38123456</PMID>
      <Article>
        <Journal>
          <ISSN IssnType="Electronic">2045-2322</ISSN>
          <JournalIssue CitedMedium="Internet">
            <Volume>14</Volume>
            <Issue>1</Issue>
            <PubDate>
              <Year>2024</Year>
              <Month>Jan</Month>
            </PubDate>
          </JournalIssue>
          <Title>Scientific Reports</Title>
        </Journal>
        <ArticleTitle>AI-driven Literature Review Systems for Academic Research</ArticleTitle>
        <Pagination>
          <MedlinePgn>1024</MedlinePgn>
        </Pagination>
        <Abstract>
          <AbstractText>Artificial intelligence significantly accelerates systematic literature reviews.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author>
            <LastName>Pratama</LastName>
            <ForeName>Budi</ForeName>
            <Initials>B</Initials>
          </Author>
          <Author>
            <LastName>Smith</LastName>
            <ForeName>John</ForeName>
            <Initials>J</Initials>
          </Author>
        </AuthorList>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="pubmed">38123456</ArticleId>
        <ArticleId IdType="doi">10.1038/s41598-024-51234-x</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`

func TestPubMedClient_XMLUnmarshal(t *testing.T) {
	var articleSet pmcXML
	err := xml.Unmarshal([]byte(samplePubmedXML), &articleSet)
	if err != nil {
		t.Fatalf("xml.Unmarshal failed: %v", err)
	}

	if len(articleSet.Articles) != 1 {
		t.Fatalf("expected 1 article, got %d", len(articleSet.Articles))
	}

	art := articleSet.Articles[0]
	if art.MedlineCitation.PMID.Value != "38123456" {
		t.Errorf("expected PMID 38123456, got %s", art.MedlineCitation.PMID.Value)
	}
	if art.MedlineCitation.Title != "AI-driven Literature Review Systems for Academic Research" {
		t.Errorf("title mismatch: %s", art.MedlineCitation.Title)
	}
	if art.MedlineCitation.Journal.Title != "Scientific Reports" {
		t.Errorf("journal title mismatch: %s", art.MedlineCitation.Journal.Title)
	}
	if art.MedlineCitation.Journal.JournalIssue.Volume != "14" {
		t.Errorf("volume mismatch: %s", art.MedlineCitation.Journal.JournalIssue.Volume)
	}
	if art.MedlineCitation.Journal.JournalIssue.PubDate.Year != "2024" {
		t.Errorf("year mismatch: %s", art.MedlineCitation.Journal.JournalIssue.PubDate.Year)
	}
	if len(art.MedlineCitation.AuthorList.Authors) != 2 {
		t.Errorf("expected 2 authors, got %d", len(art.MedlineCitation.AuthorList.Authors))
	}
	if art.MedlineCitation.AuthorList.Authors[0].LastName != "Pratama" {
		t.Errorf("author[0] mismatch: %s", art.MedlineCitation.AuthorList.Authors[0].LastName)
	}
}

func TestPubMedClient_SearchPapersLive(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live network test in -short mode")
	}

	c := NewPubMedClient("thesa@risethub.com")
	papers, err := c.SearchPapers("artificial intelligence", 3)
	if err != nil {
		// If network/DNS fails on the local host, skip gracefully rather than failing unit tests
		if _, ok := err.(net.Error); ok || strings.Contains(err.Error(), "timeout") || strings.Contains(err.Error(), "lookup") {
			t.Skipf("skipping live test due to host network/DNS condition: %v", err)
			return
		}
		t.Fatalf("SearchPapers unexpected error: %v", err)
	}
	t.Logf("Found %d papers live", len(papers))
	for i, p := range papers {
		t.Logf("[%d] PMID: %s, Title: %s, Year: %d, DOI: %s", i+1, p.PMID, p.Title, p.Year, p.DOI)
	}
}
