package services

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"regexp"
	"sort"

	"time"

	"github.com/kdub/ag_news/ingest"
)

// TopicCache representation for clusters.json
type TopicCache struct {
	Title        string         `json:"title"`
	Description  string         `json:"description"`
	SourceCounts map[string]int `json:"source_counts"`
	ArticleLinks []string       `json:"article_links"`
}

// CachedArticle is the Single Source of Truth for an article's data
type CachedArticle struct {
	Link              string     `json:"link"`
	Title             string     `json:"title"`
	SourceName        string     `json:"source_name"`
	RSSSummary        string     `json:"rss_summary"`
	CompressedSummary string     `json:"compressed_summary"` // Gemini-extracted facts
	Published         *time.Time `json:"published"`
	FetchDate         string     `json:"fetch_date"`
}

func getCacheFilePath(date string) string {
	cacheDir := filepath.Join(".", ".cache", date)
	os.MkdirAll(cacheDir, 0755)
	return filepath.Join(cacheDir, "clusters.json")
}

func LoadClustersCache(date string) ([]*TopicCluster, error) {
	path := getCacheFilePath(date)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []*TopicCluster{}, nil
		}
		return nil, fmt.Errorf("failed to read cache: %w", err)
	}

	var cached []TopicCache
	if err := json.Unmarshal(data, &cached); err != nil {
		// Fallback for old cache format? We'll handle migration separately.
		return nil, fmt.Errorf("failed to decode cache: %w", err)
	}

	var clusters []*TopicCluster
	for _, c := range cached {
		var articles []ingest.ArticleSummary
		for _, link := range c.ArticleLinks {
			summary, err := LoadArticleMetadata(link)
			if err == nil {
				articles = append(articles, *summary)
			} else {
				// Fallback: If we don't have metadata yet, just put the link.
				// This shouldn't happen after migration.
				articles = append(articles, ingest.ArticleSummary{Link: link})
			}
		}

		clusters = append(clusters, &TopicCluster{
			Title:        c.Title,
			Description:  c.Description,
			SourceCounts: c.SourceCounts,
			Articles:     articles,
			Indices:      []int{},
		})
	}
	return clusters, nil
}

func SaveClustersCache(date string, clusters []*TopicCluster) error {
	path := getCacheFilePath(date)
	var cached []TopicCache
	for _, c := range clusters {
		var links []string
		for _, a := range c.Articles {
			links = append(links, a.Link)
			// Ensure metadata is saved centrally
			SaveArticleMetadata(a)
		}

		cached = append(cached, TopicCache{
			Title:        c.Title,
			Description:  c.Description,
			SourceCounts: c.SourceCounts,
			ArticleLinks: links,
		})
	}

	data, err := json.MarshalIndent(cached, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to encode cache: %w", err)
	}

	return os.WriteFile(path, data, 0644)
}

// getArticleHash is defined in compression.go

func SaveArticleMetadata(a ingest.ArticleSummary) {
	hash := getArticleHash(a.Link)
	path := filepath.Join(".", ".cache", "articles", hash+".json")

	// Load existing to preserve CompressedSummary if it exists
	var data CachedArticle
	existing, err := os.ReadFile(path)
	if err == nil {
		json.Unmarshal(existing, &data)
	}

	data.Link = a.Link
	data.Title = a.Title
	data.SourceName = a.SourceName
	data.RSSSummary = a.Summary
	data.Published = a.Published
	data.FetchDate = a.FetchDate
	// If the input already has CompressedSummary, preserve it
	if a.CompressedSummary != "" {
		data.CompressedSummary = a.CompressedSummary
	}

	b, _ := json.MarshalIndent(data, "", "  ")
	os.MkdirAll(filepath.Dir(path), 0755)
	os.WriteFile(path, b, 0644)
}

func SaveCompressedSummary(link string, summary string) {
	hash := getArticleHash(link)
	path := filepath.Join(".", ".cache", "articles", hash+".json")

	var data CachedArticle
	existing, err := os.ReadFile(path)
	if err == nil {
		json.Unmarshal(existing, &data)
	}

	data.CompressedSummary = summary

	b, _ := json.MarshalIndent(data, "", "  ")
	os.MkdirAll(filepath.Dir(path), 0755)
	os.WriteFile(path, b, 0644)
}

func LoadArticleMetadata(link string) (*ingest.ArticleSummary, error) {
	hash := getArticleHash(link)
	path := filepath.Join(".", ".cache", "articles", hash+".json")

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cached CachedArticle
	if err := json.Unmarshal(data, &cached); err != nil {
		return nil, err
	}

	return &ingest.ArticleSummary{
		SourceName:        cached.SourceName,
		Title:             cached.Title,
		Link:              cached.Link,
		Summary:           cached.RSSSummary,
		CompressedSummary: cached.CompressedSummary,
		Published:         cached.Published,
		FetchDate:         cached.FetchDate,
	}, nil
}

// ListCacheDates returns a list of available date folders in sorted descending order
func ListCacheDates() []string {
	entries, err := os.ReadDir(".cache")
	if err != nil {
		return []string{}
	}

	dateRegex := regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	var dates []string

	for _, entry := range entries {
		if entry.IsDir() && dateRegex.MatchString(entry.Name()) {
			// Verify it has a clusters.json
			if _, err := os.Stat(filepath.Join(".cache", entry.Name(), "clusters.json")); err == nil {
				dates = append(dates, entry.Name())
			}
		}
	}

	sort.Slice(dates, func(i, j int) bool {
		return dates[i] > dates[j]
	})

	return dates
}
