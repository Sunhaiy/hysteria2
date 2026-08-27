package main

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeServiceManager struct {
	activeState string
	mainPID     int
	err         error
	controls    int
}

func (manager *fakeServiceManager) status(
	_ context.Context,
	_ string,
) (string, string, int, error) {
	return manager.activeState, "running", manager.mainPID, manager.err
}

func (manager *fakeServiceManager) control(
	_ context.Context,
	_ string,
	_ string,
) (string, string, int, error) {
	manager.controls++
	return manager.activeState, "running", manager.mainPID, manager.err
}

func runtimeAgent(manager serviceManager) *agent {
	return &agent{
		services: map[string]string{
			"xray": "xray.service",
		},
		manager:   manager,
		completed: make(map[string]completedServiceCommand),
	}
}

func TestServiceControlIsIdempotent(t *testing.T) {
	manager := &fakeServiceManager{activeState: "inactive", mainPID: 0}
	a := runtimeAgent(manager)
	body := []byte(`{"service":"xray","action":"stop","idempotencyKey":"command-1"}`)
	for range 2 {
		request := httptest.NewRequest(http.MethodPost, "/service/control", bytes.NewReader(body))
		response := httptest.NewRecorder()
		a.serviceControl(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
		}
	}
	if manager.controls != 1 {
		t.Fatalf("expected one systemd control call, got %d", manager.controls)
	}
}

func TestServiceStatusReportsMainPID(t *testing.T) {
	manager := &fakeServiceManager{activeState: "active", mainPID: 4242}
	a := runtimeAgent(manager)
	request := httptest.NewRequest(http.MethodGet, "/service/status?service=xray", nil)
	response := httptest.NewRecorder()

	a.serviceStatus(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if !bytes.Contains(response.Body.Bytes(), []byte(`"mainPid":4242`)) {
		t.Fatalf("expected main PID in response: %s", response.Body.String())
	}
}

func TestServiceControlRejectsUnlistedService(t *testing.T) {
	manager := &fakeServiceManager{activeState: "inactive"}
	a := runtimeAgent(manager)
	request := httptest.NewRequest(
		http.MethodPost,
		"/service/control",
		bytes.NewBufferString(`{"service":"ssh","action":"stop","idempotencyKey":"command-1"}`),
	)
	response := httptest.NewRecorder()

	a.serviceControl(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
	if manager.controls != 0 {
		t.Fatalf("unlisted service reached systemd manager")
	}
}

func TestServiceControlReportsManagerFailure(t *testing.T) {
	manager := &fakeServiceManager{err: errors.New("systemd unavailable")}
	a := runtimeAgent(manager)
	request := httptest.NewRequest(
		http.MethodPost,
		"/service/control",
		bytes.NewBufferString(`{"service":"xray","action":"start","idempotencyKey":"command-1"}`),
	)
	response := httptest.NewRecorder()

	a.serviceControl(response, request)

	if response.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", response.Code, response.Body.String())
	}
}

func TestParseServiceAllowlistRejectsArbitraryUnits(t *testing.T) {
	if _, err := parseServiceAllowlist("xray=xray.service;reboot"); err == nil {
		t.Fatal("expected unsafe unit name to be rejected")
	}
	if _, err := parseServiceAllowlist("ssh=ssh.service"); err == nil {
		t.Fatal("expected unsupported logical service to be rejected")
	}
}

func TestParseSystemctlPropertySupportsLegacyOutput(t *testing.T) {
	tests := []struct {
		name     string
		output   string
		property string
		expected string
	}{
		{
			name:     "active state",
			output:   "ActiveState=active\n",
			property: "ActiveState",
			expected: "active",
		},
		{
			name:     "main PID with CRLF",
			output:   "MainPID=25320\r\n",
			property: "MainPID",
			expected: "25320",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			value, err := parseSystemctlProperty([]byte(test.output), test.property)
			if err != nil {
				t.Fatalf("parse property: %v", err)
			}
			if value != test.expected {
				t.Fatalf("expected %q, got %q", test.expected, value)
			}
		})
	}
}

func TestParseSystemctlPropertyRejectsMissingProperty(t *testing.T) {
	if _, err := parseSystemctlProperty([]byte("SubState=running\n"), "MainPID"); err == nil {
		t.Fatal("expected missing property to fail")
	}
}
