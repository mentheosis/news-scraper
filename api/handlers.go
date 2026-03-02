package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/kdub/ag_news/ingest"
	"github.com/kdub/ag_news/services"
)

// AppState holds the global state for our simple in-memory backend
type AppState struct {
	Clusters []*services.TopicCluster
	Feeds    []ingest.FeedSource
}

// TopicsResponse wraps the clustered topics and the raw feed health stats
type TopicsResponse struct {
	Clusters  []*services.TopicCluster     `json:"clusters"`
	FeedStats map[string]ingest.FeedStatus `json:"feed_stats"`
}

func NewAppState() *AppState {
	return &AppState{
		Feeds: ingest.GetFeeds(),
	}
}

// HandleGetTopics fetches the RSS feeds, clusters them with Gemini, and returns the JSON.
func (app *AppState) HandleGetTopics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := context.Background()

	// Parse limit from query, default to 15
	limit := 15
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 50 {
			limit = l
		}
	}

	// 1. Fetch RSS items
	log.Printf("Fetching feeds with limit %d...\n", limit)
	summaries, feedStats := ingest.FetchFeeds(ctx, app.Feeds, limit)

	if len(summaries) == 0 {
		http.Error(w, `{"error": "No articles found"}`, http.StatusInternalServerError)
		return
	}

	// Load Cache
	existingClusters, err := services.LoadClustersCache()
	if err != nil {
		log.Printf("Could not load cache: %v", err)
		existingClusters = []*services.TopicCluster{}
	}

	// Identify new articles
	existingLinks := make(map[string]bool)
	for _, c := range existingClusters {
		for _, a := range c.Articles {
			existingLinks[a.Link] = true
		}
	}

	var newArticles []ingest.ArticleSummary
	for _, a := range summaries {
		stat := feedStats[a.SourceName]
		if !existingLinks[a.Link] {
			newArticles = append(newArticles, a)
			stat.NewCount++
		} else {
			stat.CachedCount++
		}
		feedStats[a.SourceName] = stat
	}

	// 2. Cluster
	log.Printf("Clustering %d new articles into %d existing...", len(newArticles), len(existingClusters))
	clusters, err := services.ClusterTopics(ctx, existingClusters, newArticles)
	if err != nil {
		log.Printf("Clustering failed: %v", err)
		if isLimit, wait := services.IsRateLimitError(err); isLimit {
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":       "API Rate Limited",
				"retry_after": wait,
				"feed_stats":  feedStats,
			})
			return
		}
		http.Error(w, `{"error": "Failed to cluster topics"}`, http.StatusInternalServerError)
		return
	}

	// Save Cache
	if err := services.SaveClustersCache(clusters); err != nil {
		log.Printf("Failed to save cluster cache: %v", err)
	}

	// Save to memory so the frontend can retrieve them later
	app.Clusters = clusters

	resp := TopicsResponse{
		Clusters:  clusters,
		FeedStats: feedStats,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// HandleGenerateDigest takes a topic ID (index), scrapes its articles, and runs the Gemini summarization.
func (app *AppState) HandleGenerateDigest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	topicIdxStr := r.URL.Query().Get("topicId")
	topicIdx, err := strconv.Atoi(topicIdxStr)
	if err != nil || topicIdx < 0 || topicIdx >= len(app.Clusters) {
		http.Error(w, `{"error": "Invalid topic ID"}`, http.StatusBadRequest)
		return
	}

	selectedCluster := app.Clusters[topicIdx]
	ctx := context.Background()

	// 1. Scrape full content
	var fullArticles []ingest.ArticleContent
	for _, summary := range selectedCluster.Articles {
		articleData, err := ingest.ScrapeArticle(summary)
		if err != nil || len(articleData.FullText) < 100 {
			log.Printf("Skipping [%s] '%s' (%s) due to scrape failure/paywall", summary.SourceName, summary.Title, summary.Link)
			continue
		}
		fullArticles = append(fullArticles, *articleData)
	}

	if len(fullArticles) == 0 {
		http.Error(w, `{"error": "Could not scrape sufficient text for this topic."}`, http.StatusUnprocessableEntity)
		return
	}

	// 2. Compress the articles concurrently
	log.Printf("Compressing %d articles...", len(fullArticles))
	compressedArticles, err := services.CompressArticles(ctx, fullArticles)
	if err != nil {
		log.Printf("Compression failed: %v", err)
		if isLimit, wait := services.IsRateLimitError(err); isLimit {
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "API Rate Limited", "retry_after": wait})
			return
		}
		http.Error(w, `{"error": "Failed to extract facts from articles"}`, http.StatusInternalServerError)
		return
	}

	// 3. Generate digest using compressed facts
	log.Println("Generating synthesized digest...")
	digest, err := services.GenerateDigest(ctx, compressedArticles)
	if err != nil {
		log.Printf("Digest generation failed: %v", err)
		if isLimit, wait := services.IsRateLimitError(err); isLimit {
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "API Rate Limited", "retry_after": wait})
			return
		}
		http.Error(w, `{"error": "Failed to generate digest"}`, http.StatusInternalServerError)
		return
	}

	// Ensure the response is sent back safely as JSON
	response := map[string]interface{}{
		"title":    selectedCluster.Title,
		"digest":   digest,
		"articles": selectedCluster.Articles,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
