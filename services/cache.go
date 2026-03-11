package services

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

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
	CompressedSummary string     `json:"compressed_summary,omitempty"` // Gemini-extracted facts
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

func parseFetchDate(dateStr string) time.Time {
	// Try ISO format
	t, err := time.Parse(time.RFC3339, dateStr)
	if err == nil {
		return t
	}
	// Try old YYYY-MM-DD
	t, err = time.Parse("2006-01-02", dateStr)
	if err == nil {
		return t
	}
	// Fallback
	return time.Time{}
}

func SaveArticleMetadata(a ingest.ArticleSummary) {
	hash := getArticleHash(a.Link)
	path := filepath.Join(".", ".cache", "articles", hash+".json")

	// Load existing to preserve CompressedSummary and validate FetchDate
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

	// Update FetchDate only if it's new or being upgraded to precise format
	if a.FetchDate != "" {
		// If input is YYYY-MM-DD and we have a precise one already, don't downgrade
		if len(a.FetchDate) == 10 && len(data.FetchDate) > 10 {
			// keep precise
		} else {
			data.FetchDate = a.FetchDate
		}
	} else if data.FetchDate == "" {
		data.FetchDate = time.Now().Format(time.RFC3339)
	}

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

	// Backfill: If FetchDate is YYYY-MM-DD, upgrade it potentially
	// But let's just use it as is for the struct, parseFetchDate handles the logic when needed

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

// GetGlobalFeedStats aggregates statistics across all cached articles
func GetGlobalFeedStats() map[string]ingest.FeedStatus {
	stats := make(map[string]ingest.FeedStatus)
	articleDir := filepath.Join(".", ".cache", "articles")

	entries, err := os.ReadDir(articleDir)
	if err != nil {
		return stats
	}

	now := time.Now()
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		path := filepath.Join(articleDir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}

		var art CachedArticle
		if err := json.Unmarshal(data, &art); err != nil {
			continue
		}

		source := art.SourceName
		if source == "" {
			source = "Unknown"
		}

		s := stats[source]
		s.Name = source
		s.TotalDiscovered++
		if art.CompressedSummary != "" {
			s.TotalCompressed++
		}

		fetchTime := parseFetchDate(art.FetchDate)
		if !fetchTime.IsZero() && now.Sub(fetchTime) < 24*time.Hour {
			s.RecentCount++
		}

		stats[source] = s
	}

	return stats
}

// MigrateArticleCache performs schema updates on all cached articles
func MigrateArticleCache() {
	articleDir := filepath.Join(".", ".cache", "articles")
	entries, err := os.ReadDir(articleDir)
	if err != nil {
		return
	}

	log.Printf("Starting article cache migration for %d files...", len(entries))
	migratedCount := 0

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		path := filepath.Join(articleDir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}

		// Use a map to handle unknown fields during migration
		var raw map[string]interface{}
		if err := json.Unmarshal(data, &raw); err != nil {
			continue
		}

		changed := false

		// 1. facts -> compressed_summary
		if facts, ok := raw["facts"]; ok && facts != "" {
			if cs, exists := raw["compressed_summary"]; !exists || cs == "" {
				raw["compressed_summary"] = facts
				delete(raw, "facts")
				changed = true
			}
		}

		// 2. infer source_name from link
		if sn, ok := raw["source_name"]; !ok || sn == "" {
			if link, ok := raw["link"].(string); ok && link != "" {
				inferred := inferSourceName(link)
				raw["source_name"] = inferred
				changed = true
			}
		}

		if changed {
			b, _ := json.MarshalIndent(raw, "", "  ")
			os.WriteFile(path, b, 0644)
			migratedCount++
		}
	}

	if migratedCount > 0 {
		log.Printf("Migrated %d articles to new schema", migratedCount)
	}
}

func inferSourceName(link string) string {
	u, err := url.Parse(link)
	if err != nil {
		return "Unknown"
	}
	host := u.Host
	if host == "" {
		return "Unknown"
	}

	// Clean up common prefixes
	host = strings.TrimPrefix(host, "www.")
	host = strings.TrimPrefix(host, "edition.")
	host = strings.TrimPrefix(host, "mobile.")

	// Check Google News redirect links
	if strings.Contains(host, "news.google.com") {
		return "Unknown" // We can't easily resolve these without fetching
	}

	// Map common domains to friendly names
	mapping := map[string]string{
		"reuters.com":        "Reuters",
		"apnews.com":         "Associated Press",
		"bbc.co.uk":          "BBC News",
		"bbc.com":            "BBC News",
		"theguardian.com":    "The Guardian",
		"militarytimes.com":  "Military Times",
		"nytimes.com":        "NY Times",
		"washingtonpost.com": "Washington Post",
		"bloomberg.com":      "Bloomberg",
		"edition.cnn.com":    "CNN",
		"cnn.com":            "CNN",
	}

	// Direct match
	if name, ok := mapping[host]; ok {
		return name
	}

	// Check if any mapping domain is a suffix
	for domain, name := range mapping {
		if strings.HasSuffix(host, domain) {
			return name
		}
	}

	return host // Default to the domain name
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
