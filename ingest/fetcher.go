package ingest

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/mmcdole/gofeed"
)

// ArticleSummary represents a parsed item from an RSS feed.
type ArticleSummary struct {
	SourceName        string     `json:"source_name"`
	Title             string     `json:"title"`
	Link              string     `json:"link"`
	Summary           string     `json:"summary"` // Usually the RSS description
	CompressedSummary string     `json:"compressed_summary"`
	Published         *time.Time `json:"published"`
	FetchDate         string     `json:"fetch_date"`
}

// FeedStatus represents the health and extraction count for a specific feed source.
type FeedStatus struct {
	Name            string         `json:"name"`
	URL             string         `json:"url"`
	ArticleCount    int            `json:"article_count"`    // total fetched this run
	NewCount        int            `json:"new_count"`        // brand new to the system
	CachedCount     int            `json:"cached_count"`     // already existed in clusters
	TotalDiscovered int            `json:"total_discovered"` // total history
	TotalCompressed int            `json:"total_compressed"` // articles with summary
	RecentCount     int            `json:"recent_count"`     // fetched in last 24h
	SkippedCount    int            `json:"skipped_count"`    // failed to scrape
	SourceBreakdown map[string]int `json:"source_breakdown,omitempty"`
	Error           string         `json:"error,omitempty"`
}

// FetchFeeds grabs the latest items from all provided feeds concurrently.
// It limits to the top maxItemsPerFeed items.
func FetchFeeds(ctx context.Context, feeds []FeedSource, maxItemsPerFeed int) ([]ArticleSummary, map[string]FeedStatus) {
	var wg sync.WaitGroup
	var mu sync.Mutex
	var allArticles []ArticleSummary
	feedStats := make(map[string]FeedStatus)

	fp := gofeed.NewParser()

	for _, feed := range feeds {
		wg.Add(1)
		go func(f FeedSource) {
			defer wg.Done()

			status := FeedStatus{
				Name: f.Name,
				URL:  f.URL,
			}

			// Parse URL with context to allow cancellation/timeouts
			log.Printf("Fetching feed %s (%s)...", f.Name, f.URL)
			feedData, err := fp.ParseURLWithContext(f.URL, ctx)
			if err != nil {
				log.Printf("Error parsing feed %s (%s): %v", f.Name, f.URL, err)
				status.Error = err.Error()

				mu.Lock()
				feedStats[f.Name] = status
				mu.Unlock()
				return
			}

			var sourceArticles []ArticleSummary
			for i, item := range feedData.Items {
				if i >= maxItemsPerFeed {
					break
				}

				art := ArticleSummary{
					SourceName: f.Name,
					Title:      item.Title,
					Link:       item.Link,
					Summary:    item.Description,
					Published:  item.PublishedParsed,
				}
				sourceArticles = append(sourceArticles, art)
			}

			status.ArticleCount = len(sourceArticles)

			mu.Lock()
			allArticles = append(allArticles, sourceArticles...)
			feedStats[f.Name] = status
			mu.Unlock()

		}(feed)
	}

	wg.Wait()
	fmt.Printf("Fetched %d articles across %d sources\n", len(allArticles), len(feeds))
	return allArticles, feedStats
}
