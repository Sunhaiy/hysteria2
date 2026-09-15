//go:build linux

package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const maxArtifact = 64 << 20

var invalidArtifact = errors.New("安装包校验失败")

type config struct {
	APIBaseURL   string `json:"apiBaseUrl"`
	Token        string `json:"token"`
	PublicKey    string `json:"publicKey"`
	Architecture string `json:"architecture"`
	ServiceUnit  string `json:"serviceUnit"`
	AgentPath    string `json:"agentPath"`
	StateDir     string `json:"stateDir"`
}
type manifest struct {
	Format       int    `json:"format"`
	ID           string `json:"id"`
	Version      string `json:"version"`
	Architecture string `json:"architecture"`
	SHA256       string `json:"sha256"`
	Size         int64  `json:"size"`
	Component    string `json:"component"`
}
type job struct {
	ID           string `json:"id"`
	Manifest     string `json:"manifest"`
	Signature    string `json:"signature"`
	DownloadPath string `json:"downloadPath"`
}
type journal struct {
	Job        job      `json:"job"`
	Manifest   manifest `json:"manifest"`
	OldPath    string   `json:"oldPath"`
	OldVersion string   `json:"oldVersion"`
	OldSHA256  string   `json:"oldSha256"`
	Phase      string   `json:"phase"`
	Message    string   `json:"message"`
}
type updater struct {
	config  config
	client  *http.Client
	restart func() error
	healthy func(string) error
}

func atomicJSON(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(path+".tmp", path); err != nil {
		return err
	}
	d, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
func fileHash(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func verifyManifest(j job, publicKey, architecture string) (manifest, error) {
	var m manifest
	block, _ := pem.Decode([]byte(publicKey))
	if block == nil {
		return m, errors.New("签名公钥无效")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return m, errors.New("签名公钥无效")
	}
	key, ok := parsed.(ed25519.PublicKey)
	if !ok {
		return m, errors.New("必须使用 Ed25519 公钥")
	}
	signature, err := base64.StdEncoding.DecodeString(j.Signature)
	if err != nil || !ed25519.Verify(key, []byte(j.Manifest), signature) {
		return m, errors.New("安装包签名验证失败")
	}
	if err = json.Unmarshal([]byte(j.Manifest), &m); err != nil {
		return m, errors.New("安装包清单无效")
	}
	if m.Format != 1 || m.Component != "xray-agent" || m.Architecture != architecture || m.Size < 64 || m.Size > maxArtifact || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(m.SHA256) || !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$`).MatchString(m.Version) {
		return m, errors.New("安装包架构或格式不匹配")
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`).MatchString(j.ID) || j.DownloadPath != "/api/agent-updater/jobs/"+j.ID+"/artifact" {
		return m, errors.New("下载地址不属于本任务")
	}
	return m, nil
}
func (u *updater) request(method, path string, body any) (*http.Response, error) {
	var data []byte
	var err error
	if body != nil {
		data, err = json.Marshal(body)
		if err != nil {
			return nil, err
		}
	}
	req, err := http.NewRequest(method, strings.TrimRight(u.config.APIBaseURL, "/")+path, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+u.config.Token)
	req.Header.Set("Content-Type", "application/json")
	response, err := u.client.Do(req)
	if err != nil {
		return nil, errors.New("暂时无法连接主站，保留任务等待重试")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		response.Body.Close()
		return nil, fmt.Errorf("主站暂未接受请求（HTTP %d）", response.StatusCode)
	}
	return response, nil
}
func (u *updater) current() (string, string, error) {
	sum, err := fileHash(u.config.AgentPath)
	if err != nil {
		return "", "", err
	}
	version := "legacy"
	var saved struct {
		Version string `json:"version"`
		SHA256  string `json:"sha256"`
	}
	if data, readErr := os.ReadFile(filepath.Join(u.config.StateDir, "current.json")); readErr == nil && json.Unmarshal(data, &saved) == nil && saved.SHA256 == sum {
		version = saved.Version
	}
	return version, sum, nil
}
func (u *updater) save(j *journal) error {
	return atomicJSON(filepath.Join(u.config.StateDir, "job.json"), j)
}
func (u *updater) report(j *journal, status string) error {
	version, sum, err := u.current()
	if err != nil {
		return err
	}
	response, err := u.request("POST", "/api/agent-updater/jobs/"+j.Job.ID+"/report", map[string]string{"status": status, "message": j.Message, "currentVersion": version, "currentSha256": sum})
	if err != nil {
		return err
	}
	response.Body.Close()
	return nil
}
func (u *updater) advance(j *journal, next string) error {
	if err := u.report(j, next); err != nil {
		return err
	}
	j.Phase = next
	return u.save(j)
}
func (u *updater) download(j *journal) error {
	dest := filepath.Join(u.config.StateDir, "releases", j.Manifest.SHA256)
	if sum, err := fileHash(dest); err == nil && sum == j.Manifest.SHA256 {
		return nil
	}
	response, err := u.request("GET", j.Job.DownloadPath, nil)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	f, err := os.OpenFile(dest+".partial", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0700)
	if err != nil {
		return err
	}
	h := sha256.New()
	size, copyErr := io.Copy(io.MultiWriter(f, h), io.LimitReader(response.Body, j.Manifest.Size+1))
	if copyErr == nil {
		copyErr = f.Sync()
	}
	f.Close()
	if copyErr != nil {
		return errors.New("下载中断，稍后重新下载")
	}
	if size != j.Manifest.Size || hex.EncodeToString(h.Sum(nil)) != j.Manifest.SHA256 {
		os.Remove(dest + ".partial")
		return invalidArtifact
	}
	if err = os.Rename(dest+".partial", dest); err != nil {
		return err
	}
	d, err := os.Open(filepath.Dir(dest))
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
func switchLink(path, target string) error {
	if info, err := os.Lstat(path); err != nil || info.Mode()&os.ModeSymlink == 0 {
		return errors.New("Agent 入口必须是安装器创建的符号链接")
	}
	os.Remove(path + ".next")
	if err := os.Symlink(target, path+".next"); err != nil {
		return err
	}
	if err := os.Rename(path+".next", path); err != nil {
		return err
	}
	d, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
func (u *updater) rollback(j *journal) (result error) {
	defer func() {
		if result != nil {
			j.Message = "回滚尚未完成：旧版启动或健康检查失败，保留任务继续恢复。"
			_ = u.save(j)
			// Reporting is best-effort only after local recovery has been attempted.
			_ = u.report(j, "ROLLING_BACK")
		}
	}()
	// Persist the intent before touching the link, so a power failure resumes rollback.
	j.Phase = "ROLLING_BACK"
	if err := u.save(j); err != nil {
		return err
	}
	if sum, err := fileHash(j.OldPath); err != nil || sum != j.OldSHA256 {
		return errors.New("旧版安装包校验失败，停止替换并保留恢复任务")
	}
	if err := switchLink(u.config.AgentPath, j.OldPath); err != nil {
		return err
	}
	if err := u.restart(); err != nil {
		return err
	}
	if err := u.healthy(j.OldSHA256); err != nil {
		return errors.New("旧版恢复后健康检查未通过；保留任务继续恢复")
	}
	if err := atomicJSON(filepath.Join(u.config.StateDir, "current.json"), map[string]string{"version": j.OldVersion, "sha256": j.OldSHA256}); err != nil {
		return err
	}
	j.Phase = "ROLLED_BACK"
	return u.save(j)
}
func (u *updater) execute(j *journal) error {
	// Local journal is authoritative after replacement. A network error must never
	// leave an unhealthy candidate running while we wait to report progress.
	if j.Phase == "DOWNLOADING" {
		if err := u.download(j); err != nil {
			if !errors.Is(err, invalidArtifact) {
				return err
			}
			j.Phase = "FAILED"
			j.Message = "安装包大小或校验和不一致，未替换 Agent。"
			if err = u.save(j); err != nil {
				return err
			}
		} else if err := u.advance(j, "VERIFYING"); err != nil {
			return err
		}
	}
	if j.Phase == "VERIFYING" {
		sum, err := fileHash(filepath.Join(u.config.StateDir, "releases", j.Manifest.SHA256))
		if err != nil || sum != j.Manifest.SHA256 {
			j.Phase = "FAILED"
			j.Message = "落盘安装包校验失败，未替换 Agent。"
			if err = u.save(j); err != nil {
				return err
			}
		} else if err = u.advance(j, "INSTALLING"); err != nil {
			return err
		}
	}
	if j.Phase == "INSTALLING" {
		candidate := filepath.Join(u.config.StateDir, "releases", j.Manifest.SHA256)
		candidateHash, hashErr := fileHash(candidate)
		if hashErr != nil || candidateHash != j.Manifest.SHA256 {
			j.Message = "安装前再次校验失败，恢复旧版。"
			if err := u.rollback(j); err != nil {
				return err
			}
			return u.execute(j)
		}
		// Replaying this step after a crash is safe; no core service is restarted.
		var err error
		linked, _ := filepath.EvalSymlinks(u.config.AgentPath)
		if linked != candidate || u.healthy(j.Manifest.SHA256) != nil {
			err = switchLink(u.config.AgentPath, candidate)
			if err == nil {
				err = u.restart()
			}
			if err == nil {
				err = u.healthy(j.Manifest.SHA256)
			}
		}
		if err != nil {
			j.Message = "新版 Agent 未通过启动或健康检查，已尝试恢复旧版。"
			if err = u.rollback(j); err != nil {
				return err
			}
		} else {
			if err = atomicJSON(filepath.Join(u.config.StateDir, "current.json"), map[string]string{"version": j.Manifest.Version, "sha256": j.Manifest.SHA256}); err != nil {
				return err
			}
			j.Phase = "LOCAL_HEALTHY"
			if err = u.save(j); err != nil {
				return err
			}
		}
	}
	if j.Phase == "ROLLING_BACK" {
		if err := u.rollback(j); err != nil {
			return err
		}
	}
	if j.Phase == "LOCAL_HEALTHY" {
		if err := u.healthy(j.Manifest.SHA256); err != nil {
			j.Message = "恢复执行时新版健康检查失败，恢复旧版。"
			if err = u.rollback(j); err != nil {
				return err
			}
		} else if err = u.advance(j, "CHECKING"); err != nil {
			return err
		}
	}
	if j.Phase == "CHECKING" {
		if err := u.healthy(j.Manifest.SHA256); err != nil {
			j.Message = "最终健康检查失败，恢复旧版。"
			if err = u.rollback(j); err != nil {
				return err
			}
		} else {
			j.Phase = "SUCCEEDED"
			j.Message = "运行文件校验和与健康检查通过，代理核心未重启。"
			if err = u.save(j); err != nil {
				return err
			}
		}
	}
	if j.Phase == "SUCCEEDED" || j.Phase == "ROLLED_BACK" || j.Phase == "FAILED" {
		if err := u.report(j, j.Phase); err != nil {
			return err
		}
		// Keep a receipt before clearing the active journal. Re-report after a crash
		// is accepted idempotently by the controller.
		if err := atomicJSON(filepath.Join(u.config.StateDir, "receipts", j.Job.ID+".json"), j); err != nil {
			return err
		}
		return os.Remove(filepath.Join(u.config.StateDir, "job.json"))
	}
	return nil
}
func (u *updater) tick() error {
	var saved journal
	data, err := os.ReadFile(filepath.Join(u.config.StateDir, "job.json"))
	if err == nil {
		if json.Unmarshal(data, &saved) != nil {
			return errors.New("本地更新日志损坏，停止更新等待人工检查")
		}
		verified, verifyErr := verifyManifest(saved.Job, u.config.PublicKey, u.config.Architecture)
		if verifyErr != nil {
			return verifyErr
		}
		if verified != saved.Manifest {
			return errors.New("本地日志与签名清单不一致，停止更新")
		}
		if saved.OldPath == "" || !filepath.IsAbs(saved.OldPath) {
			return errors.New("本地回滚路径无效")
		}
		if !regexp.MustCompile(`^(DOWNLOADING|VERIFYING|INSTALLING|LOCAL_HEALTHY|CHECKING|ROLLING_BACK|ROLLED_BACK|SUCCEEDED|FAILED)$`).MatchString(saved.Phase) {
			return errors.New("本地更新阶段无效")
		}
		return u.execute(&saved)
	}
	if !os.IsNotExist(err) {
		return err
	}
	version, sum, err := u.current()
	if err != nil {
		return err
	}
	response, err := u.request("POST", "/api/agent-updater/poll", map[string]string{"architecture": u.config.Architecture, "currentVersion": version, "currentSha256": sum})
	if err != nil {
		return err
	}
	var envelope struct {
		Job *job `json:"job"`
	}
	err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&envelope)
	response.Body.Close()
	if err != nil {
		return errors.New("主站任务响应无效")
	}
	if envelope.Job == nil {
		return nil
	}
	m, err := verifyManifest(*envelope.Job, u.config.PublicKey, u.config.Architecture)
	if err != nil {
		if regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`).MatchString(envelope.Job.ID) {
			j := journal{Job: *envelope.Job, Message: err.Error()}
			return u.report(&j, "FAILED")
		}
		return err
	}
	old, err := filepath.EvalSymlinks(u.config.AgentPath)
	if err != nil {
		return err
	}
	saved = journal{Job: *envelope.Job, Manifest: m, OldPath: old, OldVersion: version, OldSHA256: sum, Phase: "DOWNLOADING"}
	if err = u.save(&saved); err != nil {
		return err
	}
	return u.execute(&saved)
}
func serviceCommand(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "systemctl", args...).Output()
	return strings.TrimSpace(string(out)), err
}
func realHealth(unit, expected string) error {
	for attempt := 0; attempt < 15; attempt++ {
		pid, err := serviceCommand("show", unit, "-p", "MainPID", "--value")
		numericPID, parseErr := strconv.Atoi(pid)
		if err == nil && parseErr == nil && numericPID > 0 {
			sum, hashErr := fileHash("/proc/" + pid + "/exe")
			if hashErr == nil && sum == expected {
				raw, envErr := os.ReadFile("/proc/" + pid + "/environ")
				if envErr == nil {
					env := map[string]string{}
					for _, entry := range strings.Split(string(raw), "\x00") {
						pair := strings.SplitN(entry, "=", 2)
						if len(pair) == 2 {
							env[pair[0]] = pair[1]
						}
					}
					addr := env["XRAY_AGENT_LISTEN"]
					if addr == "" {
						addr = "127.0.0.1:9010"
					}
					host, port, addrErr := net.SplitHostPort(addr)
					if addrErr != nil {
						return errors.New("Agent 健康检查监听地址无效")
					}
					if host == "" || host == "0.0.0.0" || host == "::" {
						host = "127.0.0.1"
					}
					addr = net.JoinHostPort(host, port)
					req, requestErr := http.NewRequest("GET", "http://"+addr+"/health", nil)
					if requestErr != nil || env["XRAY_AGENT_SECRET"] == "" {
						return errors.New("Agent 健康检查配置无效")
					}
					req.Header.Set("Authorization", env["XRAY_AGENT_SECRET"])
					client := &http.Client{Timeout: 6 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
					response, e := client.Do(req)
					if e == nil {
						var health struct {
							OK bool `json:"ok"`
						}
						e = json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&health)
						response.Body.Close()
						if e == nil && response.StatusCode == 200 && health.OK {
							return nil
						}
					}
				}
			}
		}
		time.Sleep(time.Second)
	}
	return errors.New("Agent 运行文件或健康检查不符合预期")
}
func main() {
	if len(os.Args) != 2 {
		log.Fatal("usage: agent-updater /etc/suxin-agent-updater/config.json")
	}
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		log.Fatal("无法读取更新器配置")
	}
	var cfg config
	if json.Unmarshal(data, &cfg) != nil {
		log.Fatal("更新器配置无效")
	}
	parsed, err := url.Parse(cfg.APIBaseURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" && parsed.Path != "/" {
		log.Fatal("主站必须为 HTTPS 根地址")
	}
	if cfg.Architecture != runtime.GOARCH || !regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`).MatchString(cfg.Token) || !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9@_.-]{0,100}\.service$`).MatchString(cfg.ServiceUnit) || !strings.Contains(cfg.ServiceUnit, "agent") {
		log.Fatal("架构、身份凭据或 Agent 服务名无效")
	}
	if !filepath.IsAbs(cfg.StateDir) || !filepath.IsAbs(cfg.AgentPath) || cfg.StateDir == "/" || cfg.AgentPath == "/" {
		log.Fatal("更新目录必须为专用绝对路径")
	}
	if _, err = os.Lstat(cfg.AgentPath); err != nil {
		log.Fatal("请先运行一次安装脚本")
	}
	for _, dir := range []string{cfg.StateDir, filepath.Join(cfg.StateDir, "releases"), filepath.Join(cfg.StateDir, "receipts")} {
		if err = os.MkdirAll(dir, 0700); err != nil {
			log.Fatal("无法创建更新目录")
		}
	}
	lock, err := os.OpenFile(filepath.Join(cfg.StateDir, "lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		log.Fatal("无法创建执行锁")
	}
	defer lock.Close()
	if syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		log.Fatal("已有更新器正在运行")
	}
	u := &updater{config: cfg, client: &http.Client{Timeout: 120 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	u.restart = func() error {
		_, err := serviceCommand("restart", cfg.ServiceUnit)
		if err != nil {
			return errors.New("Agent 重启失败")
		}
		return nil
	}
	u.healthy = func(sum string) error { return realHealth(cfg.ServiceUnit, sum) }
	for {
		if err = u.tick(); err != nil {
			log.Print(err)
		}
		time.Sleep(15 * time.Second)
	}
}
