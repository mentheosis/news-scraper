package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type GraphNode struct {
	ID      string  `json:"id"`
	Type    string  `json:"type"` // "topic" or "idea"
	Label   string  `json:"label"`
	Summary string  `json:"summary"`
	X       float64 `json:"x,omitempty"`
	Y       float64 `json:"y,omitempty"`
}

type GraphEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

type GraphData struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

var (
	graphCacheFile = ".cache/graph.json"
	graphMu        sync.Mutex
)

func SaveGraph(data GraphData) error {
	graphMu.Lock()
	defer graphMu.Unlock()

	dir := filepath.Dir(graphCacheFile)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	bytes, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(graphCacheFile, bytes, 0644)
}

func LoadGraph() (GraphData, error) {
	graphMu.Lock()
	defer graphMu.Unlock()

	var data GraphData
	bytes, err := os.ReadFile(graphCacheFile)
	if err != nil {
		if os.IsNotExist(err) {
			return data, nil // Return empty graph
		}
		return data, err
	}

	err = json.Unmarshal(bytes, &data)
	return data, err
}
