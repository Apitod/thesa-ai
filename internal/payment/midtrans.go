package payment

import (
	"bytes"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// MidtransClient handles interactions with Midtrans Payment Gateway (Snap & Core API).
type MidtransClient struct {
	serverKey    string
	clientKey    string
	isProduction bool
	httpClient   *http.Client
}

// SnapTransactionRequest represents payload for creating a Snap transaction.
type SnapTransactionRequest struct {
	TransactionDetails TransactionDetails `json:"transaction_details"`
	CustomerDetails    CustomerDetails    `json:"customer_details,omitempty"`
	ItemDetails        []ItemDetail       `json:"item_details,omitempty"`
	EnabledPayments    []string           `json:"enabled_payments,omitempty"`
}

type TransactionDetails struct {
	OrderID     string  `json:"order_id"`
	GrossAmount float64 `json:"gross_amount"`
}

type CustomerDetails struct {
	Email     string `json:"email"`
	FirstName string `json:"first_name"`
	Phone     string `json:"phone,omitempty"`
}

type ItemDetail struct {
	ID       string  `json:"id"`
	Price    float64 `json:"price"`
	Quantity int     `json:"quantity"`
	Name     string  `json:"name"`
}

// SnapTransactionResponse represents response from Midtrans Snap API.
type SnapTransactionResponse struct {
	Token         string   `json:"token"`
	RedirectURL   string   `json:"redirect_url"`
	ErrorMessages []string `json:"error_messages,omitempty"`
}

// WebhookNotification represents Midtrans webhook HTTP POST payload.
type WebhookNotification struct {
	TransactionTime   string `json:"transaction_time"`
	TransactionStatus string `json:"transaction_status"` // "capture", "settlement", "pending", "deny", "expire", "cancel"
	TransactionID     string `json:"transaction_id"`
	StatusMessage     string `json:"status_message"`
	StatusCode        string `json:"status_code"`
	SignatureKey      string `json:"signature_key"`
	PaymentType       string `json:"payment_type"`
	OrderID           string `json:"order_id"`
	GrossAmount       string `json:"gross_amount"`
	FraudStatus       string `json:"fraud_status"` // "accept", "challenge", "deny"
	Currency          string `json:"currency"`
}

// NewMidtransClient creates a new configured Midtrans client.
func NewMidtransClient() *MidtransClient {
	serverKey := os.Getenv("MIDTRANS_SERVER_KEY")
	clientKey := os.Getenv("MIDTRANS_CLIENT_KEY")
	isProd := strings.ToLower(os.Getenv("MIDTRANS_IS_PRODUCTION")) == "true"

	return &MidtransClient{
		serverKey:    serverKey,
		clientKey:    clientKey,
		isProduction: isProd,
		httpClient:   &http.Client{Timeout: 30 * time.Second},
	}
}

// snapBaseURL returns the endpoint for Midtrans Snap API.
func (c *MidtransClient) snapBaseURL() string {
	if c.isProduction {
		return "https://app.midtrans.com/snap/v1"
	}
	return "https://app.sandbox.midtrans.com/snap/v1"
}

// apiBaseURL returns the endpoint for Midtrans Core / Status API.
func (c *MidtransClient) apiBaseURL() string {
	if c.isProduction {
		return "https://api.midtrans.com/v2"
	}
	return "https://api.sandbox.midtrans.com/v2"
}

// CreateSnapTransaction creates a new transaction token via Midtrans Snap.
func (c *MidtransClient) CreateSnapTransaction(req SnapTransactionRequest) (*SnapTransactionResponse, error) {
	if c.serverKey == "" || strings.Contains(c.serverKey, "YOUR_SERVER_KEY") {
		return nil, fmt.Errorf("MIDTRANS_SERVER_KEY is not configured")
	}

	url := c.snapBaseURL() + "/transactions"
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal snap request: %w", err)
	}

	httpReq, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create snap http request: %w", err)
	}

	authHeader := "Basic " + base64.StdEncoding.EncodeToString([]byte(c.serverKey+":"))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Authorization", authHeader)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("snap http call failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read snap response: %w", err)
	}

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("snap API returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var snapResp SnapTransactionResponse
	if err := json.Unmarshal(respBody, &snapResp); err != nil {
		return nil, fmt.Errorf("unmarshal snap response: %w", err)
	}

	return &snapResp, nil
}

// VerifySignature validates that incoming webhook notification was signed by Midtrans.
// Signature formula: SHA512(order_id + status_code + gross_amount + ServerKey)
func (c *MidtransClient) VerifySignature(orderID, statusCode, grossAmount, signatureKey string) bool {
	if c.serverKey == "" || strings.Contains(c.serverKey, "YOUR_SERVER_KEY") {
		return false
	}

	raw := orderID + statusCode + grossAmount + c.serverKey
	hasher := sha512.New()
	hasher.Write([]byte(raw))
	expected := hex.EncodeToString(hasher.Sum(nil))

	return strings.EqualFold(expected, signatureKey)
}

// CheckTransactionStatus calls Midtrans Core API to check live transaction status.
func (c *MidtransClient) CheckTransactionStatus(orderID string) (*WebhookNotification, error) {
	if c.serverKey == "" || strings.Contains(c.serverKey, "YOUR_SERVER_KEY") {
		return nil, fmt.Errorf("MIDTRANS_SERVER_KEY is not configured")
	}

	url := fmt.Sprintf("%s/%s/status", c.apiBaseURL(), orderID)
	httpReq, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	authHeader := "Basic " + base64.StdEncoding.EncodeToString([]byte(c.serverKey+":"))
	httpReq.Header.Set("Authorization", authHeader)
	httpReq.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var statusResp WebhookNotification
	if err := json.Unmarshal(respBody, &statusResp); err != nil {
		return nil, err
	}

	return &statusResp, nil
}
