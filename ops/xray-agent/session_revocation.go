package main

import (
	"context"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

const revocationMarker = "suxin-session-revoke-v1"

func (a *agent) capabilities(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := a.requireSessionRevocation(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"sessionRevocation": revocationMarker})
}

func (a *agent) requireSessionRevocation(ctx context.Context) error {
	if a.verifyRevocation == nil {
		return fmt.Errorf("session revocation capability verifier is not configured")
	}
	return a.verifyRevocation(ctx)
}

func (a *agent) verifyRunningCoreRevocation(ctx context.Context) error {
	unit := a.services["xray"]
	if unit == "" {
		return fmt.Errorf("xray service mapping missing")
	}
	_, _, pid, err := a.manager.status(ctx, unit)
	if err != nil {
		return err
	}
	if pid <= 0 {
		return fmt.Errorf("xray is not running; cannot confirm session revocation")
	}
	// Inspect the running executable, not the replacement file on disk. Merely
	// installing a new binary without restarting its instance is insufficient.
	output, err := exec.CommandContext(ctx, fmt.Sprintf("/proc/%d/exe", pid), "version").Output()
	if err != nil {
		return fmt.Errorf("read running xray capability: %w", err)
	}
	if !strings.Contains(string(output), revocationMarker) {
		return fmt.Errorf("running xray lacks %s; live disconnect was NOT confirmed", revocationMarker)
	}
	return nil
}

