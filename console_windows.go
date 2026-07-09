//go:build windows

package main

import (
	"os"
	"syscall"
)

// attachParentConsole reattaches stdout/stderr to the parent terminal when the
// binary is built with -H windowsgui (the GUI subsystem detaches the console,
// which would make `codemind serve` silent in a terminal). Best effort: if
// there is no parent console (e.g. launched by a service), nothing changes.
func attachParentConsole() {
	const attachParentProcess = ^uintptr(0) // ATTACH_PARENT_PROCESS (-1)
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	attach := kernel32.NewProc("AttachConsole")
	ret, _, _ := attach.Call(attachParentProcess)
	if ret == 0 {
		return
	}
	if out, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
		os.Stdout = out
		os.Stderr = out
	}
}
