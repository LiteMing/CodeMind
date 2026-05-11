package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"code-mind/internal/server"
	"code-mind/internal/store"
)

func main() {
	port := os.Getenv("CODE_MIND_PORT")
	if port == "" {
		port = "7979"
	}

	dataPath := filepath.Join("data", "maps")
	fileStore := store.NewFileStore(dataPath)
	settingsDir := filepath.Dir(dataPath) // "data/"
	appServer := server.New(fileStore, settingsDir)

	log.Printf("Code Mind server listening on http://localhost:%s", port)
	if err := http.ListenAndServe(":"+port, appServer.Handler()); err != nil {
		log.Fatal(err)
	}
}
