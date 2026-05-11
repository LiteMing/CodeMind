package main

import (
	"embed"
	"log"
	"os"
	"path/filepath"

	"code-mind/internal/store"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Resolve data directory relative to the executable's location,
	// so the app works regardless of the working directory.
	exePath, err := os.Executable()
	if err != nil {
		log.Fatal("failed to resolve executable path:", err)
	}
	exeDir := filepath.Dir(exePath)
	dataDir := filepath.Join(exeDir, "data", "maps")

	fileStore := store.NewFileStore(dataDir)
	app := NewApp(fileStore)

	err = wails.Run(&options.App{
		Title:  "Code Mind",
		Width:  1440,
		Height: 920,
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
