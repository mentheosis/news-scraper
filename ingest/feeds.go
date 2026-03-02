package ingest

// FeedSource represents a single news source and its RSS/Atom feed URL.
type FeedSource struct {
	Name string
	URL  string
}

// GetFeeds returns the configured list of news sources.
func GetFeeds() []FeedSource {
	return []FeedSource{
		{Name: "Reuters", URL: "https://news.google.com/rss/search?q=when:24h+allinurl:reuters.com"},         // Google News RSS proxy for Reuters
		{Name: "Associated Press", URL: "https://news.google.com/rss/search?q=when:24h+allinurl:apnews.com"}, // Google News RSS proxy for AP
		{Name: "BBC News", URL: "http://feeds.bbci.co.uk/news/rss.xml"},
		{Name: "Military Times", URL: "https://www.militarytimes.com/arc/outboundfeeds/rss/"},
		{Name: "The Guardian", URL: "https://www.theguardian.com/world/rss"},
		// {Name: "New York Times", URL: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"},
		// {Name: "Financial Times", URL: "https://www.ft.com/news-feed?format=rss"}, // valid FT format
	}
}
