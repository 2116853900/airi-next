package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/guohuiyuan/go-music-dl/core"
)

// main starts the authenticated loopback server used by the Electron process.
//
// Call stack:
//
// main
//
//	-> newMusicServer
//	  -> musicResolver.resolve
//	    -> go-music-dl/core search and download functions
func main() {
	port := flag.Int("port", 0, "loopback HTTP port")
	token := flag.String("token", "", "shared bearer token")
	flag.Parse()

	if *port < 1 || *port > 65535 {
		log.Fatal("port must be between 1 and 65535")
	}
	if strings.TrimSpace(*token) == "" {
		log.Fatal("token is required")
	}

	core.CM.Load()
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		log.Fatalf("listen on loopback: %v", err)
	}

	server := &http.Server{
		Handler:           newMusicServer(*token, *port).routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("song request sidecar ready on %s", listener.Addr())
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		log.Fatalf("serve: %v", err)
	}
}
