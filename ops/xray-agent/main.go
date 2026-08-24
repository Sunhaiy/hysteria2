package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	statscommand "github.com/xtls/xray-core/app/stats/command"
	proxymancommand "github.com/xtls/xray-core/app/proxyman/command"
	"github.com/xtls/xray-core/common/protocol"
	"github.com/xtls/xray-core/common/serial"
	"github.com/xtls/xray-core/proxy/vless"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
)

const maxBodyBytes = 2 << 20

type provisionedUser struct {
	UserID string `json:"userId"`
	ID     string `json:"id"`
	Email  string `json:"email"`
	Flow   string `json:"flow"`
}

type agent struct {
	secret     string
	inboundTag string
	stats      statscommand.StatsServiceClient
	handler    proxymancommand.HandlerServiceClient
	stateFile  string
	mu         sync.Mutex
	pending    *trafficBatch
}

type trafficBatch struct {
	ID        string                      `json:"id"`
	ClaimedAt time.Time                   `json:"claimedAt"`
	Traffic   map[string]map[string]int64 `json:"traffic"`
}

type acknowledgeRequest struct {
	ID string `json:"id"`
}

func main() {
	secret := strings.TrimSpace(os.Getenv("XRAY_AGENT_SECRET"))
	if secret == "" {
		log.Fatal("XRAY_AGENT_SECRET is required")
	}

	listen := envOr("XRAY_AGENT_LISTEN", "127.0.0.1:9010")
	xrayAPI := envOr("XRAY_API_ADDRESS", "127.0.0.1:10085")
	inboundTag := envOr("XRAY_INBOUND_TAG", "vless-reality")
	stateFile := envOr(
		"XRAY_AGENT_STATE_FILE",
		"/var/lib/hysteria2-xray-agent/traffic-batch.json",
	)

	conn, err := grpc.NewClient(
		xrayAPI,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		log.Fatalf("connect to Xray API: %v", err)
	}
	defer conn.Close()

	a := &agent{
		secret:     secret,
		inboundTag: inboundTag,
		stats:      statscommand.NewStatsServiceClient(conn),
		handler:    proxymancommand.NewHandlerServiceClient(conn),
		stateFile:  stateFile,
	}
	if err := a.loadPendingBatch(); err != nil {
		log.Fatalf("load traffic batch state: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", a.authorize(a.health))
	mux.HandleFunc("GET /traffic", a.authorize(a.traffic))
	mux.HandleFunc("POST /traffic/claim", a.authorize(a.claimTraffic))
	mux.HandleFunc("POST /traffic/ack", a.authorize(a.acknowledgeTraffic))
	mux.HandleFunc("GET /online", a.authorize(a.online))
	mux.HandleFunc("PUT /users", a.authorize(a.syncUsers))
	mux.HandleFunc("POST /kick", a.authorize(a.kickUsers))

	server := &http.Server{
		Addr:              listen,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("Xray control agent listening on %s for inbound %q", listen, inboundTag)
	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func (a *agent) authorize(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		provided := r.Header.Get("Authorization")
		if len(provided) != len(a.secret) ||
			subtle.ConstantTimeCompare([]byte(provided), []byte(a.secret)) != 1 {
			writeError(w, http.StatusUnauthorized, "invalid agent secret")
			return
		}
		next(w, r)
	}
}

func (a *agent) health(w http.ResponseWriter, _ *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, err := a.stats.GetSysStats(ctx, &statscommand.SysStatsRequest{})
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"uptime":     result.Uptime,
		"goroutines": result.NumGoroutine,
	})
}

func (a *agent) traffic(w http.ResponseWriter, r *http.Request) {
	clear, _ := strconv.ParseBool(r.URL.Query().Get("clear"))
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	traffic, err := a.collectTraffic(ctx, clear)
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, traffic)
}

func (a *agent) claimTraffic(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.pending != nil {
		writeJSON(w, http.StatusOK, a.pending)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	traffic, err := a.collectTraffic(ctx, true)
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	batch := &trafficBatch{
		ID:        randomID(),
		ClaimedAt: time.Now().UTC(),
		Traffic:   traffic,
	}
	if err := a.persistPendingBatch(batch); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.pending = batch
	writeJSON(w, http.StatusOK, batch)
}

func (a *agent) acknowledgeTraffic(w http.ResponseWriter, r *http.Request) {
	var input acknowledgeRequest
	if err := decodeJSON(w, r, &input); err != nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.pending == nil || input.ID != a.pending.ID {
		writeError(w, http.StatusConflict, "traffic batch is not pending")
		return
	}
	if err := os.Remove(a.stateFile); err != nil && !os.IsNotExist(err) {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.pending = nil
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *agent) collectTraffic(
	ctx context.Context,
	reset bool,
) (map[string]map[string]int64, error) {

	result, err := a.stats.QueryStats(ctx, &statscommand.QueryStatsRequest{
		Pattern: "user>>>",
		Reset_:  reset,
	})
	if err != nil {
		return nil, err
	}

	traffic := make(map[string]map[string]int64)
	for _, stat := range result.Stat {
		parts := strings.Split(stat.Name, ">>>")
		if len(parts) != 4 || parts[0] != "user" || parts[2] != "traffic" {
			continue
		}
		direction := parts[3]
		if direction != "uplink" && direction != "downlink" {
			continue
		}
		entry := traffic[parts[1]]
		if entry == nil {
			entry = map[string]int64{"tx": 0, "rx": 0}
			traffic[parts[1]] = entry
		}
		if direction == "uplink" {
			entry["tx"] = stat.Value
		} else {
			entry["rx"] = stat.Value
		}
	}

	return traffic, nil
}

func (a *agent) loadPendingBatch() error {
	raw, err := os.ReadFile(a.stateFile)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var batch trafficBatch
	if err := json.Unmarshal(raw, &batch); err != nil {
		return err
	}
	if batch.ID == "" || batch.Traffic == nil {
		return errors.New("invalid persisted traffic batch")
	}
	a.pending = &batch
	return nil
}

func (a *agent) persistPendingBatch(batch *trafficBatch) error {
	if err := os.MkdirAll(filepath.Dir(a.stateFile), 0o700); err != nil {
		return err
	}
	raw, err := json.Marshal(batch)
	if err != nil {
		return err
	}
	temporary := a.stateFile + ".tmp"
	if err := os.WriteFile(temporary, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, a.stateFile)
}

func randomID() string {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		panic(err)
	}
	return hex.EncodeToString(value)
}

func (a *agent) online(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	result, err := a.stats.GetAllOnlineUsers(
		ctx,
		&statscommand.GetAllOnlineUsersRequest{},
	)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	online := make(map[string]int64, len(result.Users))
	for _, name := range result.Users {
		parts := strings.Split(name, ">>>")
		if len(parts) != 3 || parts[0] != "user" || parts[2] != "online" {
			continue
		}
		count, err := a.stats.GetStatsOnline(ctx, &statscommand.GetStatsRequest{Name: name})
		if err != nil || count.Stat == nil {
			continue
		}
		online[parts[1]] = count.Stat.Value
	}

	writeJSON(w, http.StatusOK, online)
}

func (a *agent) syncUsers(w http.ResponseWriter, r *http.Request) {
	var desired []provisionedUser
	if err := decodeJSON(w, r, &desired); err != nil {
		return
	}

	desiredByEmail := make(map[string]provisionedUser, len(desired))
	for _, user := range desired {
		user.Email = strings.TrimSpace(user.Email)
		user.ID = strings.TrimSpace(user.ID)
		if user.Email == "" || user.ID == "" {
			writeError(w, http.StatusBadRequest, "each user requires email and id")
			return
		}
		if user.Flow == "" {
			user.Flow = "xtls-rprx-vision"
		}
		desiredByEmail[user.Email] = user
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	existingResult, err := a.handler.GetInboundUsers(
		ctx,
		&proxymancommand.GetInboundUserRequest{Tag: a.inboundTag},
	)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	existing := make(map[string]struct{}, len(existingResult.Users))
	for _, user := range existingResult.Users {
		existing[user.Email] = struct{}{}
	}

	added := 0
	removed := 0
	for email := range existing {
		if _, keep := desiredByEmail[email]; keep {
			continue
		}
		if err := a.removeUser(ctx, email); err != nil {
			writeGRPCError(w, err)
			return
		}
		removed++
	}
	for email, user := range desiredByEmail {
		if _, present := existing[email]; present {
			continue
		}
		if err := a.addUser(ctx, user); err != nil {
			writeGRPCError(w, err)
			return
		}
		added++
	}

	writeJSON(w, http.StatusOK, map[string]int{
		"added":   added,
		"removed": removed,
		"total":   len(desiredByEmail),
	})
}

func (a *agent) kickUsers(w http.ResponseWriter, r *http.Request) {
	var emails []string
	if err := decodeJSON(w, r, &emails); err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	kicked := 0
	for _, email := range emails {
		email = strings.TrimSpace(email)
		if email == "" {
			continue
		}
		if err := a.removeUser(ctx, email); err != nil {
			if status.Code(err) == codes.NotFound {
				continue
			}
			writeGRPCError(w, err)
			return
		}
		kicked++
	}

	writeJSON(w, http.StatusOK, map[string]int{"kicked": kicked})
}

func (a *agent) addUser(ctx context.Context, user provisionedUser) error {
	_, err := a.handler.AlterInbound(ctx, &proxymancommand.AlterInboundRequest{
		Tag: a.inboundTag,
		Operation: serial.ToTypedMessage(&proxymancommand.AddUserOperation{
			User: &protocol.User{
				Level: 0,
				Email: user.Email,
				Account: serial.ToTypedMessage(&vless.Account{
					Id:         user.ID,
					Flow:       user.Flow,
					Encryption: "none",
				}),
			},
		}),
	})
	return err
}

func (a *agent) removeUser(ctx context.Context, email string) error {
	_, err := a.handler.AlterInbound(ctx, &proxymancommand.AlterInboundRequest{
		Tag:       a.inboundTag,
		Operation: serial.ToTypedMessage(&proxymancommand.RemoveUserOperation{Email: email}),
	})
	return err
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON: %v", err))
		return err
	}
	return nil
}

func writeGRPCError(w http.ResponseWriter, err error) {
	code := http.StatusBadGateway
	if status.Code(err) == codes.NotFound {
		code = http.StatusNotFound
	}
	writeError(w, code, err.Error())
}

func writeError(w http.ResponseWriter, code int, message string) {
	writeJSON(w, code, map[string]any{"statusCode": code, "message": message})
}

func writeJSON(w http.ResponseWriter, code int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("encode response: %v", err)
	}
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
