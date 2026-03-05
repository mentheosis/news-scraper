package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/kdub/ag_news/ingest"
	"google.golang.org/genai"
)

// CachedArticle is defined in cache.go

func getArticleCacheDir() string {
	dir := filepath.Join(".", ".cache", "articles")
	os.MkdirAll(dir, 0755)
	return dir
}

func getArticleHash(link string) string {
	hash := sha256.Sum256([]byte(link))
	return hex.EncodeToString(hash[:])
}

// CompressArticles takes a slice of raw full articles and compresses them concurrently via Gemini.
// It checks the local disk cache first before calling the LLM.
func CompressArticles(ctx context.Context, articles []ingest.ArticleContent) ([]CachedArticle, error) {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("GEMINI_API_KEY environment variable is not set")
	}

	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey: apiKey,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create genai client: %w", err)
	}

	cacheDir := getArticleCacheDir()
	results := make([]CachedArticle, len(articles))
	var wg sync.WaitGroup
	var errMu sync.Mutex
	var firstErr error

	// Concurrency limit semaphore to avoid 429 Too Many Requests
	sem := make(chan struct{}, 5)

	for i, art := range articles {
		wg.Add(1)
		go func(idx int, article ingest.ArticleContent) {
			defer wg.Done()

			// Check for early exit globally
			errMu.Lock()
			if firstErr != nil {
				errMu.Unlock()
				return
			}
			errMu.Unlock()

			hash := getArticleHash(article.Link)
			cachePath := filepath.Join(cacheDir, hash+".json")

			// 1. Check local cache
			data, err := os.ReadFile(cachePath)
			if err == nil {
				var cached CachedArticle
				if json.Unmarshal(data, &cached) == nil && cached.CompressedSummary != "" {
					results[idx] = cached
					return
				}
			}

			log.Printf("Cache miss. Starting compression for: %s", article.Title)

			// 2. Fetch via LLM API
			sem <- struct{}{}
			defer func() { <-sem }()

			prompt := "Extract the critical facts, figures, dates, and key information from the following news article text. Ignore boilerplate, ads, or unrelated links. Keep it concise (a few bullet points or a short paragraph) representing the raw facts to be used later in a synthesized digest.\n\n"
			prompt += fmt.Sprintf("Title: %s\nText:\n%s", article.Title, article.FullText)

			var summary string
			resp, err := client.Models.GenerateContent(ctx, "gemini-2.5-flash", genai.Text(prompt), nil)
			if err != nil {
				log.Printf("Failed to compress article '%s': %v", article.Title, err)
				errMu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				errMu.Unlock()
				return
			}

			if len(resp.Candidates) > 0 && len(resp.Candidates[0].Content.Parts) > 0 {
				summary = resp.Candidates[0].Content.Parts[0].Text
			} else {
				summary = "Failed to extract summary."
			}

			// Save to central store
			SaveCompressedSummary(article.Link, summary)

			// Reload full metadata to return complete object
			if cached, err := LoadArticleMetadata(article.Link); err == nil {
				// LoadArticleMetadata returns ArticleSummary, we need CachedArticle
				results[idx] = CachedArticle{
					Link:              cached.Link,
					Title:             cached.Title,
					SourceName:        cached.SourceName,
					RSSSummary:        cached.Summary,
					CompressedSummary: summary,
					Published:         cached.Published,
					FetchDate:         cached.FetchDate,
				}
			} else {
				results[idx] = CachedArticle{
					Link:              article.Link,
					Title:             article.Title,
					SourceName:        article.SourceName,
					RSSSummary:        article.Summary,
					CompressedSummary: summary,
					Published:         article.Published,
					FetchDate:         article.FetchDate,
				}
			}

		}(i, art)
	}

	wg.Wait()

	if firstErr != nil {
		return nil, firstErr
	}

	return results, nil
}
