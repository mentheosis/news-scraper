package services

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"regexp"
	"sort"

	"github.com/kdub/ag_news/ingest"
)

// TopicCache representation to avoid JSON serialization tags conflicting with API payload
type TopicCache struct {
	Title        string                  `json:"title"`
	Description  string                  `json:"description"`
	SourceCounts map[string]int          `json:"source_counts"`
	Articles     []ingest.ArticleSummary `json:"articles"`
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
		return nil, fmt.Errorf("failed to decode cache: %w", err)
	}

	var clusters []*TopicCluster
	for _, c := range cached {
		clusters = append(clusters, &TopicCluster{
			Title:        c.Title,
			Description:  c.Description,
			SourceCounts: c.SourceCounts,
			Articles:     c.Articles,
			Indices:      []int{},
		})
	}
	return clusters, nil
}

func SaveClustersCache(date string, clusters []*TopicCluster) error {
	path := getCacheFilePath(date)
	var cached []TopicCache
	for _, c := range clusters {
		cached = append(cached, TopicCache{
			Title:        c.Title,
			Description:  c.Description,
			SourceCounts: c.SourceCounts,
			Articles:     c.Articles,
		})
	}

	data, err := json.MarshalIndent(cached, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to encode cache: %w", err)
	}

	return os.WriteFile(path, data, 0644)
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
