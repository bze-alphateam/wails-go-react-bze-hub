package logging

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/config"
)

// Level represents log verbosity.
type Level int

const (
	LevelError Level = iota
	LevelInfo
	LevelDebug
)

const maxLogSize = 10 * 1024 * 1024 // 10 MB
const maxRotated = 3

// Logger is the unified application logger.
// All components log to a single file with tags.
type Logger struct {
	mu       sync.Mutex
	file     *os.File
	level    Level
	filePath string
}

var (
	global     *Logger
	globalOnce sync.Once
)

// Init initializes the global logger. Call once at startup.
func Init(level string) {
	globalOnce.Do(func() {
		logPath := filepath.Join(config.LogsDir(), "app.log")
		f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
		if err != nil {
			fmt.Printf("WARNING: failed to open log file %s: %v\n", logPath, err)
			return
		}
		global = &Logger{
			file:     f,
			level:    parseLevel(level),
			filePath: logPath,
		}
	})
}

// SetLevel changes the log level at runtime.
func SetLevel(level string) {
	if global == nil {
		return
	}
	global.mu.Lock()
	defer global.mu.Unlock()
	global.level = parseLevel(level)
}

// Close flushes and closes the log file.
func Close() {
	if global == nil {
		return
	}
	global.mu.Lock()
	defer global.mu.Unlock()
	if global.file != nil {
		global.file.Close()
		global.file = nil
	}
}

// Error logs at error level.
func Error(tag, msg string, args ...interface{}) {
	log(LevelError, tag, msg, args...)
}

// Info logs at info level.
func Info(tag, msg string, args ...interface{}) {
	log(LevelInfo, tag, msg, args...)
}

// Debug logs at debug level.
func Debug(tag, msg string, args ...interface{}) {
	log(LevelDebug, tag, msg, args...)
}

// NodeWriter returns an io.Writer that logs each line with the [node] tag.
// Used to capture bzed stdout/stderr.
func NodeWriter(isStderr bool) io.Writer {
	level := LevelInfo
	if isStderr {
		level = LevelError
	}
	return &taggedWriter{tag: "node", level: level}
}

// --- Internal ---

func log(level Level, tag, msg string, args ...interface{}) {
	if global == nil {
		// Fallback to stdout if logger not initialized
		prefix := levelStr(level)
		formatted := fmt.Sprintf(msg, args...)
		fmt.Printf("%s [%s] %s\n", prefix, tag, formatted)
		return
	}

	global.mu.Lock()
	defer global.mu.Unlock()

	if level > global.level {
		return
	}

	if global.file == nil {
		return
	}

	// Rotate if needed
	global.rotateIfNeeded()

	ts := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	prefix := levelStr(level)
	formatted := fmt.Sprintf(msg, args...)
	line := fmt.Sprintf("%s [%s] [%s] %s\n", ts, prefix, tag, formatted)

	global.file.WriteString(line)

	// Also print to stdout for development
	fmt.Print(line)
}

func (l *Logger) rotateIfNeeded() {
	info, err := l.file.Stat()
	if err != nil || info.Size() < int64(maxLogSize) {
		return
	}

	l.file.Close()

	// Rotate: app.log.3 -> delete, app.log.2 -> .3, app.log.1 -> .2, app.log -> .1
	for i := maxRotated; i >= 1; i-- {
		old := fmt.Sprintf("%s.%d", l.filePath, i)
		newer := fmt.Sprintf("%s.%d", l.filePath, i-1)
		if i == 1 {
			newer = l.filePath
		}
		if i == maxRotated {
			os.Remove(old)
		}
		os.Rename(newer, old)
	}

	l.file, _ = os.OpenFile(l.filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
}

func parseLevel(s string) Level {
	switch s {
	case "debug":
		return LevelDebug
	case "info":
		return LevelInfo
	default:
		return LevelError
	}
}

func levelStr(l Level) string {
	switch l {
	case LevelDebug:
		return "DEBUG"
	case LevelInfo:
		return "INFO"
	default:
		return "ERROR"
	}
}

// taggedWriter implements io.Writer and logs each line with a tag.
type taggedWriter struct {
	tag   string
	level Level
	buf   []byte
}

func (tw *taggedWriter) Write(p []byte) (n int, err error) {
	tw.buf = append(tw.buf, p...)
	for {
		idx := -1
		for i, b := range tw.buf {
			if b == '\n' {
				idx = i
				break
			}
		}
		if idx == -1 {
			break
		}
		line := string(tw.buf[:idx])
		tw.buf = tw.buf[idx+1:]
		if len(line) > 0 {
			log(tw.level, tw.tag, "%s", line)
		}
	}
	return len(p), nil
}
