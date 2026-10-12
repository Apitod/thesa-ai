package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"risethub_os/backend/internal/db"
)

// User represents an authenticated Thesa AI user.
type User struct {
	ID          int       `db:"id" json:"id"`
	Email       string    `db:"email" json:"email"`
	FullName    string    `db:"full_name" json:"name"`
	Institution string    `db:"institution" json:"institution"`
	Prodi       string    `db:"prodi" json:"prodi"`
	Level       string    `db:"level" json:"level"`
	Tier        string    `db:"tier" json:"tier"`
	TrustScore  int       `db:"trust_score" json:"trustScore"`
	CreatedAt   time.Time `db:"created_at" json:"registeredAt"`
}

// In-memory fallback user and session store when DB is disconnected
type memStore struct {
	mu       sync.RWMutex
	users    map[string]*UserWithPass
	sessions map[string]*SessionData
}

type UserWithPass struct {
	User
	PasswordHash string
}

type SessionData struct {
	UserID    int
	User      User
	ExpiresAt time.Time
}

var memoryStore = &memStore{
	users:    make(map[string]*UserWithPass),
	sessions: make(map[string]*SessionData),
}

func init() {
	// Seed demo user in memory fallback
	demoPassHash := hashPassword("thesa2026")
	memoryStore.users["alif.awwaz@ui.ac.id"] = &UserWithPass{
		User: User{
			ID:          1,
			Email:       "alif.awwaz@ui.ac.id",
			FullName:    "Alif Awwaz",
			Institution: "Universitas Indonesia",
			Prodi:       "Ilmu Komputer",
			Level:       "S2",
			Tier:        "gold",
			TrustScore:  95,
			CreatedAt:   time.Now(),
		},
		PasswordHash: demoPassHash,
	}
}

// AuthHandler handles user registration, authentication, and session validation.
type AuthHandler struct{}

func NewAuthHandler() *AuthHandler {
	return &AuthHandler{}
}

type RegisterRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	FullName    string `json:"name"`
	Institution string `json:"institution"`
	Prodi       string `json:"prodi"`
	Level       string `json:"level"`
	Tier        string `json:"tier"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type AuthResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Token   string `json:"token,omitempty"`
	User    *User  `json:"user,omitempty"`
}

// Register creates a new user account and returns a valid session token.
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, AuthResponse{Success: false, Message: "Format request tidak valid."})
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.FullName = strings.TrimSpace(req.FullName)
	if req.Email == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, AuthResponse{Success: false, Message: "Email dan kata sandi wajib diisi."})
		return
	}

	if len(req.Password) < 6 {
		writeJSON(w, http.StatusBadRequest, AuthResponse{Success: false, Message: "Kata sandi minimal 6 karakter."})
		return
	}

	if req.FullName == "" {
		req.FullName = "Mahasiswa Peneliti"
	}
	if req.Level == "" {
		req.Level = "S1"
	}
	if req.Tier == "" {
		req.Tier = "gold"
	}

	trustScore := 85
	if strings.HasSuffix(req.Email, ".ac.id") || strings.Contains(req.Email, ".edu") {
		trustScore = 95
	}

	passHash := hashPassword(req.Password)
	token := generateSecureToken()
	expiresAt := time.Now().Add(30 * 24 * time.Hour)

	var user User
	if db.DB != nil && db.IsConnected() {
		// Check if email already registered
		var count int
		_ = db.DB.Get(&count, `SELECT COUNT(*) FROM users WHERE email = ?`, req.Email)
		if count > 0 {
			writeJSON(w, http.StatusConflict, AuthResponse{Success: false, Message: "Email ini sudah terdaftar. Silakan masuk menggunakan kata sandi Anda."})
			return
		}

		// Insert into MySQL
		res, err := db.DB.Exec(`
			INSERT INTO users (email, password_hash, full_name, institution, prodi, level, tier, trust_score, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
		`, req.Email, passHash, req.FullName, req.Institution, req.Prodi, req.Level, req.Tier, trustScore)

		if err != nil {
			log.Printf("[Thesa Auth] DB Register error: %v", err)
			writeJSON(w, http.StatusInternalServerError, AuthResponse{Success: false, Message: "Gagal menyimpan akun ke basis data."})
			return
		}

		lastID, _ := res.LastInsertId()
		user = User{
			ID:          int(lastID),
			Email:       req.Email,
			FullName:    req.FullName,
			Institution: req.Institution,
			Prodi:       req.Prodi,
			Level:       req.Level,
			Tier:        req.Tier,
			TrustScore:  trustScore,
			CreatedAt:   time.Now(),
		}

		// Insert session token
		_, _ = db.DB.Exec(`
			INSERT INTO user_sessions (user_id, token, expires_at, created_at)
			VALUES (?, ?, ?, NOW())
		`, user.ID, token, expiresAt)
	} else {
		// Fallback in-memory
		memoryStore.mu.Lock()
		if _, exists := memoryStore.users[req.Email]; exists {
			memoryStore.mu.Unlock()
			writeJSON(w, http.StatusConflict, AuthResponse{Success: false, Message: "Email ini sudah terdaftar. Silakan masuk menggunakan kata sandi Anda."})
			return
		}

		newID := len(memoryStore.users) + 1
		user = User{
			ID:          newID,
			Email:       req.Email,
			FullName:    req.FullName,
			Institution: req.Institution,
			Prodi:       req.Prodi,
			Level:       req.Level,
			Tier:        req.Tier,
			TrustScore:  trustScore,
			CreatedAt:   time.Now(),
		}
		memoryStore.users[req.Email] = &UserWithPass{
			User:         user,
			PasswordHash: passHash,
		}
		memoryStore.sessions[token] = &SessionData{
			UserID:    newID,
			User:      user,
			ExpiresAt: expiresAt,
		}
		memoryStore.mu.Unlock()
	}

	log.Printf("[Thesa Auth] User registered successfully: %s (%s)", user.Email, user.FullName)
	writeJSON(w, http.StatusCreated, AuthResponse{
		Success: true,
		Message: "Registrasi berhasil.",
		Token:   token,
		User:    &user,
	})
}

// Login authenticates a user and returns a new session token.
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, AuthResponse{Success: false, Message: "Format request tidak valid."})
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, AuthResponse{Success: false, Message: "Email dan kata sandi wajib diisi."})
		return
	}

	token := generateSecureToken()
	expiresAt := time.Now().Add(30 * 24 * time.Hour)
	var user User

	if db.DB != nil && db.IsConnected() {
		var u struct {
			ID           int    `db:"id"`
			Email        string `db:"email"`
			PasswordHash string `db:"password_hash"`
			FullName     string `db:"full_name"`
			Institution  string `db:"institution"`
			Prodi        string `db:"prodi"`
			Level        string `db:"level"`
			Tier         string `db:"tier"`
			TrustScore   int    `db:"trust_score"`
		}

		err := db.DB.Get(&u, `SELECT id, email, password_hash, full_name, institution, prodi, level, tier, trust_score FROM users WHERE email = ? LIMIT 1`, req.Email)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, AuthResponse{Success: false, Message: "Email atau kata sandi tidak sesuai."})
			return
		}

		if !verifyPassword(req.Password, u.PasswordHash) {
			writeJSON(w, http.StatusUnauthorized, AuthResponse{Success: false, Message: "Email atau kata sandi tidak sesuai."})
			return
		}

		user = User{
			ID:          u.ID,
			Email:       u.Email,
			FullName:    u.FullName,
			Institution: u.Institution,
			Prodi:       u.Prodi,
			Level:       u.Level,
			Tier:        u.Tier,
			TrustScore:  u.TrustScore,
			CreatedAt:   time.Now(),
		}

		_, _ = db.DB.Exec(`INSERT INTO user_sessions (user_id, token, expires_at, created_at) VALUES (?, ?, ?, NOW())`, user.ID, token, expiresAt)
	} else {
		// Fallback in-memory
		memoryStore.mu.RLock()
		u, exists := memoryStore.users[req.Email]
		memoryStore.mu.RUnlock()

		if !exists || !verifyPassword(req.Password, u.PasswordHash) {
			writeJSON(w, http.StatusUnauthorized, AuthResponse{Success: false, Message: "Email atau kata sandi tidak sesuai."})
			return
		}
		user = u.User

		memoryStore.mu.Lock()
		memoryStore.sessions[token] = &SessionData{
			UserID:    user.ID,
			User:      user,
			ExpiresAt: expiresAt,
		}
		memoryStore.mu.Unlock()
	}

	log.Printf("[Thesa Auth] User logged in: %s", user.Email)
	writeJSON(w, http.StatusOK, AuthResponse{
		Success: true,
		Message: "Login berhasil.",
		Token:   token,
		User:    &user,
	})
}

// Me returns the currently authenticated user's profile.
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	token := extractBearerToken(r)
	if token == "" {
		writeJSON(w, http.StatusUnauthorized, AuthResponse{Success: false, Message: "Token otentikasi tidak ditemukan."})
		return
	}

	user, ok := ValidateUserSession(token)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, AuthResponse{Success: false, Message: "Sesi tidak valid atau telah kedaluwarsa."})
		return
	}

	writeJSON(w, http.StatusOK, AuthResponse{
		Success: true,
		User:    user,
	})
}

// ValidateUserSession checks if a given token is active and valid.
func ValidateUserSession(token string) (*User, bool) {
	if token == "" {
		return nil, false
	}

	if db.DB != nil && db.IsConnected() {
		var u User
		query := `
			SELECT u.id, u.email, u.full_name, u.institution, u.prodi, u.level, u.tier, u.trust_score, u.created_at
			FROM user_sessions s
			JOIN users u ON s.user_id = u.id
			WHERE s.token = ? AND s.expires_at > NOW()
			LIMIT 1
		`
		err := db.DB.Get(&u, query, token)
		if err == nil {
			return &u, true
		}
	}

	// In-memory lookup
	memoryStore.mu.RLock()
	defer memoryStore.mu.RUnlock()
	session, exists := memoryStore.sessions[token]
	if exists && time.Now().Before(session.ExpiresAt) {
		return &session.User, true
	}

	return nil, false
}

func extractBearerToken(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return r.URL.Query().Get("token")
	}
	parts := strings.Split(authHeader, " ")
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		return strings.TrimSpace(parts[1])
	}
	return strings.TrimSpace(authHeader)
}

func hashPassword(pass string) string {
	salt := "thesa_academic_salt_2026"
	hash := sha256.Sum256([]byte(pass + salt))
	return hex.EncodeToString(hash[:])
}

func verifyPassword(pass, hash string) bool {
	return hashPassword(pass) == hash
}

func generateSecureToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return "thsa_" + hex.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
