package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"code-mind/internal/appdata"
	"code-mind/internal/server"
	"code-mind/internal/store"
)

func main() {
	port := os.Getenv("CODE_MIND_PORT")
	if port == "" {
		port = "7979"
	}

	dataDir, err := appdata.ResolveDataDir()
	if err != nil {
		log.Fatal("failed to resolve data directory:", err)
	}
	dataPath := filepath.Join(dataDir, "maps")

	fileStore := store.NewFileStore(dataPath)
	settingsDir := filepath.Dir(dataPath) // "{exeDir}/data/"
	tokenStore, err := store.NewTokenStore(filepath.Join(settingsDir, "tokens.json"))
	if err != nil {
		log.Fatal("failed to open token store:", err)
	}
	appServer := server.NewWithTokenStore(fileStore, settingsDir, tokenStore)

	log.Printf("Code Mind server listening on http://localhost:%s", port)
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           appServer.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute,
		// AI proxy requests can legitimately take up to the configured AI
		// timeout (max 600s), so the write timeout must stay above that.
		WriteTimeout: 11 * time.Minute,
		IdleTimeout:  2 * time.Minute,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
