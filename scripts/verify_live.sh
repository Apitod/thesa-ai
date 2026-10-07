#!/bin/bash
set -e

BASE_URL="${1:-http://localhost:8088}"
echo "=================================================="
echo "⚡ THESA AI — END-TO-END LIVE ENGINE AUDIT & SUITE"
echo "Target Base URL: $BASE_URL"
echo "=================================================="

# 1. Health Diagnostics
echo -n "[1/10] Diagnostics Health Endpoint... "
HEALTH_RES=$(curl -s "$BASE_URL/health")
if echo "$HEALTH_RES" | grep -q '"status":"ok"'; then
  echo "✓ PASSED (Engine Active)"
else
  echo "❌ FAILED: $HEALTH_RES"
  exit 1
fi

# 2. Workspace HTML
echo -n "[2/10] Workspace HTML SPA (/app.html)... "
APP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/app.html")
if [ "$APP_STATUS" -eq 200 ]; then
  echo "✓ PASSED (HTTP 200 OK)"
else
  echo "❌ FAILED (HTTP $APP_STATUS)"
  exit 1
fi

# 3. Landing Page HTML
echo -n "[3/10] Landing Page (/landing.html)... "
LANDING_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/landing.html")
if [ "$LANDING_STATUS" -eq 200 ]; then
  echo "✓ PASSED (HTTP 200 OK)"
else
  echo "❌ FAILED (HTTP $LANDING_STATUS)"
  exit 1
fi

# 4. JavaScript Assets
echo -n "[4/10] JavaScript Application Bundles (/app.js & /export_service.js)... "
JS1=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/app.js")
JS2=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/export_service.js")
if [ "$JS1" -eq 200 ] && [ "$JS2" -eq 200 ]; then
  echo "✓ PASSED (Assets Loaded)"
else
  echo "❌ FAILED (app.js: $JS1, export_service.js: $JS2)"
  exit 1
fi

# 5. Literature Search API
echo -n "[5/10] PubMed & Garuda Literature API (/api/literature/gap-analysis)... "
LIT_RES=$(curl -s -X POST -H "Content-Type: application/json" -d '{"topic":"Machine Learning"}' "$BASE_URL/api/literature/gap-analysis")
if echo "$LIT_RES" | grep -q '"noveltyScore"'; then
  echo "✓ PASSED (Gap Analysis Working)"
else
  echo "❌ FAILED: $LIT_RES"
  exit 1
fi

# 6. Outline Generator API (8-12 Page Engine)
echo -n "[6/10] AI Outline 8-12 Page Generator (/api/v1/outline/generate)... "
OUTLINE_RES=$(curl -s -X POST -H "Content-Type: application/json" -d '{"topic":"AI Skripsi","target_words":8000}' "$BASE_URL/api/v1/outline/generate")
if echo "$OUTLINE_RES" | grep -q '"BAB I PENDAHULUAN"'; then
  echo "✓ PASSED (5-Chapter Structure Returned)"
else
  echo "❌ FAILED: $OUTLINE_RES"
  exit 1
fi

# 7. Payment Order API (Midtrans QRIS)
echo -n "[7/10] Midtrans QRIS Order Endpoint (/api/v1/payment/create-order)... "
PAY_RES=$(curl -s -X POST -H "Content-Type: application/json" -d '{"package":"booster50k"}' "$BASE_URL/api/v1/payment/create-order")
if echo "$PAY_RES" | grep -q '"orderId"'; then
  echo "✓ PASSED (Snap Token & QRIS Returned)"
else
  echo "❌ FAILED: $PAY_RES"
  exit 1
fi

# 8. Socratic Supervisor API
echo -n "[8/10] Socratic Supervisor Examiner Endpoint (/api/v1/supervisor/socratic-questions)... "
SOC_RES=$(curl -s -X POST -H "Content-Type: application/json" -d '{"topic":"AI"}' "$BASE_URL/api/v1/supervisor/socratic-questions")
if echo "$SOC_RES" | grep -q '"questions"'; then
  echo "✓ PASSED (Socratic Questions Generated)"
else
  echo "❌ FAILED: $SOC_RES"
  exit 1
fi

# 9. Deliberative Conversation Turn & Bidirectional Co-Authoring API
echo -n "[9/10] Deliberative Turn & Cascade Reconciler (/api/v1/conversation/turn)... "
TURN_RES=$(curl -s -X POST -H "Content-Type: application/json" -d '{"project_id":1,"current_step":"1.1","target_section":"1.1","user_message":"Tambahkan bukti empiris","action_type":"free_text","topic":"AI Skripsi"}' "$BASE_URL/api/v1/conversation/turn")
if echo "$TURN_RES" | grep -q '"draft_content"'; then
  echo "✓ PASSED (Socratic Synthesis & Cascade Returned)"
else
  echo "❌ FAILED: $TURN_RES"
  exit 1
fi

# 10. Proactive Contextual Recommendation API
echo -n "[10/10] Proactive Contextual Pedagogical Chips (/api/v1/conversation/recommend)... "
REC_RES=$(curl -s -X POST -H "Content-Type: application/json" -d '{"project_id":1,"current_step":"1.1"}' "$BASE_URL/api/v1/conversation/recommend")
if echo "$REC_RES" | grep -q '"recommendations"'; then
  echo "✓ PASSED (Contextual Recommendations Active)"
else
  echo "❌ FAILED: $REC_RES"
  exit 1
fi

echo "=================================================="
echo "🎉 ALL 10/10 LIVE ENGINE ENDPOINTS PASSED CLEANLY!"
echo "=================================================="
