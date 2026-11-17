package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestAgentShutdownDrainsInFlightRequestBeforeReturning(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	entered := make(chan struct{})
	release := make(chan struct{})
	shutdownStarted := make(chan struct{})
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		select {
		case <-release:
			_, _ = w.Write([]byte("persisted"))
		case <-r.Context().Done():
		}
	})}
	server.RegisterOnShutdown(func() { close(shutdownStarted) })
	defer server.Close()
	defer close(release)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	served := make(chan error, 1)
	go func() { served <- serveAgent(ctx, server, listener, 2*time.Second) }()
	response := make(chan string, 1)
	go func() {
		res, err := http.Get("http://" + listener.Addr().String() + "/traffic/claim")
		if err != nil {
			response <- err.Error()
			return
		}
		defer res.Body.Close()
		body, err := io.ReadAll(res.Body)
		if err != nil {
			response <- err.Error()
			return
		}
		response <- string(body)
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("HTTP request did not enter handler")
	}
	cancel()
	select {
	case <-shutdownStarted:
	case <-time.After(time.Second):
		t.Fatal("cancellation did not start HTTP shutdown")
	}
	select {
	case err := <-served:
		t.Fatalf("server returned before in-flight request finished: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	release <- struct{}{}
	select {
	case body := <-response:
		if body != "persisted" {
			t.Fatalf("in-flight response was interrupted: %q", body)
		}
	case <-time.After(time.Second):
		t.Fatal("request did not finish after release")
	}
	select {
	case err := <-served:
		if err != nil {
			t.Fatalf("graceful shutdown failed: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("server did not return after draining its request")
	}
}

func TestAgentShutdownHasAFiniteDrainBudget(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	entered := make(chan struct{})
	server := &http.Server{Handler: http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
	})}
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	served := make(chan error, 1)
	go func() { served <- serveAgent(ctx, server, listener, 50*time.Millisecond) }()
	requestDone := make(chan struct{})
	go func() {
		defer close(requestDone)
		res, err := http.Get("http://" + listener.Addr().String() + "/traffic/ack")
		if err == nil {
			res.Body.Close()
		}
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("HTTP request did not enter handler")
	}
	cancel()
	select {
	case err := <-served:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("expected drain deadline error, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("server exceeded its finite shutdown budget")
	}
	select {
	case <-requestDone:
	case <-time.After(time.Second):
		t.Fatal("timed-out shutdown did not close its HTTP connection")
	}
}
