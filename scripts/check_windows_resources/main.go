//go:build windows

package main

import (
	"bytes"
	"crypto/sha256"
	"flag"
	"fmt"
	"os"

	"github.com/tc-hib/winres"
)

func main() {
	var exePath string
	var iconPath string

	flag.StringVar(&exePath, "exe", "", "path to the built exe")
	flag.StringVar(&iconPath, "icon", "", "path to the source ico")
	flag.Parse()

	if exePath == "" || iconPath == "" {
		fail("missing required arguments")
	}

	if err := verifyEmbeddedIcon(exePath, iconPath); err != nil {
		fail(err.Error())
	}
}

func verifyEmbeddedIcon(exePath, iconPath string) error {
	exeFile, err := os.Open(exePath)
	if err != nil {
		return fmt.Errorf("open exe: %w", err)
	}
	defer exeFile.Close()

	resourceSet, err := winres.LoadFromEXE(exeFile)
	if err != nil {
		return fmt.Errorf("load exe resources: %w", err)
	}

	groupCount := 0
	resourceSet.WalkType(winres.RT_GROUP_ICON, func(resourceID winres.Identifier, langID uint16, _ []byte) bool {
		groupCount += 1
		return true
	})
	if groupCount != 1 {
		return fmt.Errorf("expected exactly 1 icon group, found %d", groupCount)
	}

	embeddedIcon, err := resourceSet.GetIcon(winres.ID(1))
	if err != nil {
		return fmt.Errorf("read embedded icon: %w", err)
	}

	sourceFile, err := os.Open(iconPath)
	if err != nil {
		return fmt.Errorf("open source icon: %w", err)
	}
	defer sourceFile.Close()

	sourceIcon, err := winres.LoadICO(sourceFile)
	if err != nil {
		return fmt.Errorf("load source icon: %w", err)
	}

	embeddedBytes, err := encodeICO(embeddedIcon)
	if err != nil {
		return fmt.Errorf("encode embedded icon: %w", err)
	}
	sourceBytes, err := encodeICO(sourceIcon)
	if err != nil {
		return fmt.Errorf("encode source icon: %w", err)
	}

	if sha256.Sum256(embeddedBytes) != sha256.Sum256(sourceBytes) {
		return fmt.Errorf("embedded icon bytes do not match source icon")
	}

	return nil
}

func encodeICO(icon *winres.Icon) ([]byte, error) {
	buffer := bytes.NewBuffer(nil)
	if err := icon.SaveICO(buffer); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func fail(message string) {
	_, _ = fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
