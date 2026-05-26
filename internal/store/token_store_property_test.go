package store

import (
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"pgregory.net/rapid"
)

// Property 20: Token Security Enforcement
// For any invalid/revoked/expired token, Validate SHALL return an error.
// **Validates: Requirements 9.5, 9.6, 9.7**
func TestProperty20_TokenSecurityEnforcement(t *testing.T) {
	var counter atomic.Int64

	rapid.Check(t, func(rt *rapid.T) {
		idx := counter.Add(1)
		dir := t.TempDir()
		path := filepath.Join(dir, fmt.Sprintf("tokens-%d.json", idx))

		ts, err := NewTokenStore(path)
		if err != nil {
			rt.Fatalf("NewTokenStore failed: %v", err)
		}

		// Choose a scenario: invalid, revoked, or expired
		scenario := rapid.SampledFrom([]string{"invalid", "revoked", "expired"}).Draw(rt, "scenario")

		switch scenario {
		case "invalid":
			// Generate a random string that is not a valid token secret
			invalidSecret := rapid.StringMatching(`[a-f0-9]{1,128}`).Draw(rt, "invalidSecret")
			_, err := ts.Validate(invalidSecret)
			if err == nil {
				rt.Fatalf("expected error for invalid secret %q, got nil", invalidSecret)
			}

		case "revoked":
			// Create a valid token, revoke it, then validate
			exp := time.Hour
			token, err := ts.Create("map1", "editor", "User", &exp)
			if err != nil {
				rt.Fatalf("Create failed: %v", err)
			}

			if err := ts.Revoke(token.ID); err != nil {
				rt.Fatalf("Revoke failed: %v", err)
			}

			_, err = ts.Validate(token.Secret)
			if err == nil {
				rt.Fatal("expected error for revoked token, got nil")
			}

		case "expired":
			// Create a token file with an already-expired token
			past := time.Now().UTC().Add(-time.Hour)
			secret := fmt.Sprintf("expired-secret-%d", idx)
			content := fmt.Sprintf(`[{"id":"tok-exp-%d","mapId":"map1","accessLevel":"editor","secret":"%s","displayName":"Test","expiresAt":"%s","createdAt":"2024-01-01T00:00:00Z","revoked":false}]`,
				idx, secret, past.Format(time.RFC3339Nano))

			expPath := filepath.Join(dir, fmt.Sprintf("tokens-exp-%d.json", idx))
			if err := os.WriteFile(expPath, []byte(content), 0o644); err != nil {
				rt.Fatalf("failed to write expired token file: %v", err)
			}

			expStore, err := NewTokenStore(expPath)
			if err != nil {
				rt.Fatalf("NewTokenStore failed: %v", err)
			}

			_, err = expStore.Validate(secret)
			if err == nil {
				rt.Fatal("expected error for expired token, got nil")
			}
		}
	})
}

// Property 22: Token Limit Per Map
// For any map with 50 active tokens, creating a 51st SHALL fail.
// **Validates: Requirements 9.5, 9.6, 9.7**
func TestProperty22_TokenLimitPerMap(t *testing.T) {
	var counter atomic.Int64

	rapid.Check(t, func(rt *rapid.T) {
		idx := counter.Add(1)
		dir := t.TempDir()
		path := filepath.Join(dir, fmt.Sprintf("tokens-%d.json", idx))

		ts, err := NewTokenStore(path)
		if err != nil {
			rt.Fatalf("NewTokenStore failed: %v", err)
		}

		// Generate a random map ID
		mapID := rapid.StringMatching(`map-[a-z0-9]{1,10}`).Draw(rt, "mapID")

		// Generate a random valid expiration (between 1 min and 365 days)
		expMinutes := rapid.IntRange(1, 525600).Draw(rt, "expMinutes")
		exp := time.Duration(expMinutes) * time.Minute

		// Generate a random access level
		accessLevel := rapid.SampledFrom([]string{"owner", "editor", "viewer"}).Draw(rt, "accessLevel")

		// Create 50 tokens for the map
		for i := 0; i < 50; i++ {
			_, err := ts.Create(mapID, accessLevel, fmt.Sprintf("User%d", i), &exp)
			if err != nil {
				rt.Fatalf("Create #%d failed: %v", i+1, err)
			}
		}

		// Verify that the 51st token creation fails
		_, err = ts.Create(mapID, accessLevel, "User51", &exp)
		if err == nil {
			rt.Fatal("expected error when creating 51st token, got nil")
		}

		// Verify that creating a token for a DIFFERENT map still succeeds
		otherMapID := mapID + "-other"
		_, err = ts.Create(otherMapID, accessLevel, "OtherUser", &exp)
		if err != nil {
			rt.Fatalf("expected success for different map, got error: %v", err)
		}
	})
}

// Property 23: Token Expiration Validation
// Accept durations between 1min and 365days, reject outside range.
// **Validates: Requirements 9.5, 9.6, 9.7**
func TestProperty23_TokenExpirationValidation(t *testing.T) {
	var counter atomic.Int64

	rapid.Check(t, func(rt *rapid.T) {
		idx := counter.Add(1)
		dir := t.TempDir()
		path := filepath.Join(dir, fmt.Sprintf("tokens-%d.json", idx))

		ts, err := NewTokenStore(path)
		if err != nil {
			rt.Fatalf("NewTokenStore failed: %v", err)
		}

		// Choose scenario: valid range, too short, or too long
		scenario := rapid.SampledFrom([]string{"valid", "too_short", "too_long"}).Draw(rt, "scenario")

		switch scenario {
		case "valid":
			// Generate a duration between 1 minute and 365 days (inclusive)
			validSeconds := rapid.Int64Range(60, 365*24*3600).Draw(rt, "validSeconds")
			exp := time.Duration(validSeconds) * time.Second

			token, err := ts.Create("map1", "editor", "User", &exp)
			if err != nil {
				rt.Fatalf("expected success for valid expiration %v, got error: %v", exp, err)
			}
			if token == nil {
				rt.Fatal("expected non-nil token for valid expiration")
			}

		case "too_short":
			// Generate a duration less than 1 minute (1 to 59 seconds)
			shortSeconds := rapid.Int64Range(1, 59).Draw(rt, "shortSeconds")
			exp := time.Duration(shortSeconds) * time.Second

			_, err := ts.Create("map1", "editor", "User", &exp)
			if err == nil {
				rt.Fatalf("expected error for too-short expiration %v, got nil", exp)
			}

		case "too_long":
			// Generate a duration greater than 365 days
			// 365 days = 31,536,000 seconds; generate something larger
			longSeconds := rapid.Int64Range(365*24*3600+1, 730*24*3600).Draw(rt, "longSeconds")
			exp := time.Duration(longSeconds) * time.Second

			_, err := ts.Create("map1", "editor", "User", &exp)
			if err == nil {
				rt.Fatalf("expected error for too-long expiration %v, got nil", exp)
			}
		}
	})
}
