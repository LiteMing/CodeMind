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

	// Resolve data directory relative to the executable's location,
	// so the server works regardless of the working directory.
	exePath, err := os.Executable()
	if err != nil {
		log.Fatal("failed to resolve executable path:", err)
	}
	exeDir := filepath.Dir(exePath)
	dataPath := filepath.Join(exeDir, "data", "maps")

	fileStore := store.NewFileStore(dataPath)
	settingsDir := filepath.Dir(dataPath) // "{exeDir}/data/"
	appServer := server.New(fileStore, settingsDir)

	log.Printf("Code Mind server listening on http://localhost:%s", port)
	if err := http.ListenAndServe(":"+port, appServer.Handler()); err != nil {
		log.Fatal(err)
	}
}
