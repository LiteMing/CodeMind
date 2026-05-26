package main

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"

	"code-mind/internal/collab"
	"code-mind/internal/server"
	"code-mind/internal/store"
)

const desktopAPIAddress = "127.0.0.1:34117"

type App struct {
	ctx        context.Context
	apiServer  *http.Server
	collab     *collab.Server
	store      *store.FileStore
	startError error
}

func NewApp(fileStore *store.FileStore) *App {
	return &App{
		store: fileStore,
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// settingsDir is the parent of the maps directory (i.e. "data/")
	settingsDir := filepath.Dir(a.store.Dir())
	tokenStore, err := store.NewTokenStore(filepath.Join(settingsDir, "tokens.json"))
	if err != nil {
		a.startError = err
		fmt.Println("token store error:", err)
	}
	apiHandler := server.NewWithTokenStore(a.store, settingsDir, tokenStore).Handler()
	a.apiServer = &http.Server{
		Addr:    desktopAPIAddress,
		Handler: apiHandler,
	}
	a.collab = collab.NewServer(collab.DefaultAddress, tokenStore)

	go func() {
		err := a.apiServer.ListenAndServe()
		if err != nil && err != http.ErrServerClosed {
			a.startError = err
			fmt.Println("desktop api server error:", err)
		}
	}()

	go func() {
		err := a.collab.ListenAndServe()
		if err != nil && err != http.ErrServerClosed {
			fmt.Println("collaboration server disabled:", err)
		}
	}()
}

func (a *App) shutdown(_ context.Context) {
	if a.collab != nil {
		_ = a.collab.Shutdown(context.Background())
	}
	if a.apiServer != nil {
		_ = a.apiServer.Shutdown(context.Background())
	}
}
