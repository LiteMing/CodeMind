package server

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// validateAIBaseURL guards the AI proxy against SSRF. The scheme must always
// be http or https. When strict is true (collaboration mode, where remote
// token holders can set the base URL), hosts resolving to loopback, private,
// or link-local addresses are rejected as well. In pure local mode those are
// allowed so users can point at localhost model runtimes such as Ollama.
func validateAIBaseURL(baseURL string, strict bool) error {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return fmt.Errorf("invalid AI base URL: %w", err)
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("AI base URL scheme must be http or https, got %q", parsed.Scheme)
	}
	host := parsed.Hostname()
	if host == "" {
		return fmt.Errorf("AI base URL is missing a host")
	}

	if !strict {
		return nil
	}

	ips, err := net.LookupIP(host)
	if err != nil {
		return fmt.Errorf("failed to resolve AI base URL host %q: %w", host, err)
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return fmt.Errorf("AI base URL host %q resolves to a private or loopback address, which is not allowed in collaboration mode", host)
		}
	}
	return nil
}

// checkAIBaseURL applies SSRF validation with strictness derived from the
// server mode: token-based collaboration servers get the full private/loopback
// blacklist; local single-user servers only enforce the scheme whitelist.
func (s *Server) checkAIBaseURL(baseURL string) error {
	return validateAIBaseURL(baseURL, s.tokenStore != nil)
}
