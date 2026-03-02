package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/joho/godotenv"
	"github.com/kdub/ag_news/api"
)

func main() {
	// Attempt to load .env file, ignore error if it doesn't exist
	_ = godotenv.Load()

	if os.Getenv("GEMINI_API_KEY") == "" {
		log.Println("WARNING: GEMINI_API_KEY is not set. Topics will fail to cluster.")
	}

	appState := api.NewAppState()

	mux := http.NewServeMux()

	// 1. API Endpoints
	mux.HandleFunc("/api/topics", appState.HandleGetTopics)
	mux.HandleFunc("/api/digest", appState.HandleGenerateDigest)
	mux.HandleFunc("/api/dates", appState.HandleListDates)

	// 2. Serve static files (HTML, CSS, JS)
	fs := http.FileServer(http.Dir("./static"))
	mux.Handle("/", fs)

	port := "8080"
	fmt.Printf("ag_news web server running on http://localhost:%s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
