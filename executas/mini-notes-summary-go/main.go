package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	protocolVersion = "2.0"
	toolID          = "bundled:mini-notes-summary"
	pluginName      = "mini-notes-summary"
	toolName        = "summarize"
	version         = "0.1.0"
)

type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc,omitempty"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

type rpcResponse struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      any       `json:"id"`
	Result  any       `json:"result,omitempty"`
	Error   *rpcError `json:"error,omitempty"`
}

type pendingCall struct {
	ch chan rpcMessage
}

type server struct {
	outMu   sync.Mutex
	pending sync.Map
	nextID  atomic.Int64
}

func main() {
	s := &server{}
	if err := s.run(os.Stdin); err != nil && !errors.Is(err, io.EOF) {
		fmt.Fprintf(os.Stderr, "mini-notes-summary fatal: %v\n", err)
	}
}

func (s *server) run(r io.Reader) error {
	scanner := bufio.NewScanner(r)
	buf := make([]byte, 0, 1024*1024)
	scanner.Buffer(buf, 10*1024*1024)
	var wg sync.WaitGroup
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var msg rpcMessage
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			fmt.Fprintf(os.Stderr, "invalid json-rpc line: %v\n", err)
			continue
		}
		if msg.Method == "" {
			s.resolvePending(msg)
			continue
		}
		wg.Add(1)
		go func(m rpcMessage) {
			defer wg.Done()
			s.handleRequest(m)
		}(msg)
	}
	wg.Wait()
	return scanner.Err()
}

func (s *server) resolvePending(msg rpcMessage) {
	key := string(msg.ID)
	if value, ok := s.pending.LoadAndDelete(key); ok {
		value.(*pendingCall).ch <- msg
		return
	}
	fmt.Fprintf(os.Stderr, "orphan json-rpc response id=%s\n", key)
}

func (s *server) handleRequest(msg rpcMessage) {
	switch msg.Method {
	case "initialize":
		s.writeResult(msg.ID, map[string]any{
			"protocolVersion":     protocolVersion,
			"client_capabilities": map[string]any{"sampling": map[string]any{}},
			"capabilities":        map[string]any{"sampling": map[string]any{}},
			"serverInfo": map[string]any{
				"name":    pluginName,
				"version": version,
			},
		})
	case "describe":
		s.writeResult(msg.ID, manifest())
	case "health":
		s.writeResult(msg.ID, map[string]any{"ok": true, "name": pluginName, "version": version})
	case "shutdown":
		s.writeResult(msg.ID, map[string]any{"ok": true})
	case "invoke":
		result, err := s.invoke(msg.Params)
		if err != nil {
			s.writeError(msg.ID, -32603, err.Error(), nil)
			return
		}
		s.writeResult(msg.ID, result)
	default:
		s.writeError(msg.ID, -32601, "method not found: "+msg.Method, nil)
	}
}

func manifest() map[string]any {
	return map[string]any{
		"name":              pluginName,
		"tool_id":           toolID,
		"display_name":      "Mini Notes Summary",
		"version":           version,
		"description":       "Summarizes Mini Notes by requesting host LLM sampling over reverse JSON-RPC.",
		"host_capabilities": []string{"llm.sample"},
		"runtime": map[string]any{
			"type":     "go",
			"protocol": "json-rpc-2.0-stdio",
		},
		"tools": []map[string]any{
			{
				"name":         toolName,
				"display_name": "Summarize Notes",
				"description":  "Summarize the current Mini Notes list using host LLM sampling.",
				"parameters": []map[string]any{
					{
						"name":        "notes",
						"type":        "array",
						"required":    true,
						"description": "Array of note objects with order and content fields.",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"order":   map[string]any{"type": "number"},
								"content": map[string]any{"type": "string"},
							},
						},
					},
				},
				"returns": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"summary": map[string]any{"type": "string"},
					},
				},
			},
		},
	}
}

func (s *server) invoke(raw json.RawMessage) (map[string]any, error) {
	var params map[string]any
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &params); err != nil {
			return nil, fmt.Errorf("invalid invoke params: %w", err)
		}
	}
	method := firstString(params, "method", "tool", "name")
	if method == "" && params != nil {
		if nested, ok := params["params"].(map[string]any); ok {
			method = firstString(nested, "method", "tool", "name")
		}
	}
	if method != "" && method != toolName {
		return nil, fmt.Errorf("unknown tool method %q", method)
	}
	args := extractArgs(params)
	notes, err := parseNotes(args["notes"])
	if err != nil {
		return nil, err
	}
	invokeID := firstString(params, "invoke_id", "invokeId", "id")
	if invokeID == "" {
		invokeID = fmt.Sprintf("local-%d", time.Now().UnixNano())
	}
	summary, model, err := s.requestSampling(notes, invokeID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"summary":   summary,
		"model":     model,
		"invoke_id": invokeID,
	}, nil
}

func firstString(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := m[key].(string); ok {
			return value
		}
	}
	return ""
}

func extractArgs(params map[string]any) map[string]any {
	for _, key := range []string{"args", "arguments", "input"} {
		if value, ok := params[key].(map[string]any); ok {
			return value
		}
	}
	return params
}

type note struct {
	Order   int    `json:"order"`
	Content string `json:"content"`
}

func parseNotes(value any) ([]note, error) {
	bytes, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("notes could not be encoded: %w", err)
	}
	var notes []note
	if err := json.Unmarshal(bytes, &notes); err != nil {
		return nil, fmt.Errorf("notes must be an array of objects: %w", err)
	}
	clean := make([]note, 0, len(notes))
	for _, n := range notes {
		content := strings.TrimSpace(n.Content)
		if content == "" {
			continue
		}
		clean = append(clean, note{Order: n.Order, Content: content})
	}
	if len(clean) == 0 {
		return nil, errors.New("there are no non-empty notes to summarize")
	}
	return clean, nil
}

func (s *server) requestSampling(notes []note, invokeID string) (string, string, error) {
	prompt := buildPrompt(notes)
	id := fmt.Sprintf("sampling-%d", s.nextID.Add(1))
	pending := &pendingCall{ch: make(chan rpcMessage, 1)}
	s.pending.Store(jsonStringID(id), pending)
	request := map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  "sampling/createMessage",
		"params": map[string]any{
			"systemPrompt": "You summarize short personal or work notes. Return a concise, useful summary with priorities and next actions when possible.",
			"messages": []map[string]any{
				{
					"role": "user",
					"content": map[string]any{
						"type": "text",
						"text": prompt,
					},
				},
			},
			"maxTokens": 300,
			"modelPreferences": map[string]any{
				"costPriority":         0.4,
				"speedPriority":        0.7,
				"intelligencePriority": 0.6,
			},
			"metadata": map[string]any{
				"invoke_id": invokeID,
				"tool_id":   toolID,
				"tool":      toolName,
			},
		},
	}
	if err := s.writeJSON(request); err != nil {
		s.pending.Delete(jsonStringID(id))
		return "", "", err
	}
	select {
	case response := <-pending.ch:
		if response.Error != nil {
			return "", "", fmt.Errorf("sampling/createMessage failed: [%d] %s", response.Error.Code, response.Error.Message)
		}
		return extractSamplingText(response.Result)
	case <-time.After(60 * time.Second):
		s.pending.Delete(jsonStringID(id))
		return "", "", errors.New("timed out waiting for sampling/createMessage response")
	}
}

func buildPrompt(notes []note) string {
	var b strings.Builder
	b.WriteString("Summarize these Mini Notes. Preserve important details, group related items, and mention concrete next actions.\n\nNotes:\n")
	for i, n := range notes {
		order := n.Order
		if order == 0 {
			order = i + 1
		}
		fmt.Fprintf(&b, "%d. %s\n", order, n.Content)
	}
	return b.String()
}

func extractSamplingText(raw json.RawMessage) (string, string, error) {
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", "", fmt.Errorf("invalid sampling result: %w", err)
	}
	model, _ := result["model"].(string)
	if content, ok := result["content"].(map[string]any); ok {
		if text, ok := content["text"].(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text), model, nil
		}
	}
	if text, ok := result["text"].(string); ok && strings.TrimSpace(text) != "" {
		return strings.TrimSpace(text), model, nil
	}
	return "", model, errors.New("sampling result did not contain content.text")
}

func jsonStringID(id string) string {
	bytes, _ := json.Marshal(id)
	return string(bytes)
}

func (s *server) writeResult(id json.RawMessage, result any) {
	s.writeJSON(rpcResponse{JSONRPC: "2.0", ID: decodeID(id), Result: result})
}

func (s *server) writeError(id json.RawMessage, code int, message string, data any) {
	s.writeJSON(rpcResponse{JSONRPC: "2.0", ID: decodeID(id), Error: &rpcError{Code: code, Message: message, Data: data}})
}

func decodeID(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return string(raw)
	}
	return value
}

func (s *server) writeJSON(value any) error {
	bytes, err := json.Marshal(value)
	if err != nil {
		return err
	}
	s.outMu.Lock()
	defer s.outMu.Unlock()
	_, err = os.Stdout.Write(append(bytes, '\n'))
	return err
}
