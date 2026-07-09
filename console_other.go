//go:build !windows

package main

// attachParentConsole is a no-op outside Windows; stdio is already attached.
func attachParentConsole() {}
