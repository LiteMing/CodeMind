package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func (s *Server) handleFrontend(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, fmt.Errorf("unknown api route: %s", r.URL.Path))
		return
	}
	if strings.HasPrefix(r.URL.Path, "/share/") {
		s.handleShareDebugPage(w, r)
		return
	}

	distDir := resolveFrontendDistDir()
	indexPath := filepath.Join(distDir, "index.html")

	if _, err := os.Stat(indexPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			http.Error(
				w,
				"frontend build not found. Run `cd frontend && npm install && npm run build` for production or `npm run dev` for local development.",
				http.StatusNotFound,
			)
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	cleanPath := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	requestPath := filepath.Join(distDir, filepath.FromSlash(cleanPath))
	if info, err := os.Stat(requestPath); err == nil && !info.IsDir() {
		http.ServeFile(w, r, requestPath)
		return
	}

	http.ServeFile(w, r, indexPath)
}

func resolveFrontendDistDir() string {
	candidates := []string{
		filepath.Join("frontend", "dist"),
		"dist",
	}
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates = append(candidates,
			filepath.Join(exeDir, "frontend", "dist"),
			filepath.Join(exeDir, "dist"),
			filepath.Join(exeDir, "..", "frontend", "dist"),
			filepath.Join(exeDir, "..", "dist"),
		)
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(filepath.Join(candidate, "index.html")); err == nil {
			return candidate
		}
	}
	return filepath.Join("frontend", "dist")
}

func (s *Server) handleShareDebugPage(w http.ResponseWriter, r *http.Request) {
	mapID := strings.TrimPrefix(r.URL.Path, "/share/")
	mapID = strings.TrimSpace(path.Clean("/" + mapID))
	mapID = strings.TrimPrefix(mapID, "/")
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if mapID == "" || mapID == "." {
		http.Error(w, "mapId is required", http.StatusBadRequest)
		return
	}
	if token == "" {
		http.Error(w, "token is required", http.StatusBadRequest)
		return
	}

	mapIDJSON, _ := json.Marshal(mapID)
	tokenJSON, _ := json.Marshal(token)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Code Mind Share Debug</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; }
    main { max-width: 960px; margin: 0 auto; padding: 32px 20px; }
    .card { background: rgba(15, 23, 42, .92); border: 1px solid rgba(148, 163, 184, .28); border-radius: 18px; padding: 22px; box-shadow: 0 24px 60px rgba(0,0,0,.28); }
    .status { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; background: #334155; color: #cbd5e1; }
    .status.ok { background: #064e3b; color: #a7f3d0; }
    .status.bad { background: #7f1d1d; color: #fecaca; }
    code, pre { background: #020617; border: 1px solid rgba(148, 163, 184, .22); border-radius: 12px; }
    code { padding: 2px 6px; }
    pre { min-height: 260px; overflow: auto; padding: 16px; white-space: pre-wrap; }
    button { border: 0; border-radius: 999px; padding: 10px 14px; background: #38bdf8; color: #082f49; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <p>Code Mind 本地分享调试页</p>
      <h1>WebSocket 协作连接测试</h1>
      <p>这是普通网页入口，页面会在内部连接 WebSocket。不要直接在浏览器地址栏打开 <code>ws://</code>。</p>
      <p>Map ID：<code id="map-id"></code></p>
      <p>状态：<span id="status" class="status">准备连接</span></p>
      <p><button id="reconnect">重新连接</button></p>
      <h2>消息日志</h2>
      <pre id="log"></pre>
    </section>
  </main>
  <script>
    const mapId = %s;
    const token = %s;
    const statusEl = document.getElementById('status');
    const logEl = document.getElementById('log');
    document.getElementById('map-id').textContent = mapId;

    let socket;
    function log(message) {
      logEl.textContent += '[' + new Date().toLocaleTimeString() + '] ' + message + '\n';
      logEl.scrollTop = logEl.scrollHeight;
    }
    function setStatus(text, cls) {
      statusEl.textContent = text;
      statusEl.className = 'status ' + (cls || '');
    }
    function connect() {
      if (socket) socket.close();
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = location.hostname + ':34118';
      const url = protocol + '//' + host + '/ws?mapId=' + encodeURIComponent(mapId) + '&token=' + encodeURIComponent(token);
      setStatus('连接中', '');
      log('connect ' + url.replace(token, '{token}'));
      socket = new WebSocket(url);
      socket.addEventListener('open', () => {
        setStatus('已连接', 'ok');
        log('open');
      });
      socket.addEventListener('message', (event) => log('message ' + event.data));
      socket.addEventListener('close', (event) => {
        setStatus('已断开 ' + event.code, 'bad');
        log('close code=' + event.code + ' reason=' + event.reason);
      });
      socket.addEventListener('error', () => {
        setStatus('连接错误', 'bad');
        log('error');
      });
    }
    document.getElementById('reconnect').addEventListener('click', connect);
    connect();
  </script>
</body>
</html>`, string(mapIDJSON), string(tokenJSON))
}
