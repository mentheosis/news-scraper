package services

import (
	"regexp"
	"strconv"
	"strings"
)

var retryRe = regexp.MustCompile(`[Rr]etry in ([0-9]+)\.?`)
var fallbackRetryRe = regexp.MustCompile(`retryDelay:([0-9]+)s`)

// IsRateLimitError checks if the given error string contains Gemini quota violation markers
// and attempts to parse the recommended retry delay. If it cannot parse a delay, it defaults to 60s.
func IsRateLimitError(err error) (bool, int) {
	if err == nil {
		return false, 0
	}
	msg := err.Error()

	if strings.Contains(msg, "429") || strings.Contains(msg, "RESOURCE_EXHAUSTED") || strings.Contains(msg, "Quota exceeded") {
		matches := retryRe.FindStringSubmatch(msg)
		if len(matches) > 1 {
			if sec, err := strconv.Atoi(matches[1]); err == nil {
				return true, sec
			}
		}

		matches = fallbackRetryRe.FindStringSubmatch(msg)
		if len(matches) > 1 {
			if sec, err := strconv.Atoi(matches[1]); err == nil {
				return true, sec
			}
		}

		return true, 60 // Default fallback if we can't parse a number
	}

	return false, 0
}
