package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type visit struct {
	UserID          string    `json:"userId"`
	Target          string    `json:"target"`
	Port            int       `json:"port"`
	Transport       string    `json:"transport"`
	ConnectionCount int       `json:"connectionCount"`
	FirstSeenAt     time.Time `json:"firstSeenAt"`
	LastSeenAt      time.Time `json:"lastSeenAt"`
}

type batch struct {
	ExternalID   string    `json:"externalId"`
	ObservedAt   time.Time `json:"observedAt"`
	AgentVersion string    `json:"agentVersion"`
	Visits       []visit   `json:"visits"`
}

type persistedState struct {
	Offset  int64  `json:"offset"`
	Pending *batch `json:"pending,omitempty"`
}

type event struct {
	UserID    string
	Target    string
	Port      int
	Transport string
	At        time.Time
}

type hysteriaLog struct {
	Level   string `json:"level"`
	Time    string `json:"time"`
	TS      string `json:"ts"`
	Message string `json:"msg"`
	ID      string `json:"id"`
	ReqAddr string `json:"reqAddr"`
}

var xrayAccess = regexp.MustCompile(`(?i)accepted\s+(tcp|udp):([^\s]+).*?email:\s*([^\s]+)`)

const agentVersion = "1.0.0"

func main() {
	protocol := strings.ToLower(required("DESTINATION_AGENT_PROTOCOL"))
	if protocol != "hysteria2" && protocol != "vless_reality" {
		log.Fatal("DESTINATION_AGENT_PROTOCOL must be hysteria2 or vless_reality")
	}
	logFile := required("DESTINATION_AGENT_LOG_FILE")
	controlURL := strings.TrimRight(required("CONTROL_PLANE_URL"), "/")
	nodeID := required("CONTROL_PLANE_NODE_ID")
	secret := required("CONTROL_PLANE_NODE_SECRET")
	stateFile := envOr("DESTINATION_AGENT_STATE_FILE", "/var/lib/hysteria2-destination-agent/state.json")
	interval := durationOr("DESTINATION_AGENT_INTERVAL", 30*time.Second)

	state, err := loadState(stateFile)
	if err != nil {
		log.Fatalf("load state: %v", err)
	}
	client := &http.Client{Timeout: 15 * time.Second}
	endpoint := fmt.Sprintf("%s/integrations/nodes/%s/destination-batches", controlURL, nodeID)

	log.Printf("destination agent %s reading %s", agentVersion, logFile)
	for {
		if state.Pending != nil {
			if err := submit(client, endpoint, secret, state.Pending); err != nil {
				log.Printf("submit pending batch: %v", err)
				time.Sleep(interval)
				continue
			}
			state.Pending = nil
			if err := persistState(stateFile, state); err != nil {
				log.Fatalf("persist acknowledged state: %v", err)
			}
		}

		events, nextOffset, err := readEvents(logFile, protocol, state.Offset)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				log.Printf("read events: %v", err)
			}
			time.Sleep(interval)
			continue
		}
		state.Offset = nextOffset
		if len(events) == 0 {
			if err := persistState(stateFile, state); err != nil {
				log.Fatalf("persist cursor: %v", err)
			}
			time.Sleep(interval)
			continue
		}
		pending := aggregate(events)
		state.Pending = pending
		if err := persistState(stateFile, state); err != nil {
			log.Fatalf("persist pending batch: %v", err)
		}
	}
}

func readEvents(path, protocol string, offset int64) ([]event, int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, offset, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, offset, err
	}
	if info.Size() < offset {
		offset = 0
	}
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return nil, offset, err
	}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	events := make([]event, 0, 512)
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		var parsed event
		var ok bool
		if protocol == "hysteria2" {
			parsed, ok = parseHysteria(line)
		} else {
			parsed, ok = parseXray(string(line))
		}
		if ok {
			events = append(events, parsed)
		}
		if len(events) >= 5000 {
			break
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, offset, err
	}
	next, err := file.Seek(0, io.SeekCurrent)
	return events, next, err
}

func parseHysteria(line []byte) (event, bool) {
	var item hysteriaLog
	if json.Unmarshal(line, &item) != nil {
		return event{}, false
	}
	transport := ""
	switch item.Message {
	case "TCP request":
		transport = "tcp"
	case "UDP request":
		transport = "udp"
	default:
		return event{}, false
	}
	target, port, ok := splitTarget(item.ReqAddr)
	if !ok || strings.TrimSpace(item.ID) == "" {
		return event{}, false
	}
	at := parseTime(item.Time)
	if at.IsZero() {
		at = parseTime(item.TS)
	}
	if at.IsZero() {
		at = time.Now().UTC()
	}
	return event{UserID: item.ID, Target: target, Port: port, Transport: transport, At: at}, true
}

func parseXray(line string) (event, bool) {
	match := xrayAccess.FindStringSubmatch(line)
	if len(match) != 4 {
		return event{}, false
	}
	target, port, ok := splitTarget(match[2])
	if !ok {
		return event{}, false
	}
	at := time.Now().UTC()
	if len(line) >= 19 {
		if parsed, err := time.ParseInLocation("2006/01/02 15:04:05", line[:19], time.Local); err == nil {
			at = parsed.UTC()
		}
	}
	return event{UserID: match[3], Target: target, Port: port, Transport: strings.ToLower(match[1]), At: at}, true
}

func splitTarget(value string) (string, int, bool) {
	value = strings.TrimPrefix(value, "tcp:")
	value = strings.TrimPrefix(value, "udp:")
	host, portText, err := net.SplitHostPort(value)
	if err != nil {
		index := strings.LastIndex(value, ":")
		if index <= 0 {
			return "", 0, false
		}
		host, portText = value[:index], value[index+1:]
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return "", 0, false
	}
	host = strings.Trim(strings.TrimSpace(host), "[]")
	return host, port, host != ""
}

func aggregate(events []event) *batch {
	type key struct {
		UserID, Target, Transport, Minute string
		Port                              int
	}
	rollups := make(map[key]*visit)
	for _, item := range events {
		minute := item.At.UTC().Truncate(time.Minute)
		k := key{item.UserID, strings.ToLower(item.Target), item.Transport, minute.Format(time.RFC3339), item.Port}
		current := rollups[k]
		if current == nil {
			rollups[k] = &visit{UserID: item.UserID, Target: k.Target, Port: item.Port, Transport: item.Transport, ConnectionCount: 1, FirstSeenAt: item.At.UTC(), LastSeenAt: item.At.UTC()}
			continue
		}
		current.ConnectionCount++
		if item.At.Before(current.FirstSeenAt) {
			current.FirstSeenAt = item.At.UTC()
		}
		if item.At.After(current.LastSeenAt) {
			current.LastSeenAt = item.At.UTC()
		}
	}
	visits := make([]visit, 0, len(rollups))
	for _, item := range rollups {
		visits = append(visits, *item)
	}
	return &batch{ExternalID: randomID(), ObservedAt: time.Now().UTC(), AgentVersion: agentVersion, Visits: visits}
}

func submit(client *http.Client, endpoint, secret string, value *batch) error {
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", secret)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("control plane returned %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	return nil
}

func loadState(path string) (*persistedState, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return &persistedState{}, nil
	}
	if err != nil {
		return nil, err
	}
	var state persistedState
	if err := json.Unmarshal(raw, &state); err != nil {
		return nil, err
	}
	return &state, nil
}

func persistState(path string, state *persistedState) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

func parseTime(value string) time.Time {
	parsed, _ := time.Parse(time.RFC3339Nano, value)
	return parsed
}

func randomID() string {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		panic(err)
	}
	return hex.EncodeToString(value)
}

func required(key string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		log.Fatalf("%s is required", key)
	}
	return value
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func durationOr(key string, fallback time.Duration) time.Duration {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		if parsed, err := time.ParseDuration(value); err == nil {
			return parsed
		}
	}
	return fallback
}
