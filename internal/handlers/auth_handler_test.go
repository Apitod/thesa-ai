package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthHandler_Register(t *testing.T) {
	h := NewAuthHandler()

	// Test case 1: Successful academic email registration (.ac.id)
	reqBody, _ := json.Marshal(RegisterRequest{
		Email:       "test.student@ui.ac.id",
		Password:    "secretpass123",
		FullName:    "Budi Mahasiswa",
		Institution: "Universitas Indonesia",
		Prodi:       "Ilmu Komputer",
		Level:       "S1",
		Tier:        "gold",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewBuffer(reqBody))
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d. Body: %s", http.StatusCreated, rec.Code, rec.Body.String())
	}

	var resp AuthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode json response: %v", err)
	}

	if !resp.Success {
		t.Errorf("expected success to be true")
	}
	if resp.Token == "" {
		t.Errorf("expected non-empty auth token")
	}
	if resp.User == nil {
		t.Fatalf("expected user object in response")
	}
	if resp.User.TrustScore != 95 {
		t.Errorf("expected trust score 95 for academic email, got %d", resp.User.TrustScore)
	}

	// Test case 2: Empty email & password
	emptyReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewBufferString(`{}`))
	emptyRec := httptest.NewRecorder()
	h.Register(emptyRec, emptyReq)

	if emptyRec.Code != http.StatusBadRequest {
		t.Errorf("expected status %d for empty register, got %d", http.StatusBadRequest, emptyRec.Code)
	}
}

func TestAuthHandler_Login(t *testing.T) {
	h := NewAuthHandler()

	// Pre-seed demo login test
	loginBody, _ := json.Marshal(LoginRequest{
		Email:    "alif.awwaz@ui.ac.id",
		Password: "thesa2026",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBuffer(loginBody))
	rec := httptest.NewRecorder()

	h.Login(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d for valid login, got %d. Body: %s", http.StatusOK, rec.Code, rec.Body.String())
	}

	var resp AuthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode json response: %v", err)
	}

	if !resp.Success || resp.Token == "" {
		t.Errorf("login response failed or returned empty token: %+v", resp)
	}

	// Test case: Invalid credentials
	wrongBody, _ := json.Marshal(LoginRequest{
		Email:    "alif.awwaz@ui.ac.id",
		Password: "wrongpassword999",
	})
	wrongReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBuffer(wrongBody))
	wrongRec := httptest.NewRecorder()
	h.Login(wrongRec, wrongReq)

	if wrongRec.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d for invalid password, got %d", http.StatusUnauthorized, wrongRec.Code)
	}
}

func TestAuthHandler_Me(t *testing.T) {
	h := NewAuthHandler()

	// 1. Perform login to acquire token
	loginBody, _ := json.Marshal(LoginRequest{
		Email:    "alif.awwaz@ui.ac.id",
		Password: "thesa2026",
	})
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBuffer(loginBody))
	loginRec := httptest.NewRecorder()
	h.Login(loginRec, loginReq)

	var loginResp AuthResponse
	_ = json.Unmarshal(loginRec.Body.Bytes(), &loginResp)
	token := loginResp.Token

	// 2. Query /api/v1/auth/me with Bearer token
	meReq := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+token)
	meRec := httptest.NewRecorder()

	h.Me(meRec, meReq)

	if meRec.Code != http.StatusOK {
		t.Fatalf("expected status %d for /me, got %d", http.StatusOK, meRec.Code)
	}

	var meResp AuthResponse
	_ = json.Unmarshal(meRec.Body.Bytes(), &meResp)
	if meResp.User == nil || meResp.User.Email != "alif.awwaz@ui.ac.id" {
		t.Errorf("expected user email alif.awwaz@ui.ac.id, got %+v", meResp.User)
	}
}
