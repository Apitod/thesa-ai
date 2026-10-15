package handlers

import "testing"

func TestOrderDetails(t *testing.T) {
	tests := []struct {
		name    string
		kind    string
		amount  float64
		want    float64
		wantErr bool
	}{
		{name: "minimum custom topup", kind: "topup", amount: 10000, want: 10000},
		{name: "rejects too small topup", kind: "topup", amount: 9999, wantErr: true},
		{name: "rejects decimal topup", kind: "topup", amount: 10000.5, wantErr: true},
		{name: "gold price is server controlled", kind: "upgrade-gold", amount: 1, want: goldPrice},
		{name: "platinum price is server controlled", kind: "upgrade-platinum", amount: 1, want: platinumPrice},
		{name: "rejects unknown product", kind: "admin", amount: 10000, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, _, err := orderDetails(tt.kind, tt.amount)
			if (err != nil) != tt.wantErr {
				t.Fatalf("orderDetails() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && got != tt.want {
				t.Fatalf("orderDetails() amount = %v, want %v", got, tt.want)
			}
		})
	}
}
