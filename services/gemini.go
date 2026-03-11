package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"google.golang.org/genai"
)

func GetGeminiClient(ctx context.Context) (*genai.Client, error) {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("GEMINI_API_KEY environment variable is not set")
	}

	return genai.NewClient(ctx, &genai.ClientConfig{
		APIKey: apiKey,
	})
}

func GenerateContent(ctx context.Context, client *genai.Client, prompt string) (string, error) {
	resp, err := client.Models.GenerateContent(ctx, "gemini-2.0-flash", genai.Text(prompt), nil)
	if err != nil {
		return "", err
	}

	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("no response generated")
	}

	return resp.Candidates[0].Content.Parts[0].Text, nil
}

func getDigestCacheDir() string {
	dir := filepath.Join(".", ".cache", "digests")
	os.MkdirAll(dir, 0755)
	return dir
}

func getDigestHash(articles []CachedArticle) string {
	links := make([]string, len(articles))
	for i, a := range articles {
		links[i] = a.Link
	}
	return GetDigestHashFromLinks(links)
}

// GetDigestHashFromLinks computes a stable hash from a list of article links
func GetDigestHashFromLinks(links []string) string {
	hashes := make([]string, len(links))
	for i, l := range links {
		h := sha256.Sum256([]byte(l))
		hashes[i] = hex.EncodeToString(h[:])
	}
	sort.Strings(hashes)

	combined := strings.Join(hashes, "")
	finalHash := sha256.Sum256([]byte(combined))
	return hex.EncodeToString(finalHash[:])
}

// IsDigestCached checks if a digest already exists for the given articles
func IsDigestCached(articles []CachedArticle) bool {
	links := make([]string, len(articles))
	for i, a := range articles {
		links[i] = a.Link
	}
	_, exists := GetCachedDigest(links)
	return exists
}

// GetCachedDigest returns the cached digest content if it exists
func GetCachedDigest(links []string) (string, bool) {
	if len(links) == 0 {
		return "", false
	}
	hash := GetDigestHashFromLinks(links)
	path := filepath.Join(getDigestCacheDir(), hash+".md")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	return string(data), true
}

// GenerateDigest takes a list of compressed article facts
// and returns a synthesized Markdown digest using Gemini.
func GenerateDigest(ctx context.Context, articles []CachedArticle, previousDigest string) (string, error) {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return "", fmt.Errorf("GEMINI_API_KEY environment variable is not set")
	}

	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey: apiKey,
	})
	if err != nil {
		return "", fmt.Errorf("failed to create genai client: %w", err)
	}

	// 0. Log match status
	if previousDigest != "" {
		log.Printf("[Gemini] Previous context found for '%s' (%d chars). Check cache next.\n", articles[0].Title, len(previousDigest))
	}

	// 1. Check Digest Cache
	digestHash := getDigestHash(articles)
	cachePath := filepath.Join(getDigestCacheDir(), digestHash+".md")
	cachedData, err := os.ReadFile(cachePath)
	if err == nil {
		log.Printf("[Gemini] Serving digest for '%s' from cache.\n", articles[0].Title)
		return string(cachedData), nil
	}

	// 2. Build the prompt with all the compressed articles
	log.Printf("[Gemini] Cache miss. Generating NEW digest for '%s'...\n", articles[0].Title)
	promptText := buildPrompt(articles, previousDigest)

	// In a fully robust system, we would:
	// 1. Ask Gemini to extract key *events* from the articles.
	// 2. Fetch those events from Wikipedia using services.SearchWikipedia.
	// 3. Feed the Wikipedia summaries back into a final generation step.
	//
	promptText += "\n\nCRITICAL: If you mention specific recent events or ongoing geopolitical/economic situations, you MUST ask the user to provide Wikipedia summaries for them. However, since I cannot provide them interactively right now, please synthesize the provided article text into a concise, easy-to-read Markdown digest. Group by topic."

	resp, err := client.Models.GenerateContent(ctx, "gemini-2.5-flash", genai.Text(promptText), nil)
	if err != nil {
		return "", fmt.Errorf("failed to generate digest: %w", err)
	}

	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("no response generated")
	}

	part := resp.Candidates[0].Content.Parts[0]
	finalText := part.Text

	// Save to Digest Cache
	if err := os.WriteFile(cachePath, []byte(finalText), 0644); err != nil {
		log.Printf("Failed to cache digest: %v", err)
	}

	return finalText, nil
}

var curatedPersonas = map[string]string{
	"Ezra Klein":      "You are Ezra Klein. Give your hot take in 3-5 sentences — no more. Lead immediately with the structural or systemic insight everyone else is missing. Skip the throat-clearing. Be sharp, a little contrarian, and land on something that reframes the whole story.",
	"Paul Krugman":    "You are Paul Krugman. 2-4 sentences. Be blunt and economically precise. Call out the bad faith or the obvious bad policy if you see it. You can be smug. No padding.",
	"Felix Biederman": "You are Felix Biederman, co-host of Chapo Trap House. Dirtbag left. 2-4 sentences of cynical, funny, working-class-coded outrage. You can use sports metaphors. You are disgusted by liberals and conservatives alike but especially libs. Keep it caustic and a little unhinged.",
	"AOC":             "You are Alexandria Ocasio-Cortez. 3-5 sentences. Passionate, direct, and rooted in working-class and justice framing. Call out who benefits and who gets hurt. You speak plainly and don't hide your moral clarity.",
	"Tucker Carlson":  "You are Tucker Carlson. 3-5 sentences. Populist, anti-elite, suspicious of official narratives. Ask the questions the corporate media won't ask. Invoke the forgotten American. Sound like you're the only one willing to say it.",
	"JD Vance":        "You are JD Vance, Vice President of the United States. 3-5 sentences. Nationalist, anti-globalist, MAGA-aligned. Frame everything through what it means for working Americans and American sovereignty. You've moved far from Hillbilly Elegy — you're all in now.",
}

// GenerateHotTake generates a hot take on the given news digest, voiced as the named person.
// If the name matches a curated persona, a tailored prompt is used; otherwise a generic one is generated.
func GenerateHotTake(ctx context.Context, name string, digest string) (string, error) {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return "", fmt.Errorf("GEMINI_API_KEY environment variable is not set")
	}

	systemPrompt, ok := curatedPersonas[name]
	if !ok {
		systemPrompt = fmt.Sprintf(
			"You are %s. In 3-5 sentences, give your raw hot take on this news story — no preamble, no hedging. Pure voice. Distill your worldview, rhetorical style, and characteristic obsessions into something sharp and immediate.",
			name,
		)
	}

	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey: apiKey,
	})
	if err != nil {
		return "", fmt.Errorf("failed to create genai client: %w", err)
	}

	prompt := systemPrompt + "\n\nHere is a news digest about a current event. Read it and give your hot take on it:\n\n" + digest

	resp, err := client.Models.GenerateContent(ctx, "gemini-2.5-flash", genai.Text(prompt), nil)
	if err != nil {
		return "", fmt.Errorf("failed to generate hot take: %w", err)
	}

	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("no response generated")
	}

	return resp.Candidates[0].Content.Parts[0].Text, nil
}

func buildPrompt(articles []CachedArticle, previousDigest string) string {
	promptText := "You are a professional news digester. I will provide you with a list of extracted facts from several recent news articles covering a SINGLE major event or topic. Your job is to create a well-structured, comprehensive Markdown digest of this particular event based on the given facts.\n\n"

	if previousDigest != "" {
		promptText += "### PREVIOUS DAY'S SUMMARY DATA ###\n"
		promptText += previousDigest + "\n\n"
		promptText += "CRITICAL TASK: Your primary goal is to perform a DELTA ANALYSIS. Compare the new facts provided below with the previous day's summary above.\n"
		promptText += "YOU MUST START YOUR RESPONSE WITH A SECTION HEADED '## WHAT'S NEW TODAY'.\n"
		promptText += "In this section, explicitly list specific new facts, escalations, or changes that were NOT in the previous summary. If there are no major changes, highlight even the minor updates or confirmations of previous trends.\n\n"
	}

	promptText += "Formatting & Hierarchy Guidelines:\n"
	promptText += "- Use Markdown headers (## and ###) to logically divide the digest into clear sections (e.g., 'Overview', 'Key Developments', 'Impact', 'Background').\n"
	promptText += "- Use bulleted lists appropriately to highlight lists of facts, figures, or key takeaways. Do not just write a flat block of text.\n"
	promptText += "- Provide a cohesive summary of the event as it unfolded across the articles.\n"
	promptText += "- YOU MUST CITE YOUR SOURCES inline. Use markdown links to the original article URLs provided when citing facts, e.g., 'According to [Article 2](https://...), ...'.\n"
	promptText += "- Do NOT hallucinate information not present in the articles.\n\n"

	promptText += "Here are the articles covering this topic:\n\n"

	for i, a := range articles {
		promptText += fmt.Sprintf("--- Article %d ---\n", i+1)
		promptText += fmt.Sprintf("Source: %s\n", a.SourceName)
		promptText += fmt.Sprintf("Title: %s\n", a.Title)
		promptText += fmt.Sprintf("URL: %s\n", a.Link)
		promptText += fmt.Sprintf("Extracted Facts:\n%s\n\n", a.CompressedSummary)
	}

	return promptText
}
