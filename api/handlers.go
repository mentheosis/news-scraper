package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/kdub/ag_news/ingest"
	"github.com/kdub/ag_news/services"
)

// AppState holds the global state for our simple in-memory backend
type AppState struct {
	Clusters  []*services.TopicCluster
	Feeds     []ingest.FeedSource
	FeedStats map[string]ingest.FeedStatus
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

	// Parse limit and refresh from query
	limit := 15
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 50 {
			limit = l
		}
	}
	refresh := r.URL.Query().Get("refresh") != "false"

	// Set headers for SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		log.Println("Streaming not supported for topics")
	}

	sendProgress := func(message string) {
		event := map[string]interface{}{
			"type":    "status",
			"message": message,
		}
		data, _ := json.Marshal(event)
		fmt.Fprintf(w, "event: progress\ndata: %s\n\n", data)
		if flusher != nil {
			flusher.Flush()
		}
	}

	sendError := func(message string) {
		fmt.Fprintf(w, "event: error\ndata: {\"message\": %q}\n\n", message)
		if flusher != nil {
			flusher.Flush()
		}
	}

	today := time.Now().Format("2006-01-02")
	targetDate := r.URL.Query().Get("date")
	if targetDate == "" {
		targetDate = today
	}

	// 1. If not refreshing, try to load from cache immediately
	if !refresh {
		sendProgress(fmt.Sprintf("Checking cache for %s...", targetDate))
		clusters, err := services.LoadClustersCache(targetDate)
		if err == nil && len(clusters) > 0 {
			log.Printf("Loading topics from cache (refresh=false)...\n")
			// Reconstruct basic feed stats from cached data
			feedStats := make(map[string]ingest.FeedStatus)
			for _, f := range app.Feeds {
				feedStats[f.Name] = ingest.FeedStatus{Name: f.Name, URL: f.URL}
			}
			for _, c := range clusters {
				cachedArticles := make([]services.CachedArticle, len(c.Articles))
				for i, a := range c.Articles {
					cachedArticles[i] = services.CachedArticle{Link: a.Link}
				}
				c.HasCachedDigest = services.IsDigestCached(cachedArticles)

				for _, a := range c.Articles {
					if s, ok := feedStats[a.SourceName]; ok {
						s.CachedCount++
						feedStats[a.SourceName] = s
					}
				}
			}

			app.Clusters = clusters
			app.FeedStats = feedStats

			resp := TopicsResponse{
				Clusters:  clusters,
				FeedStats: feedStats,
			}
			data, _ := json.Marshal(resp)
			fmt.Fprintf(w, "event: result\ndata: %s\n\n", data)
			return
		}
		sendProgress("No cache found, fetching live feeds...")
	}

	// 1. Fetch RSS items
	sendProgress(fmt.Sprintf("Fetching latest news from %d feeds...", len(app.Feeds)))
	summaries, feedStats := ingest.FetchFeeds(ctx, app.Feeds, limit)

	if len(summaries) == 0 {
		sendError("No articles found in any feeds")
		return
	}

	// Load Cache for clustering context
	existingClusters, err := services.LoadClustersCache(targetDate)
	if err != nil {
		existingClusters = []*services.TopicCluster{}
	}

	// Initialize feedStats with all known sources from app.Feeds
	feedStatsFull := make(map[string]ingest.FeedStatus)
	for _, f := range app.Feeds {
		if s, ok := feedStats[f.Name]; ok {
			feedStatsFull[f.Name] = s
		} else {
			feedStatsFull[f.Name] = ingest.FeedStatus{
				Name: f.Name,
				URL:  f.URL,
			}
		}
	}

	// Identify new articles and populate cached counts
	existingLinks := make(map[string]bool)
	for _, c := range existingClusters {
		for _, a := range c.Articles {
			existingLinks[a.Link] = true
			for name, stat := range feedStatsFull {
				if strings.EqualFold(name, a.SourceName) {
					stat.CachedCount++
					feedStatsFull[name] = stat
					break
				}
			}
		}
	}

	var newArticles []ingest.ArticleSummary
	for _, a := range summaries {
		var matchedName string
		for name := range feedStatsFull {
			if strings.EqualFold(name, a.SourceName) {
				matchedName = name
				break
			}
		}

		if matchedName != "" {
			stat := feedStatsFull[matchedName]
			if !existingLinks[a.Link] {
				a.FetchDate = targetDate // Set the date it was fetched
				newArticles = append(newArticles, a)
				stat.NewCount++
			}
			feedStatsFull[matchedName] = stat
		}
	}

	feedStats = feedStatsFull

	// 2. Cluster
	sendProgress(fmt.Sprintf("Clustering %d news articles into topics...", len(newArticles)+len(existingLinks)))
	clusters, err := services.ClusterTopics(ctx, existingClusters, newArticles)
	if err != nil {
		log.Printf("Clustering failed: %v", err)
		if isLimit, wait := services.IsRateLimitError(err); isLimit {
			fmt.Fprintf(w, "event: error\ndata: {\"error\": \"API Rate Limited\", \"retry_after\": %d}\n\n", wait)
			return
		}
		sendError("Failed to cluster topics")
		return
	}

	// Save Cache
	sendProgress("Finalizing and saving clusters...")
	for _, c := range clusters {
		cachedArticles := make([]services.CachedArticle, len(c.Articles))
		for i, a := range c.Articles {
			cachedArticles[i] = services.CachedArticle{Link: a.Link}
		}
		c.HasCachedDigest = services.IsDigestCached(cachedArticles)
	}

	if err := services.SaveClustersCache(targetDate, clusters); err != nil {
		log.Printf("Failed to save cluster cache: %v", err)
	}

	app.Clusters = clusters
	app.FeedStats = feedStats

	resp := TopicsResponse{
		Clusters:  clusters,
		FeedStats: feedStats,
	}
	data, _ := json.Marshal(resp)
	fmt.Fprintf(w, "event: result\ndata: %s\n\n", data)
}

// HandleListDates returns the available cached news dates
func (app *AppState) HandleListDates(w http.ResponseWriter, r *http.Request) {
	dates := services.ListCacheDates()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"dates": dates})
}

// HandleGenerateDigest takes a topic ID (index), scrapes its articles, and runs the Gemini summarization.
func (app *AppState) HandleGenerateDigest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 0. Extract date and load clusters for that date
	targetDate := r.URL.Query().Get("date")
	if targetDate == "" {
		targetDate = time.Now().Format("2006-01-02")
	}

	clusters, err := services.LoadClustersCache(targetDate)
	if err != nil || len(clusters) == 0 {
		http.Error(w, fmt.Sprintf(`{"error": "No cached topics found for %s"}`, targetDate), http.StatusNotFound)
		return
	}

	topicIdxStr := r.URL.Query().Get("topicId")
	topicIdx, err := strconv.Atoi(topicIdxStr)
	if err != nil || topicIdx < 0 || topicIdx >= len(clusters) {
		http.Error(w, `{"error": "Invalid topic ID"}`, http.StatusBadRequest)
		return
	}

	selectedCluster := clusters[topicIdx]
	ctx := context.Background()

	// Set headers for SSE if the client supports it or we want to stream
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // Disable proxy buffering

	flusher, ok := w.(http.Flusher)
	if !ok {
		// Fallback to non-streaming if flusher is not available
		log.Println("Streaming not supported by response writer")
	}

	sendProgress := func(step int, message string) {
		event := map[string]interface{}{
			"type":    "progress",
			"step":    step,
			"message": message,
		}
		data, _ := json.Marshal(event)
		fmt.Fprintf(w, "data: %s\n\n", data)
		if flusher != nil {
			flusher.Flush()
		}
	}

	// 0. Check for existing cached digest first
	links := make([]string, len(selectedCluster.Articles))
	for i, a := range selectedCluster.Articles {
		links[i] = a.Link
	}
	if cachedContent, exists := services.GetCachedDigest(links); exists {
		log.Printf("Synthesizing: Serving fully cached digest for '%s'", selectedCluster.Title)
		resp := map[string]interface{}{
			"title":            selectedCluster.Title,
			"digest":           cachedContent,
			"articles":         selectedCluster.Articles,
			"skipped_articles": []ingest.ArticleSummary{},
			"feed_stats":       app.FeedStats,
		}
		data, _ := json.Marshal(resp)
		fmt.Fprintf(w, "event: result\ndata: %s\n\n", data)
		if flusher != nil {
			flusher.Flush()
		}
		return
	}

	// targetDate is already extracted and validated at the top of the handler

	var filteredArticles []ingest.ArticleSummary
	for _, a := range selectedCluster.Articles {
		if a.FetchDate == "" || a.FetchDate == targetDate {
			filteredArticles = append(filteredArticles, a)
		}
	}

	if len(filteredArticles) == 0 {
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", fmt.Sprintf(`{"message": "No articles found that were fetched on %s."}`, targetDate))
		return
	}

	// 1. Prepare articles
	sendProgress(1, fmt.Sprintf("Preparing %d articles (checking cache)...", len(filteredArticles)))

	var readyArt []services.CachedArticle
	var needsScraping []ingest.ArticleSummary
	var skippedArticles []ingest.ArticleSummary

	for _, s := range filteredArticles {
		if s.CompressedSummary != "" {
			readyArt = append(readyArt, services.CachedArticle{
				Link:              s.Link,
				Title:             s.Title,
				SourceName:        s.SourceName,
				RSSSummary:        s.Summary,
				CompressedSummary: s.CompressedSummary,
				Published:         s.Published,
				FetchDate:         s.FetchDate,
			})
		} else {
			needsScraping = append(needsScraping, s)
		}
	}

	var fullArticles []ingest.ArticleContent
	var skippedCount int

	if len(needsScraping) > 0 {
		sendProgress(1, fmt.Sprintf("Scraping %d new articles for %s (skipping %d cached)...", len(needsScraping), targetDate, len(readyArt)))
		for _, summary := range needsScraping {
			articleData, err := ingest.ScrapeArticle(summary)
			if err != nil {
				log.Printf("Failed to scrape %s: %v", summary.Link, err)
				skippedCount++
				skippedArticles = append(skippedArticles, summary)
				if stat, ok := app.FeedStats[summary.SourceName]; ok {
					stat.SkippedCount++
					app.FeedStats[summary.SourceName] = stat
				}
				continue
			}

			if len(articleData.FullText) < 100 {
				log.Printf("Short text skip: %s (%d chars)", summary.Link, len(articleData.FullText))
				skippedCount++
				skippedArticles = append(skippedArticles, summary)
				continue
			}

			fullArticles = append(fullArticles, *articleData)
		}
	}

	if len(readyArt) == 0 && len(fullArticles) == 0 {
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", `{"message": "Could not acquire any valid article summaries for this topic."}`)
		return
	}

	// 2. Compress new articles concurrently
	cachedArticles := readyArt
	if len(fullArticles) > 0 {
		sendProgress(2, fmt.Sprintf("Extracting facts from %d new articles...", len(fullArticles)))
		newlyCompressed, err := services.CompressArticles(ctx, fullArticles)
		if err != nil {
			if isLimit, wait := services.IsRateLimitError(err); isLimit {
				event := map[string]interface{}{
					"type":        "error",
					"error":       "API Rate Limited",
					"retry_after": wait,
				}
				data, _ := json.Marshal(event)
				fmt.Fprintf(w, "event: error\ndata: %s\n\n", data)
				return
			}
			if services.IsOverloadedError(err) {
				fmt.Fprintf(w, "event: error\ndata: %s\n\n", `{"error": "API Overloaded", "message": "Gemini API is currently overloaded. Please try again in a few moments."}`)
				return
			}
			fmt.Fprintf(w, "event: error\ndata: %s\n\n", `{"message": "Failed to extract facts from articles"}`)
			return
		}
		cachedArticles = append(cachedArticles, newlyCompressed...)
	}

	// 3. Generate digest (with yesterday's context if available)
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	if t, err := time.Parse("2006-01-02", targetDate); err == nil {
		yesterday = t.AddDate(0, 0, -1).Format("2006-01-02")
	}
	var previousDigest string

	yesterdayClusters, err := services.LoadClustersCache(yesterday)
	if err == nil {
		foundMatch := false
		for _, yc := range yesterdayClusters {
			// Try exact-ish match (EqualFold handles case)
			if strings.EqualFold(yc.Title, selectedCluster.Title) {
				// Match! Try to load its digest
				prevLinks := make([]string, len(yc.Articles))
				for i, a := range yc.Articles {
					prevLinks[i] = a.Link
				}
				if content, exists := services.GetCachedDigest(prevLinks); exists {
					previousDigest = content
					foundMatch = true
					log.Printf("[Deltas] Found yesterday's digest for '%s', using as context.\n", yc.Title)
					break
				}
			}
		}
		if !foundMatch {
			log.Printf("[Deltas] No matching topic title found in yesterday's cache for '%s'.\n", selectedCluster.Title)
		}
	} else {
		log.Printf("[Deltas] Missing yesterday's cluster cache (%s): %v\n", yesterday, err)
	}

	sendProgress(3, "Synthesizing final digest with Gemini...")
	digest, err := services.GenerateDigest(ctx, cachedArticles, previousDigest)
	if err != nil {
		if isLimit, wait := services.IsRateLimitError(err); isLimit {
			event := map[string]interface{}{
				"type":        "error",
				"error":       "API Rate Limited",
				"retry_after": wait,
			}
			data, _ := json.Marshal(event)
			fmt.Fprintf(w, "event: error\ndata: %s\n\n", data)
			return
		}
		if services.IsOverloadedError(err) {
			fmt.Fprintf(w, "event: error\ndata: %s\n\n", `{"error": "API Overloaded", "message": "Gemini API is currently overloaded. Please try again in a few moments."}`)
			return
		}
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", `{"message": "Failed to generate digest"}`)
		return
	}

	// Final result
	response := map[string]interface{}{
		"type":             "result",
		"title":            selectedCluster.Title,
		"digest":           digest,
		"articles":         selectedCluster.Articles,
		"skipped_articles": skippedArticles,
		"feed_stats":       app.FeedStats,
	}
	data, _ := json.Marshal(response)
	fmt.Fprintf(w, "event: result\ndata: %s\n\n", data)
}
