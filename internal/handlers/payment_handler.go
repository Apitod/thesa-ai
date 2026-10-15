package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"risethub_os/backend/internal/db"
	"risethub_os/backend/internal/payment"
)

const (
	minimumTopUp  = 10000
	maximumTopUp  = 10000000
	goldPrice     = 99000
	platinumPrice = 249000
)

// PaymentHandler manages Midtrans orders and verified callbacks.
type PaymentHandler struct{ midtrans *payment.MidtransClient }

func NewPaymentHandler() *PaymentHandler {
	return &PaymentHandler{midtrans: payment.NewMidtransClient()}
}

type CreateOrderRequest struct {
	TopupType string  `json:"topup_type"` // topup, upgrade-gold, upgrade-platinum
	Amount    float64 `json:"amount"`     // only used for a custom topup
}

type CreateOrderResponse struct {
	Success         bool    `json:"success"`
	Message         string  `json:"message,omitempty"`
	OrderID         string  `json:"order_id,omitempty"`
	PackageID       string  `json:"package_id,omitempty"`
	PackageName     string  `json:"package_name,omitempty"`
	Amount          float64 `json:"amount,omitempty"`
	Status          string  `json:"status,omitempty"`
	SnapToken       string  `json:"snap_token,omitempty"`
	SnapRedirectURL string  `json:"snap_redirect_url,omitempty"`
}

func authenticatedUser(r *http.Request) (*User, bool) {
	return ValidateUserSession(extractBearerToken(r))
}

func orderDetails(kind string, requested float64) (float64, string, error) {
	switch kind {
	case "topup":
		if math.IsNaN(requested) || math.IsInf(requested, 0) || requested < minimumTopUp || requested > maximumTopUp || math.Trunc(requested) != requested {
			return 0, "", fmt.Errorf("nominal top up harus berupa angka bulat Rp10.000–Rp10.000.000")
		}
		return requested, fmt.Sprintf("Top Up Saldo Thesa Rp %.0f", requested), nil
	case "upgrade-gold":
		return goldPrice, "Upgrade Gold Thesa AI (1 bulan)", nil
	case "upgrade-platinum":
		return platinumPrice, "Upgrade Platinum Thesa AI (1 bulan)", nil
	default:
		return 0, "", fmt.Errorf("jenis pembayaran tidak valid")
	}
}

// CreateOrder creates a QRIS-only Snap order for the authenticated account.
func (h *PaymentHandler) CreateOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, CreateOrderResponse{Success: false, Message: "Method tidak diizinkan."})
		return
	}
	user, ok := authenticatedUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, CreateOrderResponse{Success: false, Message: "Silakan masuk kembali untuk melakukan pembayaran."})
		return
	}
	var req CreateOrderRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, CreateOrderResponse{Success: false, Message: "Data pembayaran tidak valid."})
		return
	}
	amount, packageName, err := orderDetails(strings.TrimSpace(req.TopupType), req.Amount)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, CreateOrderResponse{Success: false, Message: err.Error()})
		return
	}
	if db.DB == nil || !db.IsConnected() {
		writeJSON(w, http.StatusServiceUnavailable, CreateOrderResponse{Success: false, Message: "Layanan pembayaran sedang tidak tersedia."})
		return
	}
	random := make([]byte, 6)
	if _, err := rand.Read(random); err != nil {
		writeJSON(w, http.StatusInternalServerError, CreateOrderResponse{Success: false, Message: "Gagal membuat order pembayaran."})
		return
	}
	orderID := fmt.Sprintf("THESA-%s-%d-%s", strings.ToUpper(req.TopupType), time.Now().UnixMilli(), hex.EncodeToString(random))
	snapResp, err := h.midtrans.CreateSnapTransaction(payment.SnapTransactionRequest{
		TransactionDetails: payment.TransactionDetails{OrderID: orderID, GrossAmount: amount},
		CustomerDetails:    payment.CustomerDetails{Email: user.Email, FirstName: user.FullName},
		ItemDetails:        []payment.ItemDetail{{ID: req.TopupType, Price: amount, Quantity: 1, Name: packageName}},
		EnabledPayments:    []string{"qris"},
	})
	if err != nil || snapResp == nil || snapResp.Token == "" {
		log.Printf("[Thesa Payment] create Snap order failed: %v", err)
		writeJSON(w, http.StatusBadGateway, CreateOrderResponse{Success: false, Message: "Gateway pembayaran belum dapat membuat order. Coba lagi sebentar."})
		return
	}
	_, err = db.DB.Exec(`INSERT INTO orders (order_id, user_id, user_email, package_id, package_name, amount, status, payment_type, snap_token, snap_redirect_url) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'qris', ?, ?)`, orderID, user.ID, user.Email, req.TopupType, packageName, amount, snapResp.Token, snapResp.RedirectURL)
	if err != nil {
		log.Printf("[Thesa Payment] saving order failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, CreateOrderResponse{Success: false, Message: "Order pembayaran tidak dapat disimpan."})
		return
	}
	writeJSON(w, http.StatusOK, CreateOrderResponse{Success: true, OrderID: orderID, PackageID: req.TopupType, PackageName: packageName, Amount: amount, Status: "pending", SnapToken: snapResp.Token, SnapRedirectURL: snapResp.RedirectURL})
}

// Webhook accepts only a signed Midtrans notification. The transition and
// benefit are atomic, so provider retries cannot add balance twice.
func (h *PaymentHandler) Webhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var notif payment.WebhookNotification
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&notif); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}
	if !h.midtrans.VerifySignature(notif.OrderID, notif.StatusCode, notif.GrossAmount, notif.SignatureKey) {
		http.Error(w, "Invalid signature", http.StatusForbidden)
		return
	}
	if db.DB == nil || !db.IsConnected() {
		http.Error(w, "Database unavailable", http.StatusServiceUnavailable)
		return
	}
	settled := (notif.TransactionStatus == "settlement" || notif.TransactionStatus == "capture") && (notif.FraudStatus == "" || notif.FraudStatus == "accept")
	status := "pending"
	if settled {
		status = "settled"
	} else if notif.TransactionStatus == "deny" || notif.TransactionStatus == "cancel" || notif.TransactionStatus == "expire" {
		status = "failed"
	}
	tx, err := db.DB.Beginx()
	if err != nil {
		http.Error(w, "Database unavailable", http.StatusServiceUnavailable)
		return
	}
	defer tx.Rollback()
	var order struct {
		UserID    int     `db:"user_id"`
		PackageID string  `db:"package_id"`
		Amount    float64 `db:"amount"`
		Status    string  `db:"status"`
	}
	if err := tx.Get(&order, `SELECT user_id, package_id, amount, status FROM orders WHERE order_id = ? FOR UPDATE`, notif.OrderID); err != nil {
		http.Error(w, "Unknown order", http.StatusNotFound)
		return
	}
	providerAmount, err := strconv.ParseFloat(notif.GrossAmount, 64)
	if err != nil || math.Abs(providerAmount-order.Amount) > 0.001 {
		log.Printf("[Thesa Payment] amount mismatch for %s", notif.OrderID)
		http.Error(w, "Invalid amount", http.StatusBadRequest)
		return
	}
	if settled && order.Status == "pending" {
		if err := applyOrderBenefit(tx, order.UserID, order.PackageID, order.Amount); err != nil {
			log.Printf("[Thesa Payment] applying benefit failed: %v", err)
			http.Error(w, "Unable to settle order", http.StatusInternalServerError)
			return
		}
		if _, err := tx.Exec(`UPDATE orders SET status = 'settled', settled_at = NOW(), payment_type = ? WHERE order_id = ? AND status = 'pending'`, notif.PaymentType, notif.OrderID); err != nil {
			http.Error(w, "Unable to settle order", http.StatusInternalServerError)
			return
		}
	} else if !settled && order.Status == "pending" {
		_, _ = tx.Exec(`UPDATE orders SET status = ?, payment_type = ? WHERE order_id = ?`, status, notif.PaymentType, notif.OrderID)
	}
	raw, _ := json.Marshal(notif)
	_, _ = tx.Exec(`INSERT INTO payment_transactions (order_id, transaction_id, payment_type, gross_amount, transaction_status, fraud_status, raw_payload) VALUES (?, ?, ?, ?, ?, ?, ?)`, notif.OrderID, notif.TransactionID, notif.PaymentType, order.Amount, notif.TransactionStatus, notif.FraudStatus, string(raw))
	if err := tx.Commit(); err != nil {
		http.Error(w, "Unable to settle order", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "settled": settled})
}

func applyOrderBenefit(tx *sqlx.Tx, userID int, packageID string, amount float64) error {
	switch packageID {
	case "topup":
		_, err := tx.Exec(`UPDATE users SET silver_balance = silver_balance + ? WHERE id = ?`, amount, userID)
		return err
	case "upgrade-gold":
		_, err := tx.Exec(`UPDATE users SET tier = CASE WHEN tier = 'platinum' THEN tier ELSE 'gold' END WHERE id = ?`, userID)
		return err
	case "upgrade-platinum":
		_, err := tx.Exec(`UPDATE users SET tier = 'platinum' WHERE id = ?`, userID)
		return err
	default:
		return fmt.Errorf("unknown package %q", packageID)
	}
}

// GetStatus exposes an order only to its owner.
func (h *PaymentHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	user, ok := authenticatedUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"success": false, "message": "Sesi tidak valid."})
		return
	}
	orderID := strings.TrimSpace(r.URL.Query().Get("order_id"))
	if orderID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "order_id wajib diisi."})
		return
	}
	var order struct {
		Status      string  `db:"status"`
		Amount      float64 `db:"amount"`
		PackageName string  `db:"package_name"`
	}
	if db.DB == nil || db.DB.Get(&order, `SELECT status, amount, package_name FROM orders WHERE order_id = ? AND user_id = ?`, orderID, user.ID) != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"success": false, "message": "Order tidak ditemukan."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "order_id": orderID, "status": order.Status, "amount": order.Amount, "package_name": order.PackageName, "settled": order.Status == "settled"})
}
