"""Black-box smoke test against a running stack (python3 tests/smoke_api.py [base_url]). Stdlib only."""
import json, sys, threading, urllib.request, urllib.error, hmac, hashlib, base64, os

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
SALT = os.environ.get("DAY1_SALT", "")

def call(method, path, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")

def canonical(o): return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
def sign(id_, p): return hmac.new(SALT.encode(), (id_ + "|" + canonical(p)).encode(), hashlib.sha256).hexdigest()

ok = 0
def check(cond, label):
    global ok
    print(("PASS " if cond else "FAIL ") + label)
    ok += 1 if cond else 0
    return cond

s, b = call("GET", "/health"); check(s == 200 and b == {"status": "ok"}, "health")
s, b = call("POST", "/audit/v1/reset", {"stock": {"var-jersey-001-M": 1}}); check(s == 200 and b["status"] == "reset_complete", "reset")
s, b = call("POST", "/audit/v1/events", {"event_id": "evt-1", "match_id": "sm1", "type": "match_init", "payload": {"sport_id": "football", "home_team_id": "t1", "away_team_id": "t2"}})
check(s == 201 and (not SALT or b["signature"] == sign("evt-1", {"sport_id": "football", "home_team_id": "t1", "away_team_id": "t2"})), "event signature (python recompute)")
results = []
def buy(i):
    results.append(call("POST", "/audit/v1/checkout", {"order_id": f"ord-{i}", "customer_id": "c", "items": [{"variant_id": "var-jersey-001-M", "quantity": 1}], "discount_code": None, "payment": {"token": "tok_success"}}))
bar = threading.Barrier(20)
ts = [threading.Thread(target=lambda i=i: (bar.wait(), buy(i))) for i in range(20)]
[t.start() for t in ts]; [t.join() for t in ts]
codes = sorted(r[0] for r in results)
check(codes.count(201) == 1 and codes.count(409) == 19, f"20 buyers -> {codes.count(201)}x201 {codes.count(409)}x409")
win = next(r[1] for r in results if r[0] == 201)
check(not SALT or win["receipt"]["signature"] == sign(win["order_id"], win["receipt"]["payload"]), "receipt signature")
pdf = base64.b64decode(win["receipt"]["pdf_base64"])
check(pdf.startswith(b"%PDF") and b"PKR 4500.00" in pdf, "pdf receipt")
s, b = call("GET", "/audit/v1/inventory/var-jersey-001-M"); check(b == {"variant_id": "var-jersey-001-M", "stock": 0, "reserved": 0}, "inventory after burst")
s, m = call("POST", "/audit/v1/rbac-matrix")
s, b = call("GET", "/audit/v1/rbac/platform/config", headers={"Authorization": "Bearer " + m["tokens"]["super_admin"]}); check(s == 200 and b == {"authorized": True}, "rbac P7 super admin")
s, b = call("GET", "/audit/v1/rbac/platform/config", headers={"Authorization": "Bearer " + m["tokens"]["viewer"]}); check(s == 403, "rbac P7 viewer 403")
codes = [call("GET", "/api/v1/ping")[0] for _ in range(150)]
check(codes[0] == 200 and codes.count(429) >= 40, f"rate limit ({codes.count(429)} x 429)")
print(f"{ok} checks passed")
