//go:build linux

package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func sumOf(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

type fixture struct {
	u            *updater
	j            journal
	body         []byte
	restarts     int
	failHealth   bool
	failTerminal bool
	statuses     []string
	server       *httptest.Server
}

func setup(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{body: []byte(strings.Repeat("new agent", 20))}
	dir := t.TempDir()
	for _, name := range []string{"releases", "receipts"} {
		if err := os.Mkdir(filepath.Join(dir, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	old := filepath.Join(dir, "releases", "old")
	if err := os.WriteFile(old, []byte("old agent"), 0700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "agent-current")
	if err := os.Symlink(old, link); err != nil {
		t.Fatal(err)
	}
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	der, _ := x509.MarshalPKIXPublicKey(pub)
	m := manifest{Format: 1, ID: "release1", Version: "v2", Architecture: "amd64", SHA256: sumOf(f.body), Size: int64(len(f.body)), Component: "xray-agent"}
	raw, _ := json.Marshal(m)
	j := job{ID: "job1", Manifest: string(raw), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(priv, raw)), DownloadPath: "/api/agent-updater/jobs/job1/artifact"}
	f.j = journal{Job: j, Manifest: m, OldPath: old, OldVersion: "legacy", OldSHA256: sumOf([]byte("old agent")), Phase: "DOWNLOADING"}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Error("missing machine credential")
		}
		switch r.URL.Path {
		case j.DownloadPath:
			w.Write(f.body)
		case "/api/agent-updater/poll":
			json.NewEncoder(w).Encode(map[string]any{"job": j})
		case "/api/agent-updater/jobs/job1/report":
			var report map[string]string
			json.NewDecoder(r.Body).Decode(&report)
			f.statuses = append(f.statuses, report["status"])
			if f.failTerminal && report["status"] == "SUCCEEDED" {
				w.WriteHeader(503)
				return
			}
			w.Write([]byte(`{"ok":true}`))
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(f.server.Close)
	f.u = &updater{config: config{APIBaseURL: f.server.URL, Token: "test-token", PublicKey: string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})), Architecture: "amd64", StateDir: dir, AgentPath: link}, client: &http.Client{Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	f.u.restart = func() error { f.restarts++; return nil }
	f.u.healthy = func(expected string) error {
		actual, _ := fileHash(link)
		if actual != expected || f.failHealth && expected == m.SHA256 {
			return errors.New("unhealthy")
		}
		return nil
	}
	return f
}
func TestManifestRejectsTamperingAndWrongArchitecture(t *testing.T) {
	f := setup(t)
	if _, err := verifyManifest(f.j.Job, f.u.config.PublicKey, "amd64"); err != nil {
		t.Fatal(err)
	}
	j := f.j.Job
	j.Manifest += " "
	if _, err := verifyManifest(j, f.u.config.PublicKey, "amd64"); err == nil {
		t.Fatal("accepted modified signed bytes")
	}
	if _, err := verifyManifest(f.j.Job, f.u.config.PublicKey, "arm64"); err == nil {
		t.Fatal("accepted wrong CPU")
	}
	j = f.j.Job
	j.DownloadPath = "https://evil.invalid/package"
	if _, err := verifyManifest(j, f.u.config.PublicKey, "amd64"); err == nil {
		t.Fatal("accepted unbound download")
	}
}
func TestSuccessfulUpdatePreservesTrafficAndOldBinary(t *testing.T) {
	f := setup(t)
	traffic := filepath.Join(f.u.config.StateDir, "traffic-batch.json")
	os.WriteFile(traffic, []byte("pending accounting"), 0600)
	if err := f.u.tick(); err != nil {
		t.Fatal(err)
	}
	if f.restarts != 1 || f.statuses[len(f.statuses)-1] != "SUCCEEDED" {
		t.Fatalf("restart/status %d %v", f.restarts, f.statuses)
	}
	if _, err := os.Stat(f.j.OldPath); err != nil {
		t.Fatal("old binary missing")
	}
	b, _ := os.ReadFile(traffic)
	if string(b) != "pending accounting" {
		t.Fatal("traffic state modified")
	}
	version, hash, err := f.u.current()
	if err != nil || version != "v2" || hash != f.j.Manifest.SHA256 {
		t.Fatal("incorrect current version")
	}
}
func TestHealthFailureRollsBack(t *testing.T) {
	f := setup(t)
	f.failHealth = true
	if err := f.u.tick(); err != nil {
		t.Fatal(err)
	}
	hash, _ := fileHash(f.u.config.AgentPath)
	if hash != f.j.OldSHA256 || f.statuses[len(f.statuses)-1] != "ROLLED_BACK" || f.restarts != 2 {
		t.Fatalf("rollback not complete: %v", f.statuses)
	}
}
func TestTerminalAcknowledgementRetryDoesNotRestartAgain(t *testing.T) {
	f := setup(t)
	f.failTerminal = true
	if err := f.u.tick(); err == nil {
		t.Fatal("expected disconnected report")
	}
	f.failTerminal = false
	if err := f.u.tick(); err != nil {
		t.Fatal(err)
	}
	if f.restarts != 1 {
		t.Fatal("retried installation after local success")
	}
}
func TestInvalidDownloadNeverInstalls(t *testing.T) {
	f := setup(t)
	f.body = []byte("tampered")
	if err := f.u.tick(); err != nil {
		t.Fatal(err)
	}
	if f.restarts != 0 || f.statuses[len(f.statuses)-1] != "FAILED" {
		t.Fatal("invalid package was not rejected")
	}
}
func TestCorruptVerifiedFileFailsBeforeReplacement(t *testing.T) {
	f := setup(t)
	f.j.Phase = "VERIFYING"
	f.u.save(&f.j)
	if err := f.u.tick(); err != nil {
		t.Fatal(err)
	}
	if f.restarts != 0 || f.statuses[len(f.statuses)-1] != "FAILED" {
		t.Fatal("corrupt file was not rejected")
	}
}
func TestCrashRecovery(t *testing.T) {
	for _, phase := range []string{"INSTALLING", "LOCAL_HEALTHY", "CHECKING", "ROLLING_BACK"} {
		t.Run(phase, func(t *testing.T) {
			f := setup(t)
			candidate := filepath.Join(f.u.config.StateDir, "releases", f.j.Manifest.SHA256)
			os.WriteFile(candidate, f.body, 0700)
			switchLink(f.u.config.AgentPath, candidate)
			atomicJSON(filepath.Join(f.u.config.StateDir, "current.json"), map[string]string{"version": "v2", "sha256": f.j.Manifest.SHA256})
			f.j.Phase = phase
			f.u.save(&f.j)
			if err := f.u.tick(); err != nil {
				t.Fatal(err)
			}
			expected := "SUCCEEDED"
			if phase == "ROLLING_BACK" {
				expected = "ROLLED_BACK"
			}
			if f.statuses[len(f.statuses)-1] != expected {
				t.Fatal(f.statuses)
			}
			if phase != "ROLLING_BACK" && f.restarts != 0 {
				t.Fatal("healthy running candidate restarted after crash")
			}
		})
	}
}
func TestDownloadDisconnectRetainsOriginalJob(t *testing.T) {
	f := setup(t)
	f.u.save(&f.j)
	original := f.u.config.APIBaseURL
	f.u.config.APIBaseURL = "http://127.0.0.1:1"
	if err := f.u.tick(); err == nil {
		t.Fatal("expected disconnect")
	}
	if f.restarts != 0 {
		t.Fatal("offline install")
	}
	f.u.config.APIBaseURL = original
	if err := f.u.tick(); err != nil {
		t.Fatal(err)
	}
	if f.restarts != 1 {
		t.Fatal("did not resume")
	}
}
func TestRollbackFailurePersistsAndReportsReason(t *testing.T) {
	f := setup(t)
	f.u.healthy = func(string) error { return errors.New("unavailable") }
	if err := f.u.tick(); err == nil {
		t.Fatal("expected recovery failure")
	}
	if f.statuses[len(f.statuses)-1] != "ROLLING_BACK" {
		t.Fatal(f.statuses)
	}
	f.u.healthy = func(expected string) error {
		actual, _ := fileHash(f.u.config.AgentPath)
		if actual != expected {
			return errors.New("bad hash")
		}
		return nil
	}
	if err := f.u.tick(); err != nil {
		t.Fatal(err)
	}
	if f.statuses[len(f.statuses)-1] != "ROLLED_BACK" {
		t.Fatal(f.statuses)
	}
}
func TestCorruptCandidateAfterCrashDoesNotExecute(t *testing.T) {
	f := setup(t)
	f.j.Phase = "INSTALLING"
	f.u.save(&f.j)
	if err := f.u.tick(); err != nil {
		t.Fatal(err)
	}
	if f.statuses[len(f.statuses)-1] != "ROLLED_BACK" {
		t.Fatal(f.statuses)
	}
	actual, _ := fileHash(f.u.config.AgentPath)
	if actual != f.j.OldSHA256 {
		t.Fatal("did not restore old executable")
	}
}
func TestRedirectDoesNotForwardCredential(t *testing.T) {
	f := setup(t)
	hits := 0
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++; w.WriteHeader(200) }))
	defer other.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, other.URL, 302) }))
	defer redirect.Close()
	f.u.config.APIBaseURL = redirect.URL
	if _, err := f.u.request("GET", "/artifact", nil); err == nil {
		t.Fatal("redirect accepted")
	}
	if hits != 0 {
		t.Fatal("credential forwarded")
	}
}
