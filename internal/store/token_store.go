package store

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"code-mind/internal/agentcontract"
)

// Token represents an access token for map collaboration.
type Token struct {
	ID          string                  `json:"id"`
	MapID       string                  `json:"mapId"`
	AccessLevel string                  `json:"accessLevel"`          // "owner" | "editor" | "viewer"
	Secret      string                  `json:"secret,omitempty"`     // plaintext, only populated on create; never persisted
	SecretHash  string                  `json:"secretHash,omitempty"` // SHA-256 hex of the secret, persisted
	DisplayName string                  `json:"displayName"`          // for presence (max 30 chars)
	ActorKind   agentcontract.ActorKind `json:"actorKind"`
	ExpiresAt   *time.Time              `json:"expiresAt,omitempty"`
	CreatedAt   time.Time               `json:"createdAt"`
	Revoked     bool                    `json:"revoked"`
}

// TokenStore manages access tokens persisted to a JSON file.
type TokenStore struct {
	path   string
	tokens []Token
	mu     sync.RWMutex
}

const (
	maxActiveTokensPerMap = 50
	minExpiration         = time.Minute
	maxExpiration         = 365 * 24 * time.Hour
	tokenSecretBytes      = 32
)

// NewTokenStore creates a TokenStore that loads/saves tokens from the given path.
// If the file does not exist, it starts with an empty token list.
func NewTokenStore(path string) (*TokenStore, error) {
	ts := &TokenStore{
		path:   path,
		tokens: make([]Token, 0),
	}

	if err := ts.load(); err != nil {
		return nil, err
	}

	return ts, nil
}

// Create generates a new token for the given map with the specified access level.
// It enforces a 50-token limit per map and validates expiration duration.
func (ts *TokenStore) Create(mapId, accessLevel, displayName string, expiration *time.Duration) (*Token, error) {
	return ts.CreateWithActorKind(mapId, accessLevel, displayName, agentcontract.ActorHuman, expiration)
}

// CreateWithActorKind creates a token whose server-derived actor identity is
// used for command attribution. Existing callers continue to create humans.
func (ts *TokenStore) CreateWithActorKind(
	mapId, accessLevel, displayName string,
	actorKind agentcontract.ActorKind,
	expiration *time.Duration,
) (*Token, error) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	// Validate access level
	if accessLevel != "owner" && accessLevel != "editor" && accessLevel != "viewer" {
		return nil, errors.New("invalid access level: must be owner, editor, or viewer")
	}
	if !actorKind.Valid() {
		return nil, errors.New("invalid actor kind: must be human or agent")
	}

	// Validate expiration if provided
	if expiration != nil {
		if *expiration < minExpiration {
			return nil, fmt.Errorf("expiration must be between 1 minute and 365 days")
		}
		if *expiration > maxExpiration {
			return nil, fmt.Errorf("expiration must be between 1 minute and 365 days")
		}
	}

	// Enforce 50-token limit per map
	activeCount := ts.countActiveByMapLocked(mapId)
	if activeCount >= maxActiveTokensPerMap {
		return nil, fmt.Errorf("maximum 50 active tokens per map")
	}

	// Generate 32-byte random secret
	secret, err := generateSecret()
	if err != nil {
		return nil, fmt.Errorf("failed to generate token secret: %w", err)
	}

	// Truncate display name to 30 characters
	if len(displayName) > 30 {
		displayName = displayName[:30]
	}

	now := time.Now().UTC()
	token := Token{
		ID:          fmt.Sprintf("tok-%d", now.UnixMilli()),
		MapID:       mapId,
		AccessLevel: accessLevel,
		SecretHash:  hashSecret(secret),
		DisplayName: displayName,
		ActorKind:   actorKind,
		CreatedAt:   now,
		Revoked:     false,
	}

	if expiration != nil {
		expiresAt := now.Add(*expiration)
		token.ExpiresAt = &expiresAt
	}

	ts.tokens = append(ts.tokens, token)

	if err := ts.persist(); err != nil {
		// Roll back the append on persist failure
		ts.tokens = ts.tokens[:len(ts.tokens)-1]
		return nil, fmt.Errorf("failed to persist token: %w", err)
	}

	// Return a copy carrying the plaintext secret; it is never stored.
	result := token
	result.Secret = secret
	return &result, nil
}

// Validate checks a secret and returns the associated token if valid.
// Returns an error if the token is not found, revoked, or expired.
func (ts *TokenStore) Validate(secret string) (*Token, error) {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	hashed := hashSecret(secret)
	for i := range ts.tokens {
		if subtle.ConstantTimeCompare([]byte(ts.tokens[i].SecretHash), []byte(hashed)) == 1 {
			if ts.tokens[i].Revoked {
				return nil, errors.New("token has been revoked")
			}
			if ts.tokens[i].ExpiresAt != nil && time.Now().UTC().After(*ts.tokens[i].ExpiresAt) {
				return nil, errors.New("token expired")
			}
			result := ts.tokens[i]
			if !result.ActorKind.Valid() {
				result.ActorKind = agentcontract.ActorHuman
			}
			return &result, nil
		}
	}

	return nil, errors.New("invalid token")
}

// Revoke marks a token as revoked by its ID.
func (ts *TokenStore) Revoke(tokenId string) error {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	for i := range ts.tokens {
		if ts.tokens[i].ID == tokenId {
			ts.tokens[i].Revoked = true
			return ts.persist()
		}
	}

	return fmt.Errorf("token not found: %s", tokenId)
}

// ListByMap returns all tokens (including revoked/expired) for a given map.
func (ts *TokenStore) ListByMap(mapId string) []Token {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	result := make([]Token, 0)
	for _, t := range ts.tokens {
		if t.MapID == mapId {
			result = append(result, t)
		}
	}
	return result
}

// CountActiveByMap returns the number of active (non-revoked, non-expired) tokens for a map.
func (ts *TokenStore) CountActiveByMap(mapId string) int {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	return ts.countActiveByMapLocked(mapId)
}

// countActiveByMapLocked counts active tokens without acquiring the lock (caller must hold lock).
func (ts *TokenStore) countActiveByMapLocked(mapId string) int {
	now := time.Now().UTC()
	count := 0
	for _, t := range ts.tokens {
		if t.MapID == mapId && !t.Revoked {
			if t.ExpiresAt == nil || now.Before(*t.ExpiresAt) {
				count++
			}
		}
	}
	return count
}

// load reads tokens from the JSON file. If the file doesn't exist, starts empty.
func (ts *TokenStore) load() error {
	payload, err := os.ReadFile(ts.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			ts.tokens = make([]Token, 0)
			return nil
		}
		return fmt.Errorf("failed to read token store: %w", err)
	}

	if err := json.Unmarshal(payload, &ts.tokens); err != nil {
		return fmt.Errorf("failed to parse token store: %w", err)
	}

	// Migrate legacy plaintext secrets to hashed form.
	migrated := false
	for i := range ts.tokens {
		if ts.tokens[i].Secret != "" {
			if ts.tokens[i].SecretHash == "" {
				ts.tokens[i].SecretHash = hashSecret(ts.tokens[i].Secret)
			}
			ts.tokens[i].Secret = ""
			migrated = true
		}
		if !ts.tokens[i].ActorKind.Valid() {
			ts.tokens[i].ActorKind = agentcontract.ActorHuman
			migrated = true
		}
	}
	if migrated {
		if err := ts.persist(); err != nil {
			return fmt.Errorf("failed to migrate token store to hashed secrets: %w", err)
		}
	}

	return nil
}

// persist writes the current token list to the JSON file.
func (ts *TokenStore) persist() error {
	dir := filepath.Dir(ts.path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("failed to create token store directory: %w", err)
	}

	payload, err := json.MarshalIndent(ts.tokens, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal tokens: %w", err)
	}

	return os.WriteFile(ts.path, payload, 0o644)
}

// generateSecret produces a cryptographically random 32-byte hex string.
func generateSecret() (string, error) {
	bytes := make([]byte, tokenSecretBytes)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// hashSecret returns the SHA-256 hex digest of a token secret.
func hashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}
