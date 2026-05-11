package main

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"

	"code-mind/internal/server"
	"code-mind/internal/store"
)

const desktopAPIAddress = "127.0.0.1:34117"

type App struct {
	ctx        context.Context
	apiServer  *http.Server
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
	apiHandler := server.New(a.store, settingsDir).APIHandler()
	a.apiServer = &http.Server{
		Addr:    desktopAPIAddress,
		Handler: apiHandler,
	}

	go func() {
		err := a.apiServer.ListenAndServe()
		if err != nil && err != http.ErrServerClosed {
			a.startError = err
			fmt.Println("desktop api server error:", err)
		}
	}()
}

func (a *App) shutdown(_ context.Context) {
	if a.apiServer == nil {
		return
	}
	_ = a.apiServer.Shutdown(context.Background())
}
