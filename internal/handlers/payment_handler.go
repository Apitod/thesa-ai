package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"risethub_os/backend/internal/db"
	"risethub_os/backend/internal/payment"
)

// PaymentHandler manages order creation, webhooks, and transaction verification.
type PaymentHandler struct {
	midtrans *payment.MidtransClient
}

// NewPaymentHandler creates a new PaymentHandler instance.
func NewPaymentHandler() *PaymentHandler {
	return &PaymentHandler{
		midtrans: payment.NewMidtransClient(),
	}
}

type CreateOrderRequest struct {
	PackageID   string  `json:"package_id"`   // "single" | "semester"
	Amount      float64 `json:"amount"`       // 12000 or 39000
	UserEmail   string  `json:"user_email"`
	UserName    string  `json:"user_name"`
	PaymentType string  `json:"payment_type"` // "qris" | "snap"
}

type CreateOrderResponse struct {
	Success         bool    `json:"success"`
	Message         string  `json:"message,omitempty"`
	OrderID         string  `json:"order_id"`
	PackageID       string  `json:"package_id"`
	PackageName     string  `json:"package_name"`
	Amount          float64 `json:"amount"`
	Status          string  `json:"status"`
	SnapToken       string  `json:"snap_token,omitempty"`
	SnapRedirectURL string  `json:"snap_redirect_url,omitempty"`
	QRISCode        string  `json:"qris_code,omitempty"`
}

// CreateOrder handles order initiation and Snap token / QRIS generation.
func (h *PaymentHandler) CreateOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CreateOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "Invalid request body"})
		return
	}

	req.UserEmail = strings.TrimSpace(req.UserEmail)
	if req.UserEmail == "" {
		req.UserEmail = "mahasiswa@thesa.id"
	}
	if req.UserName == "" {
		req.UserName = "Mahasiswa Thesa"
	}

	packageName := "1x Makalah Penuh (3 Bab + Ekspor)"
	creditsToAdd := 1
	if req.PackageID == "semester" {
		req.Amount = 39000
		packageName = "Paket 4x Makalah (1 Semester)"
		creditsToAdd = 4
	} else {
		req.PackageID = "single"
		req.Amount = 12000
	}

	// Generate unique Order ID: THESA-{timestamp}-{random_hex}
	randBytes := make([]byte, 3)
	rand.Read(randBytes)
	orderID := fmt.Sprintf("THESA-%d-%s", time.Now().Unix(), hex.EncodeToString(randBytes))

	// Request Snap Transaction from Midtrans
	snapReq := payment.SnapTransactionRequest{
		TransactionDetails: payment.TransactionDetails{
			OrderID:     orderID,
			GrossAmount: req.Amount,
		},
		CustomerDetails: payment.CustomerDetails{
			Email:     req.UserEmail,
			FirstName: req.UserName,
		},
		ItemDetails: []payment.ItemDetail{
			{
				ID:       req.PackageID,
				Price:    req.Amount,
				Quantity: 1,
				Name:     packageName,
			},
		},
	}

	snapResp, err := h.midtrans.CreateSnapTransaction(snapReq)
	if err != nil {
		log.Printf("[Thesa Payment] Snap transaction error: %v", err)
	}

	snapToken := ""
	snapRedirectURL := ""
	if snapResp != nil {
		snapToken = snapResp.Token
		snapRedirectURL = snapResp.RedirectURL
	}

	// Save order to database if connected
	if db.DB != nil {
		query := `INSERT INTO orders (order_id, user_id, user_email, package_id, package_name, amount, status, payment_type, snap_token, snap_redirect_url)
		          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
		_, err := db.DB.Exec(query, orderID, 1, req.UserEmail, req.PackageID, packageName, req.Amount, req.PaymentType, snapToken, snapRedirectURL)
		if err != nil {
			log.Printf("[Thesa Payment] Could not save order to database: %v", err)
		}
	}

	log.Printf("[Thesa Payment] Order created: %s | Amount: Rp %.0f | Package: %s | User: %s", orderID, req.Amount, req.PackageID, req.UserEmail)

	writeJSON(w, http.StatusOK, CreateOrderResponse{
		Success:         true,
		OrderID:         orderID,
		PackageID:       req.PackageID,
		PackageName:     packageName,
		Amount:          req.Amount,
		Status:          "pending",
		SnapToken:       snapToken,
		SnapRedirectURL: snapRedirectURL,
		QRISCode:        fmt.Sprintf("00020101021226580014ID.LINKAJA.WWW01189360091800000000000215%s51440014ID.DANA.WWW0215000000000000000520458125303360540%0.0f5802ID5911THESA_AI6007JAKARTA62070703A016304%s", orderID, req.Amount, hex.EncodeToString(randBytes)),
	})
	_ = creditsToAdd
}

// Webhook processes asynchronous payment status notifications from Midtrans.
func (h *PaymentHandler) Webhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var notif payment.WebhookNotification
	if err := json.NewDecoder(r.Body).Decode(&notif); err != nil {
		log.Printf("[Thesa Webhook] Error parsing webhook payload: %v", err)
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	log.Printf("[Thesa Webhook] Received notification: Order %s | Status: %s | Amount: %s | Type: %s",
		notif.OrderID, notif.TransactionStatus, notif.GrossAmount, notif.PaymentType)

	// Verify cryptographic signature
	if !h.midtrans.VerifySignature(notif.OrderID, notif.StatusCode, notif.GrossAmount, notif.SignatureKey) {
		log.Printf("[Thesa Webhook] WARNING: Invalid signature for order %s!", notif.OrderID)
		http.Error(w, "Invalid signature", http.StatusForbidden)
		return
	}

	// Determine new order status
	isSettled := false
	orderStatus := "pending"

	switch notif.TransactionStatus {
	case "capture", "settlement":
		if notif.FraudStatus == "accept" || notif.FraudStatus == "" {
			orderStatus = "settled"
			isSettled = true
		}
	case "deny", "cancel", "expire":
		orderStatus = "failed"
	case "pending":
		orderStatus = "pending"
	}

	// Update order and record transaction in MySQL
	if db.DB != nil {
		grossVal, _ := strconv.ParseFloat(notif.GrossAmount, 64)
		rawBytes, _ := json.Marshal(notif)

		// 1. Log transaction
		trxQuery := `INSERT INTO payment_transactions (order_id, transaction_id, payment_type, gross_amount, transaction_status, fraud_status, signature_key, raw_payload)
		             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		_, _ = db.DB.Exec(trxQuery, notif.OrderID, notif.TransactionID, notif.PaymentType, grossVal, notif.TransactionStatus, notif.FraudStatus, notif.SignatureKey, string(rawBytes))

		// 2. Update Order status
		if isSettled {
			updateQuery := `UPDATE orders SET status = 'settled', settled_at = NOW(), payment_type = ? WHERE order_id = ?`
			_, err := db.DB.Exec(updateQuery, notif.PaymentType, notif.OrderID)
			if err != nil {
				log.Printf("[Thesa Webhook] Could not update order to settled: %v", err)
			}

			// Add credits to user
			_, _ = db.DB.Exec(`UPDATE users u JOIN orders o ON u.id = o.user_id SET u.credits = u.credits + 1, u.tier = 'platinum' WHERE o.order_id = ?`, notif.OrderID)
			log.Printf("[Thesa Webhook] Order %s successfully settled! User access unlocked.", notif.OrderID)
		} else {
			_, _ = db.DB.Exec(`UPDATE orders SET status = ? WHERE order_id = ?`, orderStatus, notif.OrderID)
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":   "ok",
		"order_id": notif.OrderID,
		"settled":  isSettled,
	})
}

// GetStatus checks the current status of an order for frontend polling.
func (h *PaymentHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	orderID := r.URL.Query().Get("order_id")
	if orderID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "order_id parameter is required"})
		return
	}

	status := "pending"
	var settledAt *time.Time
	var amount float64
	var packageName string

	if db.DB != nil {
		var o struct {
			Status      string     `db:"status"`
			Amount      float64    `db:"amount"`
			PackageName string     `db:"package_name"`
			SettledAt   *time.Time `db:"settled_at"`
		}
		err := db.DB.Get(&o, "SELECT status, amount, package_name, settled_at FROM orders WHERE order_id = ?", orderID)
		if err == nil {
			status = o.Status
			amount = o.Amount
			packageName = o.PackageName
			settledAt = o.SettledAt
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":      true,
		"order_id":     orderID,
		"status":       status,
		"amount":       amount,
		"package_name": packageName,
		"settled":      status == "settled",
		"settled_at":   settledAt,
	})
}

// SimulatePayment allows testing instant payment settlement in development/sandbox.
func (h *PaymentHandler) SimulatePayment(w http.ResponseWriter, r *http.Request) {
	orderID := r.URL.Query().Get("order_id")
	if orderID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "order_id required"})
		return
	}

	if db.DB != nil {
		_, err := db.DB.Exec(`UPDATE orders SET status = 'settled', settled_at = NOW() WHERE order_id = ?`, orderID)
		if err != nil {
			log.Printf("[Thesa Payment Simulation] Update error: %v", err)
		}
		// Also increment credits
		_, _ = db.DB.Exec(`UPDATE users SET credits = credits + 1, tier = 'platinum' WHERE id = 1`)
	}

	log.Printf("[Thesa Payment Simulation] Order %s forcefully settled for demo verification.", orderID)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":  true,
		"order_id": orderID,
		"status":   "settled",
		"message":  "Pembayaran QRIS berhasil diverifikasi secara instan.",
	})
}
