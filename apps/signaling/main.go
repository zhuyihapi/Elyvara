package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

type service struct {
	mu       sync.Mutex
	rooms    map[string]*room
	clients  map[*peer]struct{}
	upgrades int
	stopping bool
}

func newService() *service {
	return &service{rooms: make(map[string]*room), clients: make(map[*peer]struct{})}
}

func (s *service) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopping = true
	for p := range s.clients {
		p.stop()
	}
}

func (s *service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.RequestURI() == "/healthz" && r.Method == http.MethodGet {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"status":"ok","protocolVersion":1}`)
		return
	}
	if r.URL.RequestURI() != "/ws" {
		http.NotFound(w, r)
		return
	}
	if r.Header.Get("Origin") != "" {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	s.mu.Lock()
	if s.stopping || len(s.clients)+s.upgrades >= 32 {
		s.mu.Unlock()
		w.WriteHeader(http.StatusForbidden)
		return
	}
	s.upgrades++
	s.mu.Unlock()
	upgrader := websocket.Upgrader{HandshakeTimeout: 5 * time.Second}
	conn, err := upgrader.Upgrade(w, r, nil)
	s.mu.Lock()
	s.upgrades--
	if err != nil {
		s.mu.Unlock()
		return
	}
	if s.stopping {
		s.mu.Unlock()
		conn.Close()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	p := &peer{id: identifier(), output: make(chan []byte, 4), stop: func() { cancel(); conn.Close() }}
	s.clients[p] = struct{}{}
	p.send("session.ready", message{"peerId": p.id})
	s.mu.Unlock()
	defer func() {
		p.stop()
		s.mu.Lock()
		p.leave()
		delete(s.clients, p)
		s.mu.Unlock()
	}()
	go writeMessages(ctx, conn, p)
	conn.SetReadLimit(65536)
	conn.SetReadDeadline(time.Now().Add(32 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(32 * time.Second)) })
	window, count := time.Now(), 0
	for {
		kind, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if time.Since(window) >= time.Second {
			window, count = time.Now(), 0
		}
		count++
		if count > 40 {
			conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(1008, "Rate limit"), time.Now().Add(time.Second))
			return
		}
		request, valid := parse(data)
		s.mu.Lock()
		if kind != websocket.TextMessage || !valid {
			p.fail("INVALID_MESSAGE", "")
		} else {
			s.handle(p, request)
		}
		s.mu.Unlock()
	}
}

func writeMessages(ctx context.Context, conn *websocket.Conn, p *peer) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	defer p.stop()
	for {
		select {
		case <-ctx.Done():
			return
		case data := <-p.output:
			conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if conn.WriteMessage(websocket.TextMessage, data) != nil {
				return
			}
		case <-ticker.C:
			if conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
				return
			}
		}
	}
}

func run() error {
	host, port := os.Getenv("HOST"), os.Getenv("PORT")
	if host == "" {
		host = "127.0.0.1"
	}
	if port == "" {
		port = "8080"
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return errors.New("invalid PORT")
	}
	cert, key := os.Getenv("TLS_CERT"), os.Getenv("TLS_KEY")
	if (cert == "") != (key == "") {
		return errors.New("configure TLS_CERT and TLS_KEY together")
	}
	if cert == "" && host != "127.0.0.1" && host != "::1" {
		return errors.New("public listeners require TLS")
	}
	s := newService()
	server := &http.Server{Addr: net.JoinHostPort(host, port), Handler: s, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second, WriteTimeout: 10 * time.Second, MaxHeaderBytes: 8192, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				s.close()
				shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				server.Shutdown(shutdown)
				return
			case now := <-ticker.C:
				s.mu.Lock()
				s.sweep(now)
				s.mu.Unlock()
			}
		}
	}()
	if cert != "" {
		err = server.ListenAndServeTLS(cert, key)
	} else {
		err = server.ListenAndServe()
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func main() {
	if err := run(); err != nil {
		log.Print("signaling startup failed")
		os.Exit(1)
	}
}
