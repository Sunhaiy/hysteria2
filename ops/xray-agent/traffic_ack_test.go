package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCapabilitiesExposeDurableAcknowledgements(t *testing.T) {
	a := &agent{verifyRevocation: func(context.Context) error { return nil }}
	w := httptest.NewRecorder()
	a.capabilities(w, httptest.NewRequest(http.MethodGet, "/capabilities", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"trafficAcknowledgement":"suxin-traffic-ack-v1"`) {
		t.Fatal("deployment cannot confirm acknowledgement capability", w.Code, w.Body.String())
	}
}

func TestAcknowledgementWriteFailurePreservesPendingTraffic(t *testing.T) {
	stateFile := filepath.Join(t.TempDir(), "traffic-batch.json")
	batch := &trafficBatch{ID: "receipt-a", ClaimedAt: time.Now().UTC(), Traffic: map[string]map[string]int64{"user": {"tx": 3, "rx": 7}}}
	a := &agent{stateFile: stateFile, pending: batch}
	if err := a.persistPendingBatch(batch); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(stateFile+".last-ack", 0700); err != nil {
		t.Fatal(err)
	}
	if w := ackBatch(a, batch.ID); w.Code != http.StatusInternalServerError {
		t.Fatal("failed receipt persistence was acknowledged", w.Code)
	}
	if a.pending != batch {
		t.Fatal("failed receipt persistence cleared pending memory")
	}
	if _, err := os.Stat(stateFile); err != nil {
		t.Fatal("failed receipt persistence removed pending file", err)
	}
}

func ackBatch(a *agent, id string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	body, _ := json.Marshal(acknowledgeRequest{ID: id})
	a.acknowledgeTraffic(w, httptest.NewRequest(http.MethodPost, "/traffic/ack", strings.NewReader(string(body))))
	return w
}

func TestAcknowledgementSurvivesLostResponseAndAgentRestart(t *testing.T) {
	stateFile := filepath.Join(t.TempDir(), "traffic-batch.json")
	batch := &trafficBatch{ID: "receipt-a", ClaimedAt: time.Now().UTC(), Traffic: map[string]map[string]int64{"user": {"tx": 3, "rx": 7}}}
	a := &agent{stateFile: stateFile, pending: batch}
	if err := a.persistPendingBatch(batch); err != nil {
		t.Fatal(err)
	}
	if w := ackBatch(a, batch.ID); w.Code != http.StatusOK {
		t.Fatal(w.Code, w.Body.String())
	}
	// The caller did not receive that response. Reload the actual durable state.
	restarted := &agent{stateFile: stateFile}
	if err := restarted.loadPendingBatch(); err != nil {
		t.Fatal(err)
	}
	if w := ackBatch(restarted, batch.ID); w.Code != http.StatusOK {
		t.Fatalf("repeated acknowledged receipt must succeed after restart: %d %s", w.Code, w.Body.String())
	}
	if restarted.pending != nil {
		t.Fatal("acknowledged traffic reappeared as pending")
	}
}

func TestOldAcknowledgementDoesNotClearNewPendingBatch(t *testing.T) {
	stateFile := filepath.Join(t.TempDir(), "traffic-batch.json")
	a := &agent{stateFile: stateFile}
	first := &trafficBatch{ID: "receipt-a", ClaimedAt: time.Now().UTC(), Traffic: map[string]map[string]int64{}}
	a.pending = first
	if err := a.persistPendingBatch(first); err != nil {
		t.Fatal(err)
	}
	if w := ackBatch(a, first.ID); w.Code != http.StatusOK {
		t.Fatal(w.Code)
	}
	second := &trafficBatch{ID: "receipt-b", ClaimedAt: time.Now().UTC(), Traffic: map[string]map[string]int64{"user": {"tx": 1, "rx": 2}}}
	a.pending = second
	if err := a.persistPendingBatch(second); err != nil {
		t.Fatal(err)
	}
	if w := ackBatch(a, first.ID); w.Code != http.StatusOK {
		t.Fatal(w.Code)
	}
	restarted := &agent{stateFile: stateFile}
	if err := restarted.loadPendingBatch(); err != nil {
		t.Fatal(err)
	}
	if restarted.pending == nil || restarted.pending.ID != second.ID {
		t.Fatal("old ACK removed the next batch")
	}
	if w := ackBatch(restarted, "unrecognized-receipt"); w.Code != http.StatusConflict {
		t.Fatal("unknown ACK must not be invented", w.Code)
	}
	if restarted.pending.ID != second.ID {
		t.Fatal("unknown ACK changed pending traffic")
	}
}

func TestLegacyPendingTrafficIsPreservedOnUpgrade(t *testing.T) {
	stateFile := filepath.Join(t.TempDir(), "traffic-batch.json")
	batch := trafficBatch{ID: "old-version-batch", ClaimedAt: time.Now().UTC(), Traffic: map[string]map[string]int64{"user": {"tx": 10, "rx": 20}}}
	raw, _ := json.Marshal(batch)
	if err := os.WriteFile(stateFile, raw, 0600); err != nil {
		t.Fatal(err)
	}
	a := &agent{stateFile: stateFile}
	if err := a.loadPendingBatch(); err != nil {
		t.Fatal(err)
	}
	if a.pending == nil || a.pending.ID != batch.ID || a.pending.Traffic["user"]["rx"] != 20 {
		t.Fatal("upgrade lost a legacy pending batch")
	}
}
