package main

import (
	"embed"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"code-mind/internal/appdata"
	"code-mind/internal/mcp"
	"code-mind/internal/store"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

// main dispatches between the three delivery modes of the single binary:
//
//	codemind            → desktop GUI (Wails)
//	codemind serve      → headless HTTP server (self-hosting / docker)
//	codemind mcp        → stdio MCP adapter for AI agents
//
// Dispatch must happen before any webview initialization.
func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "serve":
			attachParentConsole()
			runServe()
			return
		case "mcp":
			mcp.Run()
			return
		case "help", "-h", "--help":
			attachParentConsole()
			fmt.Println("Code Mind — usage:")
			fmt.Println("  codemind         start the desktop GUI")
			fmt.Println("  codemind serve   start the headless HTTP server (CODE_MIND_PORT, default 7979)")
			fmt.Println("  codemind mcp     start the stdio MCP adapter for AI agents")
			return
		}
		// Unknown arguments fall through to the GUI so OS-level launches
		// (file associations, shell handlers) keep working.
	}
	runGUI()
}

func runGUI() {
	dataRoot, err := appdata.ResolveDataDir()
	if err != nil {
		log.Fatal("failed to resolve data directory:", err)
	}
	dataDir := filepath.Join(dataRoot, "maps")
	webviewUserDataDir, err := appdata.ResolveWebviewUserDataDir()
	if err != nil {
		log.Fatal("failed to resolve webview data directory:", err)
	}

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
			WebviewUserDataPath:  webviewUserDataDir,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
