package server

import "testing"

func TestValidateAIBaseURLSchemeWhitelist(t *testing.T) {
	for _, bad := range []string{"file:///etc/passwd/v1", "gopher://example.com/v1", "ftp://example.com/v1", "/v1"} {
		if err := validateAIBaseURL(bad, false); err == nil {
			t.Errorf("expected rejection for %q", bad)
		}
	}
	if err := validateAIBaseURL("https://api.openai.com/v1", false); err != nil {
		t.Errorf("https URL should pass in local mode: %v", err)
	}
}

func TestValidateAIBaseURLStrictBlocksPrivateHosts(t *testing.T) {
	for _, bad := range []string{
		"http://127.0.0.1:11434/v1",
		"http://localhost:11434/v1",
		"http://0.0.0.0/v1",
		"http://169.254.169.254/v1",
		"http://192.168.1.10/v1",
		"http://10.0.0.5/v1",
	} {
		if err := validateAIBaseURL(bad, true); err == nil {
			t.Errorf("strict mode must reject %q", bad)
		}
	}
	// Local mode keeps localhost model runtimes (Ollama, LM Studio) usable.
	if err := validateAIBaseURL("http://127.0.0.1:11434/v1", false); err != nil {
		t.Errorf("local mode should allow loopback: %v", err)
	}
}
