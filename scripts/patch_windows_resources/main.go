//go:build windows

package main

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/tc-hib/winres"
	"github.com/tc-hib/winres/version"
)

func main() {
	var exePath string
	var iconPath string
	var manifestPath string
	var infoPath string

	flag.StringVar(&exePath, "exe", "", "path to the built exe")
	flag.StringVar(&iconPath, "icon", "", "path to the ico file")
	flag.StringVar(&manifestPath, "manifest", "", "path to the Windows manifest xml")
	flag.StringVar(&infoPath, "info", "", "path to the Windows version info json")
	flag.Parse()

	if exePath == "" || iconPath == "" || manifestPath == "" || infoPath == "" {
		fail("missing required arguments")
	}

	if err := patchWindowsResources(exePath, iconPath, manifestPath, infoPath); err != nil {
		fail(err.Error())
	}
}

func patchWindowsResources(exePath, iconPath, manifestPath, infoPath string) error {
	sourceFile, err := os.Open(exePath)
	if err != nil {
		return fmt.Errorf("open exe: %w", err)
	}
	defer sourceFile.Close()

	resourceSet, err := winres.LoadFromEXE(sourceFile)
	if err != nil {
		if !errors.Is(err, winres.ErrNoResources) {
			return fmt.Errorf("load exe resources: %w", err)
		}
		resourceSet = &winres.ResourceSet{}
	}
	clearResourceType(resourceSet, winres.RT_ICON)
	clearResourceType(resourceSet, winres.RT_GROUP_ICON)
	clearResourceType(resourceSet, winres.RT_MANIFEST)
	clearResourceType(resourceSet, winres.RT_VERSION)

	if err := applyIcon(resourceSet, iconPath); err != nil {
		return err
	}
	if err := applyManifest(resourceSet, manifestPath); err != nil {
		return err
	}
	if err := applyVersionInfo(resourceSet, infoPath); err != nil {
		return err
	}

	if _, err := sourceFile.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("seek exe: %w", err)
	}

	tempPath := exePath + ".patched"
	tempFile, err := os.Create(tempPath)
	if err != nil {
		return fmt.Errorf("create patched exe: %w", err)
	}

	writeErr := resourceSet.WriteToEXE(tempFile, sourceFile, winres.ForceCheckSum())
	closeErr := tempFile.Close()
	if writeErr != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("write patched exe: %w", writeErr)
	}
	if closeErr != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("close patched exe: %w", closeErr)
	}

	if err := sourceFile.Close(); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("close source exe: %w", err)
	}

	if err := os.Remove(exePath); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("remove original exe: %w", err)
	}
	if err := os.Rename(tempPath, exePath); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("replace exe: %w", err)
	}

	return nil
}

func applyIcon(resourceSet *winres.ResourceSet, iconPath string) error {
	iconFile, err := os.Open(iconPath)
	if err != nil {
		return fmt.Errorf("open icon: %w", err)
	}
	defer iconFile.Close()

	icon, err := winres.LoadICO(iconFile)
	if err != nil {
		return fmt.Errorf("load icon: %w", err)
	}

	if err := resourceSet.SetIcon(winres.ID(1), icon); err != nil {
		return fmt.Errorf("set icon: %w", err)
	}

	return nil
}

func clearResourceType(resourceSet *winres.ResourceSet, typeID winres.Identifier) {
	var entries []struct {
		resourceID winres.Identifier
		langID     uint16
	}

	resourceSet.WalkType(typeID, func(resourceID winres.Identifier, langID uint16, _ []byte) bool {
		entries = append(entries, struct {
			resourceID winres.Identifier
			langID     uint16
		}{
			resourceID: resourceID,
			langID:     langID,
		})
		return true
	})

	for _, entry := range entries {
		_ = resourceSet.Set(typeID, entry.resourceID, entry.langID, nil)
	}
}

func applyManifest(resourceSet *winres.ResourceSet, manifestPath string) error {
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		return fmt.Errorf("read manifest: %w", err)
	}

	manifest, err := winres.AppManifestFromXML(manifestData)
	if err != nil {
		return fmt.Errorf("parse manifest: %w", err)
	}

	resourceSet.SetManifest(manifest)
	return nil
}

func applyVersionInfo(resourceSet *winres.ResourceSet, infoPath string) error {
	infoData, err := os.ReadFile(infoPath)
	if err != nil {
		return fmt.Errorf("read version info: %w", err)
	}
	if len(bytes.TrimSpace(infoData)) == 0 {
		return nil
	}

	var info version.Info
	if err := info.UnmarshalJSON(infoData); err != nil {
		return fmt.Errorf("parse version info: %w", err)
	}

	resourceSet.SetVersionInfo(info)
	return nil
}

func fail(message string) {
	_, _ = fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
