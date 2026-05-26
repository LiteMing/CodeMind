package main

import (
	"embed"
	"log"
	"path/filepath"

	"code-mind/internal/appdata"
	"code-mind/internal/store"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	dataRoot, err := appdata.ResolveDataDir()
	if err != nil {
		log.Fatal("failed to resolve data directory:", err)
	}
	dataDir := filepath.Join(dataRoot, "maps")

	fileStore := store.NewFileStore(dataDir)
	app := NewApp(fileStore)

	err = wails.Run(&options.App{
		Title:     "Code Mind",
		Width:     1440,
		Height:    920,
		MinWidth:  1100,
		MinHeight: 720,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 245, G: 244, B: 239, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Windows: &windows.Options{
			WebviewIsTransparent: false,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
